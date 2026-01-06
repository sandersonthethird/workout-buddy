import uuid from 'react-native-uuid';
import {
  HKWorkout,
  HKQuantitySample,
  HKSwimmingLocationType,
  HKSwimmingStrokeStyle,
  HKSwimmingWorkoutMetadata,
} from '@/types/healthkit';
import {
  Workout,
  Split,
  StrokeSample,
  HeartRateSample,
  StrokeStyle,
} from '@/types/workout';

/**
 * HealthKit Data Parsers
 *
 * Transforms HealthKit data structures into our app's normalized format.
 * Handles inconsistencies from different apps and devices.
 */

/**
 * Calculate data quality score based on available data
 * 0 = minimal, 1 = basic, 2 = good, 3 = excellent
 */
function calculateDataQuality(
  workout: HKWorkout,
  hasSplits: boolean,
  hasStrokeCount: boolean,
  hasHeartRate: boolean
): number {
  let score = 1; // Basic data (duration, distance)

  if (hasSplits) score++;
  if (hasStrokeCount) score++;
  if (hasHeartRate && score === 3) score++; // Only bump to excellent if we have everything else

  return Math.min(score, 3);
}

/**
 * Parse stroke style from HealthKit metadata
 */
function parseStrokeStyle(metadata?: HKSwimmingWorkoutMetadata): StrokeStyle | null {
  if (!metadata?.HKSwimmingStrokeStyle) {
    return null;
  }

  const styleMap: Record<number, StrokeStyle> = {
    [HKSwimmingStrokeStyle.Freestyle]: 'freestyle',
    [HKSwimmingStrokeStyle.Backstroke]: 'backstroke',
    [HKSwimmingStrokeStyle.Breaststroke]: 'breaststroke',
    [HKSwimmingStrokeStyle.Butterfly]: 'butterfly',
    [HKSwimmingStrokeStyle.Mixed]: 'mixed',
  };

  return styleMap[metadata.HKSwimmingStrokeStyle] || null;
}

/**
 * Parse location type from HealthKit metadata
 */
function parseLocationType(metadata?: HKSwimmingWorkoutMetadata): 'pool' | 'open_water' | null {
  if (!metadata?.HKSwimmingLocationType) {
    return null;
  }

  if (metadata.HKSwimmingLocationType === HKSwimmingLocationType.Pool) {
    return 'pool';
  } else if (metadata.HKSwimmingLocationType === HKSwimmingLocationType.OpenWater) {
    return 'open_water';
  }

  return null;
}

/**
 * Parse pool length from HealthKit metadata
 */
function parsePoolLength(metadata?: HKSwimmingWorkoutMetadata): number | null {
  if (!metadata?.HKLapLength) {
    return null;
  }

  const { unit, quantity } = metadata.HKLapLength;

  // Convert to meters if needed
  if (unit === 'yd' || unit === 'yard') {
    return quantity * 0.9144; // yards to meters
  }

  return quantity; // Assume meters
}

/**
 * Parse HKWorkout into our Workout format
 */
export function parseWorkout(
  hkWorkout: HKWorkout,
  hasSplits: boolean = false,
  hasStrokeCount: boolean = false,
  hasHeartRate: boolean = false
): Workout {
  const metadata = hkWorkout.metadata as HKSwimmingWorkoutMetadata | undefined;
  const now = Date.now();

  return {
    id: uuid.v4() as string,
    healthkit_uuid: hkWorkout.uuid,
    start_date: new Date(hkWorkout.start).getTime(),
    end_date: new Date(hkWorkout.end).getTime(),
    duration_seconds: hkWorkout.duration,
    total_distance_meters: hkWorkout.distance || 0,
    total_energy_kcal: hkWorkout.calories || null,
    pool_length_meters: parsePoolLength(metadata),
    location_type: parseLocationType(metadata),
    stroke_style: parseStrokeStyle(metadata),
    source_app: hkWorkout.sourceName,
    data_quality: calculateDataQuality(hkWorkout, hasSplits, hasStrokeCount, hasHeartRate),
    synced_to_cloud: 0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Parse stroke count samples into our format
 */
export function parseStrokeSamples(
  workoutId: string,
  samples: HKQuantitySample[],
  splitId?: string
): StrokeSample[] {
  return samples.map((sample) => ({
    id: uuid.v4() as string,
    workout_id: workoutId,
    split_id: splitId || null,
    timestamp: new Date(sample.startDate).getTime(),
    stroke_count: Math.round(sample.value),
  }));
}

/**
 * Parse heart rate samples into our format
 */
export function parseHeartRateSamples(
  workoutId: string,
  samples: HKQuantitySample[]
): HeartRateSample[] {
  return samples.map((sample) => ({
    id: uuid.v4() as string,
    workout_id: workoutId,
    timestamp: new Date(sample.startDate).getTime(),
    heart_rate: Math.round(sample.value),
  }));
}

/**
 * Calculate pace in seconds per 100 meters
 */
function calculatePace(distanceMeters: number, durationSeconds: number): number {
  if (distanceMeters === 0) return 0;
  return (durationSeconds / distanceMeters) * 100;
}

/**
 * Calculate SWOLF score
 * SWOLF = stroke count + seconds for the length
 */
function calculateSwolf(strokeCount: number, durationSeconds: number): number {
  return strokeCount + Math.round(durationSeconds);
}

/**
 * Parse distance samples into splits
 * This is a heuristic approach since HealthKit doesn't always provide clear lap markers
 */
export function parseDistanceSamplesIntoSplits(
  workoutId: string,
  distanceSamples: HKQuantitySample[],
  strokeSamples: HKQuantitySample[],
  heartRateSamples: HKQuantitySample[],
  poolLengthMeters: number = 25
): Split[] {
  if (distanceSamples.length === 0) {
    return [];
  }

  const splits: Split[] = [];
  let cumulativeDistance = 0;

  distanceSamples.forEach((sample, index) => {
    const startTime = new Date(sample.startDate).getTime();
    const endTime = new Date(sample.endDate).getTime();
    const durationSeconds = (endTime - startTime) / 1000;
    const distanceMeters = sample.value;

    cumulativeDistance += distanceMeters;

    // Find stroke counts in this time range
    const relevantStrokes = strokeSamples.filter((s) => {
      const sTime = new Date(s.startDate).getTime();
      return sTime >= startTime && sTime <= endTime;
    });

    const totalStrokes = relevantStrokes.reduce((sum, s) => sum + s.value, 0);

    // Find heart rates in this time range
    const relevantHR = heartRateSamples.filter((hr) => {
      const hrTime = new Date(hr.startDate).getTime();
      return hrTime >= startTime && hrTime <= endTime;
    });

    const avgHeartRate =
      relevantHR.length > 0
        ? Math.round(
            relevantHR.reduce((sum, hr) => sum + hr.value, 0) / relevantHR.length
          )
        : null;

    const maxHeartRate =
      relevantHR.length > 0
        ? Math.round(Math.max(...relevantHR.map((hr) => hr.value)))
        : null;

    const split: Split = {
      id: uuid.v4() as string,
      workout_id: workoutId,
      split_number: index + 1,
      start_time: startTime,
      end_time: endTime,
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      stroke_count: totalStrokes > 0 ? Math.round(totalStrokes) : null,
      avg_heart_rate: avgHeartRate,
      max_heart_rate: maxHeartRate,
      swolf_score:
        totalStrokes > 0 ? calculateSwolf(totalStrokes, durationSeconds) : null,
      pace_per_100m_seconds: calculatePace(distanceMeters, durationSeconds),
    };

    splits.push(split);
  });

  return splits;
}

/**
 * Parse all workout data (workout + splits + samples)
 */
export interface ParsedWorkoutData {
  workout: Workout;
  splits: Split[];
  strokeSamples: StrokeSample[];
  heartRateSamples: HeartRateSample[];
}

export function parseCompleteWorkoutData(
  hkWorkout: HKWorkout,
  distanceSamples: HKQuantitySample[],
  strokeSamples: HKQuantitySample[],
  heartRateSamples: HKQuantitySample[]
): ParsedWorkoutData {
  const workout = parseWorkout(
    hkWorkout,
    distanceSamples.length > 0,
    strokeSamples.length > 0,
    heartRateSamples.length > 0
  );

  const splits = parseDistanceSamplesIntoSplits(
    workout.id,
    distanceSamples,
    strokeSamples,
    heartRateSamples,
    workout.pool_length_meters || 25
  );

  return {
    workout,
    splits,
    strokeSamples: parseStrokeSamples(workout.id, strokeSamples),
    heartRateSamples: parseHeartRateSamples(workout.id, heartRateSamples),
  };
}
