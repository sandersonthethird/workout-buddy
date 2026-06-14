import {
  HKQuantitySample,
  HKWorkout,
  HK_WORKOUT_ACTIVITY_TYPE_LAP_SWIMMING,
  HK_WORKOUT_ACTIVITY_TYPE_SWIMMING,
} from '@/types/healthkit';
import AppleHealthKit from 'react-native-health';

/**
 * HealthKit Query Builders
 *
 * Functions to query workout data from HealthKit.
 * Handles pagination and chunking to avoid timeouts on large datasets.
 */

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Query swim workouts within a date range
 */
export async function querySwimWorkouts(
  dateRange: DateRange
): Promise<HKWorkout[]> {
  return new Promise((resolve, reject) => {
    const options = {
      startDate: dateRange.startDate.toISOString(),
      endDate: dateRange.endDate.toISOString(),
      ascending: false, // Most recent first
      limit: 0, // No limit within the date range
    };

    AppleHealthKit.getAnchoredWorkouts(
      options,
      (error: Object, results: any) => {
        if (error) {
          reject(error);
          return;
        }

        // getAnchoredWorkouts returns {anchor: string, data: Array<workout>}
        const workouts = results.data || [];

        // Filter for swim workouts only and map to HKWorkout format
        const swimWorkouts: HKWorkout[] = workouts
          .filter(
            (workout: any) =>
              workout.activityId === HK_WORKOUT_ACTIVITY_TYPE_SWIMMING ||
              workout.activityId === HK_WORKOUT_ACTIVITY_TYPE_LAP_SWIMMING
          )
          .map((workout: any) => ({
            ...workout,
            uuid: workout.id || workout.uuid, // getAnchoredWorkouts uses 'id' field
          }));

        resolve(swimWorkouts);
      }
    );
  });
}

/**
 * Query swimming stroke count samples for a specific workout
 * Queries actual SwimmingStrokeCount samples from HealthKit
 * Each sample contains stroke count (value) and stroke style (metadata)
 */
export async function queryStrokeCountSamples(
  workout: HKWorkout
): Promise<HKQuantitySample[]> {
  return new Promise((resolve) => {
    // Expand time window by 1 hour before and after workout
    const startDate = new Date(workout.start);
    startDate.setHours(startDate.getHours() - 1);
    const endDate = new Date(workout.end);
    endDate.setHours(endDate.getHours() + 1);

    const options = {
      type: 'SwimmingStrokeCount' as any,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ascending: true,
      limit: 0,
    };

    AppleHealthKit.getSamples(
      options,
      (error: string, results: any[]) => {
        if (error) {
          console.warn('[queryStrokeCountSamples] query error:', error);
          resolve([]);
          return;
        }

        // Map results to HKQuantitySample format, preserving metadata.
        // getSamples returns 'quantity'/'start'/'end' instead of
        // 'value'/'startDate'/'endDate'.
        const samples: HKQuantitySample[] = (results || []).map((sample: any) => ({
          id: sample.id || sample.uuid,
          uuid: sample.uuid || sample.id,
          value: sample.quantity || sample.value,
          startDate: sample.start || sample.startDate,
          endDate: sample.end || sample.endDate,
          metadata: sample.metadata || {}, // Contains HKSwimmingStrokeStyle
          sourceName: sample.sourceName,
          sourceId: sample.sourceId,
        }));

        resolve(samples);
      }
    );
  });
}

/**
 * Query heart rate samples for a specific workout
 */
export async function queryHeartRateSamples(
  workout: HKWorkout
): Promise<HKQuantitySample[]> {
  return new Promise((resolve, reject) => {
    const options = {
      startDate: workout.start,
      endDate: workout.end,
      ascending: true,
      limit: 0, // Get all samples
    };

    AppleHealthKit.getHeartRateSamples(
      options,
      (error: Object, results: HKQuantitySample[]) => {
        if (error) {
          console.error('getHeartRateSamples error:', error);
          reject(error);
          return;
        }

        resolve(results || []);
      }
    );
  });
}

/**
 * Query distance swimming samples for a specific workout
 */
export async function queryDistanceSwimmingSamples(
  workout: HKWorkout
): Promise<HKQuantitySample[]> {
  return new Promise((resolve) => {
    const options = {
      type: 'DistanceSwimming' as any, // Type system expects HealthObserver but accepts HealthPermission strings
      startDate: workout.start,
      endDate: workout.end,
      ascending: true,
      limit: 0,
    };

    AppleHealthKit.getSamples(
      options,
      (error: string, results: any[]) => {
        if (error) {
          console.log('getSamples (DistanceSwimming) error - returning empty array:', error);
          // Don't reject - just return empty array
          // Many workouts don't have lap-by-lap distance samples
          resolve([]);
          return;
        }

        if (!results || results.length === 0) {
          resolve([]);
          return;
        }

        // Map HealthValue[] to HKQuantitySample[]
        // Note: getSamples returns 'quantity', 'start', 'end' instead of 'value', 'startDate', 'endDate'
        const samples: HKQuantitySample[] = (results || []).map((sample: any) => ({
          id: sample.id || sample.uuid || `${workout.uuid}-distance-${sample.start || sample.startDate}`,
          uuid: sample.id || sample.uuid || `${workout.uuid}-distance-${sample.start || sample.startDate}`,
          value: sample.quantity || sample.value,
          startDate: sample.start || sample.startDate,
          endDate: sample.end || sample.endDate,
          metadata: sample.metadata,
          sourceName: sample.sourceName || workout.sourceName,
          sourceId: sample.sourceId || workout.sourceId,
        }));

        resolve(samples);
      }
    );
  });
}

/**
 * Get total count of swim workouts
 * Useful for progress tracking during bulk import
 */
export async function getSwimWorkoutCount(
  dateRange: DateRange
): Promise<number> {
  try {
    const workouts = await querySwimWorkouts(dateRange);
    return workouts.length;
  } catch (error) {
    console.error('Error getting workout count:', error);
    return 0;
  }
}

/**
 * Split a date range into smaller chunks for pagination
 * Helps avoid HealthKit query timeouts
 */
export function splitDateRangeIntoChunks(
  startDate: Date,
  endDate: Date,
  chunkSizeDays: number = 90
): DateRange[] {
  const chunks: DateRange[] = [];
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const chunkSizeMs = chunkSizeDays * millisecondsPerDay;

  let currentStart = new Date(startDate);

  while (currentStart < endDate) {
    const currentEnd = new Date(
      Math.min(currentStart.getTime() + chunkSizeMs, endDate.getTime())
    );

    chunks.push({
      startDate: new Date(currentStart),
      endDate: currentEnd,
    });

    currentStart = new Date(currentEnd);
  }

  return chunks;
}

/**
 * Query workouts in paginated chunks
 * Safer for large date ranges
 */
export async function querySwimWorkoutsPaginated(
  startDate: Date,
  endDate: Date,
  onProgress?: (current: number, total: number) => void
): Promise<HKWorkout[]> {
  const chunks = splitDateRangeIntoChunks(startDate, endDate, 90);
  const allWorkouts: HKWorkout[] = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const workouts = await querySwimWorkouts(chunks[i]);
      allWorkouts.push(...workouts);

      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }
    } catch (error) {
      console.error(`Error querying chunk ${i + 1}/${chunks.length}:`, error);
      // Continue with next chunk instead of failing completely
    }
  }

  return allWorkouts;
}
