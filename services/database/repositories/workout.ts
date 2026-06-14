import * as SQLite from 'expo-sqlite';
import {
  Workout,
  Segment,
  Lap,
  StrokeSample,
  HeartRateSample,
  WorkoutWithLaps,
  WorkoutWithSegments,
  SegmentWithLaps,
  WorkoutWithAllData,
  WorkoutFilters,
} from '@/types/workout';

/**
 * Workout Repository
 *
 * CRUD operations for workouts and related data in the local SQLite database.
 */

/**
 * Insert a workout into the database
 */
export async function insertWorkout(
  db: SQLite.SQLiteDatabase,
  workout: Workout
): Promise<void> {
  await db.runAsync(
    `INSERT INTO workouts (
      id, healthkit_uuid, start_date, end_date, duration_seconds,
      total_distance_meters, total_energy_kcal, pool_length_meters, pool_length_unit,
      location_type, source_app, data_quality,
      synced_to_cloud, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workout.id,
      workout.healthkit_uuid,
      workout.start_date,
      workout.end_date,
      workout.duration_seconds,
      workout.total_distance_meters,
      workout.total_energy_kcal,
      workout.pool_length_meters,
      workout.pool_length_unit,
      workout.location_type,
      workout.source_app,
      workout.data_quality,
      workout.synced_to_cloud,
      workout.created_at,
      workout.updated_at,
    ]
  );
}

/**
 * Insert segments for a workout
 */
export async function insertSegments(
  db: SQLite.SQLiteDatabase,
  segments: Segment[]
): Promise<void> {
  if (segments.length === 0) return;

  for (const segment of segments) {
    await db.runAsync(
      `INSERT INTO segments (
        id, workout_id, segment_number, start_time, end_time,
        lap_count, total_distance_meters, total_duration_seconds,
        swim_duration_seconds, rest_duration_seconds, avg_pace_per_100m_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        segment.id,
        segment.workout_id,
        segment.segment_number,
        segment.start_time,
        segment.end_time,
        segment.lap_count,
        segment.total_distance_meters,
        segment.total_duration_seconds,
        segment.swim_duration_seconds,
        segment.rest_duration_seconds,
        segment.avg_pace_per_100m_seconds,
      ]
    );
  }
}

/**
 * Insert laps for a workout
 */
export async function insertLaps(
  db: SQLite.SQLiteDatabase,
  laps: Lap[]
): Promise<void> {
  if (laps.length === 0) return;

  for (const lap of laps) {
    await db.runAsync(
      `INSERT INTO laps (
        id, workout_id, lap_number, start_time, end_time,
        distance_meters, duration_seconds, stroke_style, stroke_count,
        avg_heart_rate, max_heart_rate, swolf_score, pace_per_100m_seconds, segment_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lap.id,
        lap.workout_id,
        lap.lap_number,
        lap.start_time,
        lap.end_time,
        lap.distance_meters,
        lap.duration_seconds,
        lap.stroke_style,
        lap.stroke_count,
        lap.avg_heart_rate,
        lap.max_heart_rate,
        lap.swolf_score,
        lap.pace_per_100m_seconds,
        lap.segment_id,
      ]
    );
  }
}

/**
 * Insert stroke samples
 */
export async function insertStrokeSamples(
  db: SQLite.SQLiteDatabase,
  samples: StrokeSample[]
): Promise<void> {
  if (samples.length === 0) return;

  for (const sample of samples) {
    await db.runAsync(
      `INSERT INTO stroke_samples (id, workout_id, lap_id, timestamp, stroke_count)
       VALUES (?, ?, ?, ?, ?)`,
      [sample.id, sample.workout_id, sample.lap_id, sample.timestamp, sample.stroke_count]
    );
  }
}

/**
 * Insert heart rate samples
 */
export async function insertHeartRateSamples(
  db: SQLite.SQLiteDatabase,
  samples: HeartRateSample[]
): Promise<void> {
  if (samples.length === 0) return;

  for (const sample of samples) {
    await db.runAsync(
      `INSERT INTO heart_rate_samples (id, workout_id, timestamp, heart_rate)
       VALUES (?, ?, ?, ?)`,
      [sample.id, sample.workout_id, sample.timestamp, sample.heart_rate]
    );
  }
}

/**
 * Insert complete workout data (workout + laps + segments + samples) in a transaction
 */
export async function insertCompleteWorkoutData(
  db: SQLite.SQLiteDatabase,
  workout: Workout,
  laps: Lap[],
  segments: Segment[],
  strokeSamples: StrokeSample[],
  heartRateSamples: HeartRateSample[]
): Promise<void> {
  console.log('[DB] Inserting workout:', {
    id: workout.id,
    distance: workout.total_distance_meters,
    laps: laps.length,
    segments: segments.length
  });

  // Debug: Log first segment data before insert
  if (segments.length > 0) {
    console.log('[DB] First segment before insert:', {
      id: segments[0].id,
      segment_number: segments[0].segment_number,
      swim_duration_seconds: segments[0].swim_duration_seconds,
      rest_duration_seconds: segments[0].rest_duration_seconds,
      total_duration_seconds: segments[0].total_duration_seconds
    });
  }

  // Use transaction for atomic insert
  await db.withTransactionAsync(async () => {
    await insertWorkout(db, workout);
    await insertSegments(db, segments);
    await insertLaps(db, laps);
    await insertStrokeSamples(db, strokeSamples);
    await insertHeartRateSamples(db, heartRateSamples);
  });

  console.log('[DB] Successfully inserted workout:', workout.id);
}

/**
 * Get a workout by ID
 */
export async function getWorkoutById(
  db: SQLite.SQLiteDatabase,
  id: string
): Promise<Workout | null> {
  const result = await db.getFirstAsync<Workout>(
    'SELECT * FROM workouts WHERE id = ?',
    [id]
  );
  return result || null;
}

/**
 * Get segments for a workout
 */
export async function getSegmentsByWorkoutId(
  db: SQLite.SQLiteDatabase,
  workoutId: string
): Promise<Segment[]> {
  const results = await db.getAllAsync<Segment>(
    'SELECT * FROM segments WHERE workout_id = ? ORDER BY segment_number ASC',
    [workoutId]
  );
  return results;
}

/**
 * Get laps for a workout
 */
export async function getLapsByWorkoutId(
  db: SQLite.SQLiteDatabase,
  workoutId: string
): Promise<Lap[]> {
  const results = await db.getAllAsync<Lap>(
    'SELECT * FROM laps WHERE workout_id = ? ORDER BY lap_number ASC',
    [workoutId]
  );
  return results;
}

/**
 * Get heart rate samples for a workout
 */
export async function getHeartRateSamplesByWorkoutId(
  db: SQLite.SQLiteDatabase,
  workoutId: string
): Promise<HeartRateSample[]> {
  const results = await db.getAllAsync<HeartRateSample>(
    `SELECT * FROM heart_rate_samples
     WHERE workout_id = ?
     ORDER BY timestamp ASC`,
    [workoutId]
  );
  return results || [];
}

/**
 * Get workout with laps
 */
export async function getWorkoutWithLaps(
  db: SQLite.SQLiteDatabase,
  id: string
): Promise<WorkoutWithLaps | null> {
  const workout = await getWorkoutById(db, id);
  if (!workout) return null;

  const laps = await getLapsByWorkoutId(db, id);

  return {
    ...workout,
    laps,
  };
}

/**
 * Get workout with segments
 */
export async function getWorkoutWithSegments(
  db: SQLite.SQLiteDatabase,
  id: string
): Promise<WorkoutWithSegments | null> {
  const workout = await getWorkoutById(db, id);
  if (!workout) return null;

  const segments = await getSegmentsByWorkoutId(db, id);

  return {
    ...workout,
    segments,
  };
}

/**
 * Get segment with laps
 */
export async function getSegmentWithLaps(
  db: SQLite.SQLiteDatabase,
  segmentId: string
): Promise<SegmentWithLaps | null> {
  const segment = await db.getFirstAsync<Segment>(
    'SELECT * FROM segments WHERE id = ?',
    [segmentId]
  );

  if (!segment) return null;

  const laps = await db.getAllAsync<Lap>(
    'SELECT * FROM laps WHERE segment_id = ? ORDER BY lap_number ASC',
    [segmentId]
  );

  return {
    ...segment,
    laps,
  };
}

/**
 * Get all workouts with optional filters
 */
export async function getWorkouts(
  db: SQLite.SQLiteDatabase,
  filters?: WorkoutFilters
): Promise<Workout[]> {
  let query = 'SELECT * FROM workouts WHERE 1=1';
  const params: any[] = [];

  if (filters?.startDate) {
    query += ' AND start_date >= ?';
    params.push(filters.startDate.getTime());
  }

  if (filters?.endDate) {
    query += ' AND start_date <= ?';
    params.push(filters.endDate.getTime());
  }

  // Note: stroke_style is now at lap level, not workout level
  // To filter by stroke_style, you need to join with laps table
  if (filters?.strokeStyle) {
    query += ` AND EXISTS (
      SELECT 1 FROM laps WHERE laps.workout_id = workouts.id AND laps.stroke_style = ?
    )`;
    params.push(filters.strokeStyle);
  }

  if (filters?.locationType) {
    query += ' AND location_type = ?';
    params.push(filters.locationType);
  }

  if (filters?.minDistance) {
    query += ' AND total_distance_meters >= ?';
    params.push(filters.minDistance);
  }

  if (filters?.maxDistance) {
    query += ' AND total_distance_meters <= ?';
    params.push(filters.maxDistance);
  }

  query += ' ORDER BY start_date DESC';

  if (filters?.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  if (filters?.offset) {
    query += ' OFFSET ?';
    params.push(filters.offset);
  }

  const results = await db.getAllAsync<Workout>(query, params);
  return results;
}

/**
 * Get recent workouts (last N workouts)
 */
export async function getRecentWorkouts(
  db: SQLite.SQLiteDatabase,
  limit: number = 10
): Promise<Workout[]> {
  const results = await db.getAllAsync<Workout>(
    'SELECT * FROM workouts ORDER BY start_date DESC LIMIT ?',
    [limit]
  );
  return results;
}

/**
 * Get total workout count
 */
export async function getWorkoutCount(
  db: SQLite.SQLiteDatabase
): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM workouts'
  );
  return result?.count || 0;
}

/**
 * Check if a workout exists by HealthKit UUID
 */
export async function workoutExistsByHealthKitUuid(
  db: SQLite.SQLiteDatabase,
  healthkitUuid: string
): Promise<boolean> {
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM workouts WHERE healthkit_uuid = ?',
    [healthkitUuid]
  );
  return (result?.count || 0) > 0;
}

/**
 * Update workout sync status
 */
export async function updateWorkoutSyncStatus(
  db: SQLite.SQLiteDatabase,
  id: string,
  synced: boolean
): Promise<void> {
  await db.runAsync('UPDATE workouts SET synced_to_cloud = ? WHERE id = ?', [
    synced ? 1 : 0,
    id,
  ]);
}

/**
 * Delete a workout and all related data
 */
export async function deleteWorkout(
  db: SQLite.SQLiteDatabase,
  id: string
): Promise<void> {
  // Foreign key constraints will cascade delete related data
  await db.runAsync('DELETE FROM workouts WHERE id = ?', [id]);
}

/**
 * Delete all workouts and their related data.
 *
 * Child rows cascade from workouts via ON DELETE CASCADE, but we delete them
 * explicitly inside a transaction so it works even if foreign keys aren't
 * enforced on a given connection.
 */
export async function deleteAllWorkouts(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM heart_rate_samples');
    await db.runAsync('DELETE FROM stroke_samples');
    await db.runAsync('DELETE FROM laps');
    await db.runAsync('DELETE FROM segments');
    await db.runAsync('DELETE FROM workouts');
  });
}

/**
 * Get workouts that haven't been synced to cloud
 */
export async function getUnsyncedWorkouts(
  db: SQLite.SQLiteDatabase
): Promise<Workout[]> {
  const results = await db.getAllAsync<Workout>(
    'SELECT * FROM workouts WHERE synced_to_cloud = 0 ORDER BY created_at ASC'
  );
  return results;
}

/**
 * 100-yard/meter split data
 */
export interface Split100 {
  split_number: number;
  start_distance: number;
  end_distance: number;
  duration_seconds: number;
  stroke_count: number;
  pace_per_100_seconds: number;
  unit: 'yd' | 'm';
}

/**
 * Calculate 100-yard or 100-meter splits from laps
 * Aggregates lap data into 100yd/m chunks for analysis
 */
export async function calculate100Splits(
  db: SQLite.SQLiteDatabase,
  workoutId: string
): Promise<Split100[]> {
  // Get workout to determine unit
  const workout = await getWorkoutById(db, workoutId);
  if (!workout) return [];

  const unit = workout.pool_length_unit || 'm';

  // Get laps ordered by lap_number
  const laps = await getLapsByWorkoutId(db, workoutId);
  if (laps.length === 0) return [];

  const splits: Split100[] = [];
  let splitDistance = 0;
  let splitDuration = 0;
  let splitStrokes = 0;
  let splitNumber = 1;

  const targetSplitDistance = unit === 'yd'
    ? 100 * 0.9144  // 100 yards in meters
    : 100;           // 100 meters

  for (const lap of laps) {
    splitDistance += lap.distance_meters;
    splitDuration += lap.duration_seconds;
    splitStrokes += lap.stroke_count || 0;

    // Check if we've completed a 100yd/m split
    if (splitDistance >= targetSplitDistance) {
      splits.push({
        split_number: splitNumber,
        start_distance: (splitNumber - 1) * 100,
        end_distance: splitNumber * 100,
        duration_seconds: splitDuration,
        stroke_count: splitStrokes,
        pace_per_100_seconds: (splitDuration / splitDistance) * targetSplitDistance,
        unit,
      });

      splitNumber++;
      splitDistance = 0;
      splitDuration = 0;
      splitStrokes = 0;
    }
  }

  // Handle remaining partial split
  if (splitDistance > 0) {
    const actualDistance = unit === 'yd'
      ? splitDistance / 0.9144  // Convert to yards
      : splitDistance;           // Already in meters

    splits.push({
      split_number: splitNumber,
      start_distance: (splitNumber - 1) * 100,
      end_distance: Math.round((splitNumber - 1) * 100 + actualDistance),
      duration_seconds: splitDuration,
      stroke_count: splitStrokes,
      pace_per_100_seconds: (splitDuration / splitDistance) * targetSplitDistance,
      unit,
    });
  }

  return splits;
}
