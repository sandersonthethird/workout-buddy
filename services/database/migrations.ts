import * as SQLite from 'expo-sqlite';
import { ALL_TABLES, CURRENT_SCHEMA_VERSION } from './schema';

/**
 * Database Migration Manager
 *
 * Handles schema versioning and migrations for the local SQLite database.
 */

export interface Migration {
  version: number;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
  down?: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

/**
 * Get current schema version from database
 */
async function getCurrentVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  try {
    const result = await db.getAllAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    return result[0]?.user_version || 0;
  } catch (error) {
    console.error('Error getting schema version:', error);
    return 0;
  }
}

/**
 * Set schema version in database
 */
async function setVersion(
  db: SQLite.SQLiteDatabase,
  version: number
): Promise<void> {
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

/**
 * Initial migration - creates all tables
 */
const migration_v1: Migration = {
  version: 1,
  up: async (db: SQLite.SQLiteDatabase) => {
    console.log('Running migration v1: Creating initial schema');

    for (const sql of ALL_TABLES) {
      await db.execAsync(sql);
    }

    console.log('Migration v1 completed successfully');
  },
  down: async (db: SQLite.SQLiteDatabase) => {
    // Drop all tables in reverse order
    await db.execAsync(`
      DROP INDEX IF EXISTS idx_heart_rate_workout;
      DROP INDEX IF EXISTS idx_stroke_samples_workout;
      DROP INDEX IF EXISTS idx_splits_workout;
      DROP INDEX IF EXISTS idx_workouts_synced;
      DROP INDEX IF EXISTS idx_workouts_start_date;
      DROP TABLE IF EXISTS chat_messages;
      DROP TABLE IF EXISTS sync_state;
      DROP TABLE IF EXISTS heart_rate_samples;
      DROP TABLE IF EXISTS stroke_samples;
      DROP TABLE IF EXISTS splits;
      DROP TABLE IF EXISTS workouts;
    `);
  },
};

/**
 * Migration v2: Rename splits to laps, add stroke_style to laps, create segments table
 */
const migration_v2: Migration = {
  version: 2,
  up: async (db: SQLite.SQLiteDatabase) => {
    console.log('Running migration v2: Restructuring for laps and segments');

    await db.withTransactionAsync(async () => {
      // 1. Create segments table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS segments (
          id TEXT PRIMARY KEY,
          workout_id TEXT NOT NULL,
          segment_number INTEGER NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          lap_count INTEGER NOT NULL,
          total_distance_meters REAL,
          total_duration_seconds REAL,
          avg_pace_per_100m_seconds REAL,
          FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
        );
      `);

      // 2. Create new laps table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS laps (
          id TEXT PRIMARY KEY,
          workout_id TEXT NOT NULL,
          lap_number INTEGER NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          distance_meters REAL NOT NULL,
          duration_seconds REAL NOT NULL,
          stroke_style TEXT,
          stroke_count INTEGER,
          avg_heart_rate INTEGER,
          max_heart_rate INTEGER,
          swolf_score INTEGER,
          pace_per_100m_seconds REAL,
          segment_id TEXT,
          FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
          FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE SET NULL
        );
      `);

      // 3. Migrate data from splits to laps (if any exists)
      const splitsExist = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='splits'"
      );

      if (splitsExist && splitsExist.count > 0) {
        await db.execAsync(`
          INSERT INTO laps (
            id, workout_id, lap_number, start_time, end_time,
            distance_meters, duration_seconds, stroke_count,
            avg_heart_rate, max_heart_rate, swolf_score, pace_per_100m_seconds,
            stroke_style, segment_id
          )
          SELECT
            id, workout_id, split_number, start_time, end_time,
            distance_meters, duration_seconds, stroke_count,
            avg_heart_rate, max_heart_rate, swolf_score, pace_per_100m_seconds,
            NULL, NULL
          FROM splits;
        `);
      }

      // 4. Update stroke_samples table
      await db.execAsync(`
        CREATE TABLE stroke_samples_new (
          id TEXT PRIMARY KEY,
          workout_id TEXT NOT NULL,
          lap_id TEXT,
          timestamp INTEGER NOT NULL,
          stroke_count INTEGER NOT NULL,
          FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
          FOREIGN KEY (lap_id) REFERENCES laps(id) ON DELETE CASCADE
        );
      `);

      const strokeSamplesExist = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='stroke_samples'"
      );

      if (strokeSamplesExist && strokeSamplesExist.count > 0) {
        // Check if old stroke_samples has split_id column (v1 schema)
        const columnsResult = await db.getAllAsync<{ name: string }>(
          "PRAGMA table_info(stroke_samples)"
        );
        const hasSplitId = columnsResult.some(col => col.name === 'split_id');

        if (hasSplitId) {
          // Migrate from old schema with split_id
          await db.execAsync(`
            INSERT INTO stroke_samples_new (id, workout_id, lap_id, timestamp, stroke_count)
            SELECT id, workout_id, split_id, timestamp, stroke_count
            FROM stroke_samples;
          `);
        } else {
          // Already using new schema, just copy as-is
          await db.execAsync(`
            INSERT INTO stroke_samples_new (id, workout_id, lap_id, timestamp, stroke_count)
            SELECT id, workout_id, lap_id, timestamp, stroke_count
            FROM stroke_samples;
          `);
        }
      }

      await db.execAsync('DROP TABLE IF EXISTS stroke_samples;');
      await db.execAsync('ALTER TABLE stroke_samples_new RENAME TO stroke_samples;');

      // 5. Update workouts table (remove stroke_style column)
      await db.execAsync(`
        CREATE TABLE workouts_new (
          id TEXT PRIMARY KEY,
          healthkit_uuid TEXT UNIQUE NOT NULL,
          start_date INTEGER NOT NULL,
          end_date INTEGER NOT NULL,
          duration_seconds INTEGER NOT NULL,
          total_distance_meters REAL NOT NULL,
          total_energy_kcal REAL,
          pool_length_meters REAL,
          location_type TEXT,
          source_app TEXT,
          data_quality INTEGER DEFAULT 1,
          synced_to_cloud INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      const workoutsExist = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='workouts'"
      );

      if (workoutsExist && workoutsExist.count > 0) {
        await db.execAsync(`
          INSERT INTO workouts_new
          SELECT id, healthkit_uuid, start_date, end_date, duration_seconds,
                 total_distance_meters, total_energy_kcal, pool_length_meters,
                 location_type, source_app, data_quality, synced_to_cloud,
                 created_at, updated_at
          FROM workouts;
        `);
      }

      await db.execAsync('DROP TABLE IF EXISTS workouts;');
      await db.execAsync('ALTER TABLE workouts_new RENAME TO workouts;');

      // 6. Drop old splits table
      await db.execAsync('DROP TABLE IF EXISTS splits;');

      // 7. Create new indexes
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_segments_workout ON segments(workout_id, segment_number);
        CREATE INDEX IF NOT EXISTS idx_laps_workout ON laps(workout_id, lap_number);
        CREATE INDEX IF NOT EXISTS idx_laps_segment ON laps(segment_id);
        CREATE INDEX IF NOT EXISTS idx_stroke_samples_lap ON stroke_samples(lap_id);
      `);

      // 8. Drop old split index if it exists
      await db.execAsync('DROP INDEX IF EXISTS idx_splits_workout;');
    });

    console.log('Migration v2 completed successfully');
  },
  down: async (db: SQLite.SQLiteDatabase) => {
    // Rollback not supported for this migration as it involves structural changes
    throw new Error('Rollback from v2 to v1 is not supported');
  },
};

/**
 * Add a column to a table only if it does not already exist.
 * Safe across databases that arrived at the current state via different paths
 * (fresh v1 install vs. upgraded-through-v2), where a column may or may not
 * already be present.
 */
export async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    console.log(`Adding missing column ${table}.${column}`);
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

/**
 * Reconcile the live database against the current schema by adding any columns
 * that are missing.
 *
 * initDatabase() creates tables with CREATE TABLE IF NOT EXISTS and does not
 * run the version-gated migration runner, so databases created under an older
 * schema keep their old column set (CREATE IF NOT EXISTS never alters an
 * existing table). This idempotent pass closes that drift on every launch —
 * notably restoring workouts.pool_length_unit, whose absence makes every
 * workout insert fail and silently rolls back the HealthKit import.
 */
export async function reconcileSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'workouts', 'pool_length_unit', 'TEXT');
  await addColumnIfMissing(db, 'segments', 'swim_duration_seconds', 'REAL');
  await addColumnIfMissing(db, 'segments', 'rest_duration_seconds', 'REAL');
  // Multi-conversation support: chat_messages created before conversations
  // existed have no conversation_id.
  await addColumnIfMissing(db, 'chat_messages', 'conversation_id', 'TEXT');
}

/**
 * Migration v3: Restore pool_length_unit on workouts.
 *
 * migration_v2 rebuilt the workouts table without pool_length_unit, but the
 * insert path (and current schema) require it. Without this column every new
 * workout insert fails with "table workouts has no column named
 * pool_length_unit", rolling back the import transaction.
 */
const migration_v3: Migration = {
  version: 3,
  up: async (db: SQLite.SQLiteDatabase) => {
    console.log('Running migration v3: Add workouts.pool_length_unit');
    await addColumnIfMissing(db, 'workouts', 'pool_length_unit', 'TEXT');
    console.log('Migration v3 completed successfully');
  },
};

/**
 * Migration v4: Ensure segments has swim/rest duration columns.
 *
 * Defensive: databases created via the v1 schema already have these, but any
 * that reached the segments table through a path lacking them are reconciled
 * here so insertSegments() does not fail.
 */
const migration_v4: Migration = {
  version: 4,
  up: async (db: SQLite.SQLiteDatabase) => {
    console.log('Running migration v4: Ensure segments swim/rest duration columns');
    await addColumnIfMissing(db, 'segments', 'swim_duration_seconds', 'REAL');
    await addColumnIfMissing(db, 'segments', 'rest_duration_seconds', 'REAL');
    console.log('Migration v4 completed successfully');
  },
};

/**
 * All migrations in order
 */
const MIGRATIONS: Migration[] = [
  migration_v1,
  migration_v2,
  migration_v3,
  migration_v4,
];

/**
 * Run pending migrations
 */
export async function runMigrations(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  const currentVersion = await getCurrentVersion(db);

  console.log(
    `Current schema version: ${currentVersion}, Target version: ${CURRENT_SCHEMA_VERSION}`
  );

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    console.log('Database schema is up to date');
    return;
  }

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than app version ${CURRENT_SCHEMA_VERSION}. Please update the app.`
    );
  }

  // Run pending migrations
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.log(`Running migration to version ${migration.version}`);
      await migration.up(db);
      await setVersion(db, migration.version);
    }
  }

  console.log('All migrations completed successfully');
}

/**
 * Reset database (for development/testing)
 */
export async function resetDatabase(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  console.log('Resetting database...');

  const currentVersion = await getCurrentVersion(db);

  // Run all down migrations in reverse order
  for (let i = MIGRATIONS.length - 1; i >= 0; i--) {
    const migration = MIGRATIONS[i];
    if (migration.version <= currentVersion && migration.down) {
      console.log(`Rolling back migration v${migration.version}`);
      await migration.down(db);
    }
  }

  await setVersion(db, 0);

  // Run all up migrations
  await runMigrations(db);

  console.log('Database reset complete');
}
