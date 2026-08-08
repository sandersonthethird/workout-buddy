import uuid from 'react-native-uuid';
import {
  HKWorkout,
  HKWorkoutEvent,
  HKQuantitySample,
  HKSwimmingLocationType,
  HKSwimmingStrokeStyle,
  HKSwimmingWorkoutMetadata,
} from '@/types/healthkit';
import {
  Workout,
  Segment,
  Lap,
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
 * Map HealthKit's HKSwimmingStrokeStyle metadata value to our stroke style.
 * Unknown (0) and unrecognized values become null.
 */
const STROKE_STYLE_BY_HK_VALUE: Record<number, StrokeStyle> = {
  [HKSwimmingStrokeStyle.Mixed]: 'mixed',
  [HKSwimmingStrokeStyle.Freestyle]: 'freestyle',
  [HKSwimmingStrokeStyle.Backstroke]: 'backstroke',
  [HKSwimmingStrokeStyle.Breaststroke]: 'breaststroke',
  [HKSwimmingStrokeStyle.Butterfly]: 'butterfly',
  [HKSwimmingStrokeStyle.Kickboard]: 'kickboard',
};

export function strokeStyleFromHKValue(value: unknown): StrokeStyle | null {
  return typeof value === 'number' ? STROKE_STYLE_BY_HK_VALUE[value] ?? null : null;
}

/**
 * Parse stroke style from HealthKit metadata
 */
function parseStrokeStyle(metadata?: HKSwimmingWorkoutMetadata): StrokeStyle | null {
  return strokeStyleFromHKValue(metadata?.HKSwimmingStrokeStyle);
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
 * Returns both the length in meters and the original unit
 */
function parsePoolLength(metadata?: HKSwimmingWorkoutMetadata): { meters: number; unit: 'yd' | 'm' } | null {
  if (!metadata?.HKLapLength) {
    return null;
  }

  const { unit, quantity } = metadata.HKLapLength;

  // Normalize unit and convert to meters
  if (unit === 'yd' || unit === 'yard') {
    return {
      meters: quantity * 0.9144, // yards to meters
      unit: 'yd'
    };
  }

  return {
    meters: quantity,
    unit: 'm'
  };
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
  const poolLength = parsePoolLength(metadata);

  return {
    id: uuid.v4() as string,
    healthkit_uuid: hkWorkout.uuid,
    start_date: new Date(hkWorkout.start).getTime(),
    end_date: new Date(hkWorkout.end).getTime(),
    duration_seconds: hkWorkout.duration,
    total_distance_meters: hkWorkout.distance || 0,
    total_energy_kcal: hkWorkout.calories || null,
    pool_length_meters: poolLength?.meters || null,
    pool_length_unit: poolLength?.unit || null,
    location_type: parseLocationType(metadata),
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
  lapId?: string
): StrokeSample[] {
  return samples
    .filter((sample) => {
      const timestamp = new Date(sample.startDate).getTime();
      if (isNaN(timestamp) || !sample.startDate) {
        console.warn('[parseStrokeSamples] Invalid timestamp for sample:', sample);
        return false;
      }
      // stroke_count is NOT NULL; drop samples with a missing/NaN value so the
      // insert doesn't fail the whole import transaction.
      if (!Number.isFinite(sample.value)) {
        console.warn('[parseStrokeSamples] Missing stroke value for sample:', sample);
        return false;
      }
      return true;
    })
    .map((sample) => ({
      id: uuid.v4() as string,
      workout_id: workoutId,
      lap_id: lapId || null,
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
  return samples
    .filter((sample) => {
      const timestamp = new Date(sample.startDate).getTime();
      // timestamp and heart_rate are both NOT NULL; drop samples missing either.
      if (isNaN(timestamp) || !sample.startDate) {
        console.warn('[parseHeartRateSamples] Invalid timestamp for sample:', sample);
        return false;
      }
      if (!Number.isFinite(sample.value)) {
        console.warn('[parseHeartRateSamples] Missing heart rate value for sample:', sample);
        return false;
      }
      return true;
    })
    .map((sample) => ({
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
 * Parse distance samples into laps
 * This is a heuristic approach since HealthKit doesn't always provide clear lap markers
 */
export function parseDistanceSamplesIntoLaps(
  workoutId: string,
  distanceSamples: HKQuantitySample[],
  strokeSamples: HKQuantitySample[],
  heartRateSamples: HKQuantitySample[],
  poolLengthMeters: number = 25
): Lap[] {
  if (distanceSamples.length === 0) {
    return [];
  }

  const laps: Lap[] = [];
  let cumulativeDistance = 0;

  distanceSamples.forEach((sample, index) => {
    const startTime = new Date(sample.startDate).getTime();
    const endTime = new Date(sample.endDate).getTime();

    // Skip invalid timestamps
    if (isNaN(startTime) || isNaN(endTime) || !sample.startDate || !sample.endDate) {
      console.warn(`Skipping split ${index + 1}: invalid timestamps`, sample);
      return;
    }

    // distance_meters is NOT NULL; skip splits with a missing/NaN distance.
    if (!Number.isFinite(sample.value)) {
      console.warn(`Skipping split ${index + 1}: invalid distance value`, sample);
      return;
    }

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

    const lap: Lap = {
      id: uuid.v4() as string,
      workout_id: workoutId,
      lap_number: index + 1,
      start_time: startTime,
      end_time: endTime,
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      stroke_style: null, // Will be populated from workout events if available
      stroke_count: totalStrokes > 0 ? Math.round(totalStrokes) : null,
      avg_heart_rate: avgHeartRate,
      max_heart_rate: maxHeartRate,
      swolf_score:
        totalStrokes > 0 ? calculateSwolf(totalStrokes, durationSeconds) : null,
      pace_per_100m_seconds: calculatePace(distanceMeters, durationSeconds),
      segment_id: null, // Will be populated when linking to segments
    };

    laps.push(lap);
  });

  return laps;
}

/**
 * A segment event marks one interval set. Apple emits either spelling.
 */
function isSegmentEvent(event: HKWorkoutEvent): boolean {
  return event.eventType === 'segment' || event.eventType === 'HKWorkoutEventTypeSegment';
}

/**
 * Time ranges of the workout's segments (interval sets), used to keep rest
 * between sets from being counted as lap time.
 */
function parseSegmentRanges(
  workoutEvents: HKWorkoutEvent[]
): Array<{ start: number; end: number }> {
  return workoutEvents
    .filter(isSegmentEvent)
    .map((event) => ({
      start: new Date(event.startDate).getTime(),
      end: new Date(event.endDate).getTime(),
    }))
    .filter((range) => !isNaN(range.start) && !isNaN(range.end));
}

/**
 * Parse segments from workout events
 */
export function parseSegments(
  workoutId: string,
  workoutEvents: HKWorkoutEvent[]
): Segment[] {
  const segmentEvents = workoutEvents.filter(isSegmentEvent);

  return segmentEvents.map((event, index) => {
    const startTime = new Date(event.startDate).getTime();
    const endTime = new Date(event.endDate).getTime();
    const durationSeconds = (endTime - startTime) / 1000;

    return {
      id: uuid.v4() as string,
      workout_id: workoutId,
      segment_number: index + 1,
      start_time: startTime,
      end_time: endTime,
      lap_count: 0, // Will be calculated when linking laps
      total_distance_meters: null,
      total_duration_seconds: durationSeconds,
      swim_duration_seconds: null, // Will be calculated from sum of lap event durations
      rest_duration_seconds: null, // Will be calculated from pause events
      avg_pace_per_100m_seconds: null,
    };
  });
}

/**
 * Parse laps from workout events (HKWorkoutEventTypeLap)
 * This extracts lap-by-lap data directly from HealthKit's workout events
 */
export function parseLapsFromWorkoutEvents(
  workoutId: string,
  workoutEvents: HKWorkoutEvent[],
  heartRateSamples: HKQuantitySample[],
  poolLengthMeters: number | null,
  strokeSamples?: HKQuantitySample[],
  workoutStartTime?: number,
  workoutEndTime?: number
): Lap[] {
  const lapEvents = workoutEvents.filter(
    (event) => event.eventType === 'lap' || event.eventType === 'HKWorkoutEventTypeLap'
  );

  if (lapEvents.length === 0) {
    return [];
  }

  // Parse all laps first with their event durations
  const parsedLaps = lapEvents.map((event, index) => {
    const startTime = new Date(event.startDate).getTime();
    const endTime = new Date(event.endDate).getTime();
    const durationSeconds = (endTime - startTime) / 1000; // Calculate from date range

    // Calculate distance based on pool length (if available)
    const distanceMeters = poolLengthMeters || 25; // Default to 25m if not specified

    // Find stroke samples in this lap's time range
    const relevantStrokes = (strokeSamples || []).filter((s) => {
      const sTime = new Date(s.startDate).getTime();
      return sTime >= startTime && sTime <= endTime;
    });

    // Sum total strokes and extract stroke style from metadata
    const totalStrokes = relevantStrokes.reduce((sum, s) => sum + s.value, 0);

    const strokeStyle = strokeStyleFromHKValue(
      relevantStrokes[0]?.metadata?.HKSwimmingStrokeStyle
    );

    // Provisional SWOLF; recomputed below once duration_seconds is final.
    const swolfScore =
      totalStrokes > 0 ? calculateSwolf(Math.round(totalStrokes), durationSeconds) : null;

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

    const lap: Lap = {
      id: uuid.v4() as string,
      workout_id: workoutId,
      lap_number: index + 1,
      start_time: startTime,
      end_time: endTime,
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      stroke_style: strokeStyle,
      stroke_count: totalStrokes > 0 ? Math.round(totalStrokes) : null,
      avg_heart_rate: avgHeartRate,
      max_heart_rate: maxHeartRate,
      swolf_score: swolfScore,
      pace_per_100m_seconds: calculatePace(distanceMeters, durationSeconds),
      segment_id: null, // Will be populated when linking to segments
    };

    return lap;
  });

  // Adjust lap durations to include gaps (wall touch, turn, glide time)
  // But exclude paused time - this matches Apple Fitness behavior
  if (workoutStartTime && workoutEndTime) {
    // Extract pause/resume events to exclude paused time from gaps
    const pauseEvents = workoutEvents.filter(e =>
      e.eventType === 'pause' || e.eventType === 'HKWorkoutEventTypePause' ||
      e.eventType === 'motion paused' || e.eventType === 'HKWorkoutEventTypeMotionPaused'
    );
    const resumeEvents = workoutEvents.filter(e =>
      e.eventType === 'resume' || e.eventType === 'HKWorkoutEventTypeResume' ||
      e.eventType === 'motion resumed' || e.eventType === 'HKWorkoutEventTypeMotionResumed'
    );

    // Calculate total paused time in a given time range
    const calculatePausedTime = (rangeStart: number, rangeEnd: number): number => {
      let totalPausedMs = 0;

      pauseEvents.forEach((pauseEvent, idx) => {
        const pauseStart = new Date(pauseEvent.startDate).getTime();
        const resumeEvent = resumeEvents.find((r, rIdx) =>
          rIdx >= idx && new Date(r.startDate).getTime() > pauseStart
        );
        const pauseEnd = resumeEvent ? new Date(resumeEvent.startDate).getTime() : rangeEnd;

        // Check if pause overlaps with our time range
        if (pauseStart < rangeEnd && pauseEnd > rangeStart) {
          const overlapStart = Math.max(pauseStart, rangeStart);
          const overlapEnd = Math.min(pauseEnd, rangeEnd);
          totalPausedMs += (overlapEnd - overlapStart);
        }
      });

      return totalPausedMs / 1000; // Convert to seconds
    };

    // Segment (interval set) ranges, so a lap is never stretched past the end
    // of its own set. Apple Watch pool swims record rest as an absence of laps,
    // not as a pause event, so without this bound the whole rest interval is
    // added to the last lap of the set — inflating its time, SWOLF and pace.
    // Rest belongs to segment.rest_duration_seconds, which is computed
    // separately in parseCompleteWorkoutData.
    const segmentRanges = parseSegmentRanges(workoutEvents);
    const segmentForLap = (lap: Lap) =>
      segmentRanges.find(
        (range) => lap.start_time >= range.start && lap.end_time <= range.end
      );

    // Add the time between rangeStart and rangeEnd that was not paused.
    const activeSpanSeconds = (rangeStart: number, rangeEnd: number): number => {
      const spanSeconds = (rangeEnd - rangeStart) / 1000;
      if (spanSeconds <= 0) return 0;
      return Math.max(0, spanSeconds - calculatePausedTime(rangeStart, rangeEnd));
    };

    parsedLaps.forEach((lap, index) => {
      const segment = segmentForLap(lap);

      // Extend the lap to the next lap, but never beyond its own set.
      const nextLapStartTime = index < parsedLaps.length - 1
        ? parsedLaps[index + 1].start_time
        : workoutEndTime;
      const lapWindowEnd = Math.min(
        nextLapStartTime,
        segment ? segment.end : workoutEndTime
      );

      // Wall touch, turn and glide time up to that bound
      lap.duration_seconds += activeSpanSeconds(lap.end_time, lapWindowEnd);

      // For the first lap, also include the run-up to it — but no earlier than
      // its own set started, so pre-swim idle time stays out of the lap.
      if (index === 0) {
        const lapWindowStart = Math.max(
          workoutStartTime,
          segment ? segment.start : workoutStartTime
        );
        lap.duration_seconds += activeSpanSeconds(lapWindowStart, lap.start_time);
      }
    });
  }

  // duration_seconds is only final now that the gap adjustment above has run,
  // so recompute everything derived from it. Computing these in the map above
  // froze them at the raw lap-event duration, which left SWOLF and pace
  // disagreeing with the lap time stored on the same row.
  parsedLaps.forEach((lap) => {
    lap.swolf_score =
      lap.stroke_count && lap.stroke_count > 0
        ? calculateSwolf(lap.stroke_count, lap.duration_seconds)
        : null;
    lap.pace_per_100m_seconds = calculatePace(lap.distance_meters, lap.duration_seconds);
  });

  return parsedLaps;
}

/**
 * Parse all workout data (workout + laps + segments + samples)
 */
export interface ParsedWorkoutData {
  workout: Workout;
  laps: Lap[];
  segments: Segment[];
  strokeSamples: StrokeSample[];
  heartRateSamples: HeartRateSample[];
}

export function parseCompleteWorkoutData(
  hkWorkout: HKWorkout,
  distanceSamples: HKQuantitySample[],
  strokeSamples: HKQuantitySample[],
  heartRateSamples: HKQuantitySample[]
): ParsedWorkoutData {
  // Try to parse laps from workout events first (more reliable)
  let laps: Lap[] = [];
  let hasSplits = false;

  if (hkWorkout.workoutEvents && hkWorkout.workoutEvents.length > 0) {
    const metadata = hkWorkout.metadata as HKSwimmingWorkoutMetadata | undefined;
    let poolLength = parsePoolLength(metadata);

    // If pool length is not in metadata, default to 25 yards (common US pool)
    if (!poolLength) {
      poolLength = {
        meters: 25 * 0.9144, // 25 yards = 22.86 meters
        unit: 'yd'
      };
    }

    laps = parseLapsFromWorkoutEvents(
      '', // Will be replaced with actual workout ID below
      hkWorkout.workoutEvents,
      heartRateSamples,
      poolLength.meters,
      strokeSamples,
      new Date(hkWorkout.start).getTime(),
      new Date(hkWorkout.end).getTime()
    );
    hasSplits = laps.length > 0;
  }

  // Fallback to distance samples if no workout events
  if (laps.length === 0 && distanceSamples.length > 0) {
    laps = parseDistanceSamplesIntoLaps(
      '', // Will be replaced with actual workout ID below
      distanceSamples,
      strokeSamples,
      heartRateSamples,
      25 // Default pool length
    );
    hasSplits = laps.length > 0;
  }

  const workout = parseWorkout(
    hkWorkout,
    hasSplits,
    strokeSamples.length > 0,
    heartRateSamples.length > 0
  );

  // Parse segments from workout events if available
  const segments = hkWorkout.workoutEvents
    ? parseSegments(workout.id, hkWorkout.workoutEvents)
    : [];

  // Update workout IDs and link laps to segments
  laps.forEach(lap => {
    lap.workout_id = workout.id;

    // Find which segment this lap belongs to based on time range
    const lapSegment = segments.find(segment =>
      lap.start_time >= segment.start_time &&
      lap.end_time <= segment.end_time
    );

    if (lapSegment) {
      lap.segment_id = lapSegment.id;
    }
  });

  // Recalculate segment durations and distances from adjusted lap durations
  // Also calculate swim vs rest time breakdown (matches Apple Fitness behavior)

  // Extract pause/resume events for calculating rest time
  const pauseEvents = (hkWorkout.workoutEvents || []).filter(e =>
    e.eventType === 'pause' || e.eventType === 'HKWorkoutEventTypePause' ||
    e.eventType === 'motion paused' || e.eventType === 'HKWorkoutEventTypeMotionPaused'
  );
  const resumeEvents = (hkWorkout.workoutEvents || []).filter(e =>
    e.eventType === 'resume' || e.eventType === 'HKWorkoutEventTypeResume' ||
    e.eventType === 'motion resumed' || e.eventType === 'HKWorkoutEventTypeMotionResumed'
  );

  // Helper function to calculate paused time within a time range
  const calculatePausedTimeInRange = (rangeStart: number, rangeEnd: number): number => {
    let totalPausedMs = 0;

    pauseEvents.forEach((pauseEvent, idx) => {
      const pauseStart = new Date(pauseEvent.startDate).getTime();
      const resumeEvent = resumeEvents.find((r, rIdx) =>
        rIdx >= idx && new Date(r.startDate).getTime() > pauseStart
      );
      const pauseEnd = resumeEvent ? new Date(resumeEvent.startDate).getTime() : rangeEnd;

      // Check if pause overlaps with our time range
      if (pauseStart < rangeEnd && pauseEnd > rangeStart) {
        const overlapStart = Math.max(pauseStart, rangeStart);
        const overlapEnd = Math.min(pauseEnd, rangeEnd);
        totalPausedMs += (overlapEnd - overlapStart);
      }
    });

    return totalPausedMs / 1000; // Convert to seconds
  };

  segments.forEach((segment, index) => {
    const segmentLaps = laps.filter(lap => lap.segment_id === segment.id);

    if (segmentLaps.length > 0) {
      // Find the next segment's start time (or use workout end for last segment)
      const nextSegment = segments[index + 1];
      const nextSegmentStartTime = nextSegment ? nextSegment.start_time : new Date(hkWorkout.end).getTime();

      // Swim duration: time from segment start to segment end (active swimming + wall touches)
      segment.swim_duration_seconds = (segment.end_time - segment.start_time) / 1000;

      // Rest duration: ALL time from segment end until next segment starts
      // This matches Apple Fitness behavior - includes pause time AND gaps before/after pause
      segment.rest_duration_seconds = (nextSegmentStartTime - segment.end_time) / 1000;

      // Total duration: swim time + rest time
      segment.total_duration_seconds = segment.swim_duration_seconds + segment.rest_duration_seconds;

      // Update distance and lap count
      segment.total_distance_meters = segmentLaps.reduce((sum, lap) => sum + lap.distance_meters, 0);
      segment.lap_count = segmentLaps.length;
    }
  });

  // Calculate total distance from laps if available (more accurate than workout.distance)
  if (laps.length > 0) {
    const totalDistanceFromLaps = laps.reduce((sum, lap) => sum + lap.distance_meters, 0);
    workout.total_distance_meters = totalDistanceFromLaps;

    // Set pool length on workout if we parsed it from workoutEvents
    const metadata = hkWorkout.metadata as HKSwimmingWorkoutMetadata | undefined;
    let poolLength = parsePoolLength(metadata);
    if (!poolLength) {
      // Default to 25 yards
      poolLength = {
        meters: 25 * 0.9144,
        unit: 'yd'
      };
    }
    workout.pool_length_meters = poolLength.meters;
    workout.pool_length_unit = poolLength.unit;
  }

  return {
    workout,
    laps,
    segments,
    strokeSamples: parseStrokeSamples(workout.id, strokeSamples),
    heartRateSamples: parseHeartRateSamples(workout.id, heartRateSamples),
  };
}
