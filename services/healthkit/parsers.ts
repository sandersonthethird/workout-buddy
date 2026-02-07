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
 * Returns both the length in meters and the original unit
 */
function parsePoolLength(metadata?: HKSwimmingWorkoutMetadata): { meters: number; unit: 'yd' | 'm' } | null {
  console.log('[parsePoolLength] Raw metadata:', JSON.stringify(metadata));
  console.log('[parsePoolLength] Available metadata keys:', metadata ? Object.keys(metadata) : 'none');
  console.log('[parsePoolLength] HKLapLength value:', metadata?.HKLapLength);

  if (!metadata?.HKLapLength) {
    console.log('[parsePoolLength] No HKLapLength found in metadata');
    return null;
  }

  const { unit, quantity } = metadata.HKLapLength;
  console.log('[parsePoolLength] Lap length:', { unit, quantity });

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
 * Parse segments from workout events
 */
export function parseSegments(
  workoutId: string,
  workoutEvents: HKWorkoutEvent[]
): Segment[] {
  const segmentEvents = workoutEvents.filter(
    (event) => event.eventType === 'segment' || event.eventType === 'HKWorkoutEventTypeSegment'
  );

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
  console.log('[parseLapsFromWorkoutEvents] Total workout events:', workoutEvents.length);
  console.log('[parseLapsFromWorkoutEvents] Event types:', workoutEvents.map(e => e.eventType));
  console.log('[parseLapsFromWorkoutEvents] Stroke samples:', strokeSamples?.length || 0);

  const lapEvents = workoutEvents.filter(
    (event) => event.eventType === 'lap' || event.eventType === 'HKWorkoutEventTypeLap'
  );

  console.log('[parseLapsFromWorkoutEvents] Filtered lap events:', lapEvents.length);

  if (lapEvents.length === 0) {
    console.log('[parseLapsFromWorkoutEvents] No lap events found, returning empty array');
    return [];
  }

  console.log('[parseLapsFromWorkoutEvents] First lap event sample:', JSON.stringify(lapEvents[0], null, 2));

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

    // Debug logging for first few laps
    if (index < 3) {
      console.log(`[parseLapsFromWorkoutEvents] Lap ${index + 1} stroke matching:`, {
        lapStart: new Date(startTime).toISOString(),
        lapEnd: new Date(endTime).toISOString(),
        lapStartMs: startTime,
        lapEndMs: endTime,
        totalStrokeSamples: strokeSamples?.length || 0,
        relevantStrokeSamples: relevantStrokes.length,
        firstStrokeSample: strokeSamples && strokeSamples.length > 0 ? {
          startDate: strokeSamples[0].startDate,
          startDateMs: new Date(strokeSamples[0].startDate).getTime(),
          value: strokeSamples[0].value,
          metadata: strokeSamples[0].metadata
        } : 'none',
        lastStrokeSample: strokeSamples && strokeSamples.length > 0 ? {
          startDate: strokeSamples[strokeSamples.length - 1].startDate,
          startDateMs: new Date(strokeSamples[strokeSamples.length - 1].startDate).getTime(),
          value: strokeSamples[strokeSamples.length - 1].value
        } : 'none',
        relevantStrokeTimestamps: relevantStrokes.map(s => ({
          time: s.startDate,
          timeMs: new Date(s.startDate).getTime(),
          value: s.value
        }))
      });
    }

    // Sum total strokes and extract stroke style from metadata
    const totalStrokes = relevantStrokes.reduce((sum, s) => sum + s.value, 0);

    // Debug: Check what's in the metadata
    if (index < 3 && relevantStrokes.length > 0) {
      console.log(`[parseLapsFromWorkoutEvents] Lap ${index + 1} metadata:`, {
        metadata: relevantStrokes[0]?.metadata,
        metadataKeys: relevantStrokes[0]?.metadata ? Object.keys(relevantStrokes[0].metadata) : [],
        totalStrokes: totalStrokes,
        fullSample: JSON.stringify(relevantStrokes[0], null, 2)
      });
    }

    const strokeStyleId = relevantStrokes[0]?.metadata?.HKSwimmingStrokeStyle;

    // Debug: Log if stroke style is missing
    if (strokeStyleId === undefined && relevantStrokes.length > 0) {
      console.log(`[parseLapsFromWorkoutEvents] Lap ${index + 1}: No HKSwimmingStrokeStyle in metadata (totalStrokes=${totalStrokes}, duration=${durationSeconds}s)`);
    }

    // Map stroke style ID to our type
    // Reference: https://developer.apple.com/documentation/healthkit/hkswimmingstrokestyle
    const strokeStyleMap: Record<number, StrokeStyle> = {
      1: 'mixed',
      2: 'freestyle',
      3: 'backstroke',
      4: 'breaststroke',
      5: 'butterfly',
      6: 'kickboard',
    };
    const strokeStyle = strokeStyleId !== undefined ? (strokeStyleMap[strokeStyleId] || null) : null;

    // Calculate SWOLF if we have stroke count: SWOLF = strokes + seconds
    const swolfScore = totalStrokes > 0 ? Math.round(totalStrokes + durationSeconds) : null;

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

    parsedLaps.forEach((lap, index) => {
      const nextLapStartTime = index < parsedLaps.length - 1
        ? parsedLaps[index + 1].start_time
        : workoutEndTime;

      // Calculate gap time and subtract any paused time
      const gapMs = nextLapStartTime - lap.end_time;
      const pausedSeconds = calculatePausedTime(lap.end_time, nextLapStartTime);
      const activeGapSeconds = (gapMs / 1000) - pausedSeconds;

      // Only add active gap time (excludes pauses)
      lap.duration_seconds += Math.max(0, activeGapSeconds);

      // For first lap, also add time from workout start to lap start (excluding pauses)
      let preGapSeconds = 0;
      let preGapPausedSeconds = 0;
      if (index === 0) {
        const preGapMs = lap.start_time - workoutStartTime;
        preGapPausedSeconds = calculatePausedTime(workoutStartTime, lap.start_time);
        const activePreGapSeconds = (preGapMs / 1000) - preGapPausedSeconds;
        preGapSeconds = Math.max(0, activePreGapSeconds);
        lap.duration_seconds += preGapSeconds;
      }

      // Debug logging for first 3 laps
      if (index < 3) {
        console.log(`[parseLapsFromWorkoutEvents] Lap ${index + 1} duration adjustment:`, {
          originalDuration: ((lap.end_time - lap.start_time) / 1000).toFixed(3),
          totalGap: (gapMs / 1000).toFixed(3),
          pausedTime: pausedSeconds.toFixed(3),
          activeGap: activeGapSeconds.toFixed(3),
          preGap: preGapSeconds.toFixed(3),
          preGapPaused: preGapPausedSeconds.toFixed(3),
          finalDuration: lap.duration_seconds.toFixed(3)
        });
      }
    });
  }

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
  console.log('[Parser] Parsing workout:', {
    uuid: hkWorkout.uuid,
    distance: hkWorkout.distance,
    workoutEvents: hkWorkout.workoutEvents?.length || 0,
    distanceSamples: distanceSamples.length
  });

  // Try to parse laps from workout events first (more reliable)
  let laps: Lap[] = [];
  let hasSplits = false;

  if (hkWorkout.workoutEvents && hkWorkout.workoutEvents.length > 0) {
    const metadata = hkWorkout.metadata as HKSwimmingWorkoutMetadata | undefined;
    let poolLength = parsePoolLength(metadata);

    // If pool length is not in metadata, default to 25 yards (common US pool)
    if (!poolLength) {
      console.log('[Parser] No pool length in metadata, defaulting to 25 yards');
      poolLength = {
        meters: 25 * 0.9144, // 25 yards = 22.86 meters
        unit: 'yd'
      };
    }

    console.log('[Parser] Parsing laps from workoutEvents, pool length:', poolLength);
    console.log('[Parser] About to parse with stroke samples:', {
      strokeSampleCount: strokeSamples.length,
      firstStrokeSample: strokeSamples[0] ? {
        startDate: strokeSamples[0].startDate,
        endDate: strokeSamples[0].endDate,
        value: strokeSamples[0].value
      } : 'none',
      workoutEventCount: hkWorkout.workoutEvents.length,
      firstWorkoutEvent: hkWorkout.workoutEvents[0]
    });

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
    console.log('[Parser] Parsed', laps.length, 'laps from workoutEvents');
    console.log('[Parser] First 3 laps stroke counts:', laps.slice(0, 3).map(l => ({
      lap: l.lap_number,
      strokeCount: l.stroke_count,
      startTime: new Date(l.start_time).toISOString(),
      endTime: new Date(l.end_time).toISOString()
    })));
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

  // Debug: Log first few pause/resume events to understand their structure
  if (pauseEvents.length > 0) {
    console.log('[parseCompleteWorkoutData] First 3 pause events:', pauseEvents.slice(0, 3).map(e => ({
      eventType: e.eventType,
      startDate: e.startDate,
      startDateMs: new Date(e.startDate).getTime()
    })));
  }
  if (resumeEvents.length > 0) {
    console.log('[parseCompleteWorkoutData] First 3 resume events:', resumeEvents.slice(0, 3).map(e => ({
      eventType: e.eventType,
      startDate: e.startDate,
      startDateMs: new Date(e.startDate).getTime()
    })));
  }

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

      // Debug logging for first segment
      if (segment.segment_number === 1) {
        console.log('[parseCompleteWorkoutData] Segment 1 duration breakdown:', {
          segmentStartTime: segment.start_time,
          segmentEndTime: segment.end_time,
          nextSegmentStart: nextSegmentStartTime,
          restGap: (nextSegmentStartTime - segment.end_time) / 1000,
          swimTime: segment.swim_duration_seconds?.toFixed(2),
          restTime: segment.rest_duration_seconds?.toFixed(2),
          totalTime: segment.total_duration_seconds?.toFixed(2),
          lapCount: segment.lap_count
        });
      }
    }
  });

  // Calculate total distance from laps if available (more accurate than workout.distance)
  if (laps.length > 0) {
    const totalDistanceFromLaps = laps.reduce((sum, lap) => sum + lap.distance_meters, 0);
    workout.total_distance_meters = totalDistanceFromLaps;
    console.log('[Parser] Calculated distance from laps:', totalDistanceFromLaps);

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

  console.log('[Parser] Final workout:', {
    id: workout.id,
    distance: workout.total_distance_meters,
    laps: laps.length,
    segments: segments.length
  });

  return {
    workout,
    laps,
    segments,
    strokeSamples: parseStrokeSamples(workout.id, strokeSamples),
    heartRateSamples: parseHeartRateSamples(workout.id, heartRateSamples),
  };
}
