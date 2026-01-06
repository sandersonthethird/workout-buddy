import AppleHealthKit from 'react-native-health';
import {
  HKWorkout,
  HKQuantitySample,
  HK_WORKOUT_ACTIVITY_TYPE_SWIMMING,
  HK_WORKOUT_ACTIVITY_TYPE_LAP_SWIMMING,
} from '@/types/healthkit';

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

    AppleHealthKit.getWorkoutSamples(
      options,
      (error: Object, results: HKWorkout[]) => {
        if (error) {
          reject(error);
          return;
        }

        // Filter for swim workouts only
        const swimWorkouts = results.filter(
          (workout) =>
            workout.activityId === HK_WORKOUT_ACTIVITY_TYPE_SWIMMING ||
            workout.activityId === HK_WORKOUT_ACTIVITY_TYPE_LAP_SWIMMING
        );

        resolve(swimWorkouts);
      }
    );
  });
}

/**
 * Query swimming stroke count samples for a specific workout
 */
export async function queryStrokeCountSamples(
  workout: HKWorkout
): Promise<HKQuantitySample[]> {
  return new Promise((resolve, reject) => {
    const options = {
      startDate: workout.start,
      endDate: workout.end,
      ascending: true,
      limit: 0, // Get all samples
    };

    AppleHealthKit.getSwimmingStrokeCountSamples(
      options,
      (error: Object, results: HKQuantitySample[]) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(results || []);
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
  return new Promise((resolve, reject) => {
    const options = {
      startDate: workout.start,
      endDate: workout.end,
      ascending: true,
      limit: 0,
    };

    AppleHealthKit.getDistanceSwimming(
      options,
      (error: Object, results: HKQuantitySample[]) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(results || []);
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
