import * as SQLite from 'expo-sqlite';
import { ALL_TABLES, CURRENT_SCHEMA_VERSION } from '../services/database/schema';
import { reconcileSchema } from '../services/database/migrations';

/**
 * Database Manager
 *
 * Handles SQLite database initialization and provides a singleton instance.
 */

const DATABASE_NAME = 'workoutbuddy.db';

let databaseInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Initialize the database - creates schema directly without migrations
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (databaseInstance) {
    return databaseInstance;
  }

  try {
    console.log('Initializing database...');

    // Open database
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

    // Enable foreign keys
    await db.execAsync('PRAGMA foreign_keys = ON');

    // Create all tables directly
    console.log(`Creating database schema version ${CURRENT_SCHEMA_VERSION}`);
    for (const sql of ALL_TABLES) {
      await db.execAsync(sql);
    }

    // Reconcile columns that may be missing on databases created under an
    // older schema (CREATE TABLE IF NOT EXISTS does not alter existing tables).
    await reconcileSchema(db);

    // Set schema version
    await db.execAsync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);

    databaseInstance = db;

    console.log('Database initialized successfully');
    return db;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Get the database instance (must be initialized first)
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!databaseInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return databaseInstance;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (databaseInstance) {
    await databaseInstance.closeAsync();
    databaseInstance = null;
    console.log('Database closed');
  }
}
