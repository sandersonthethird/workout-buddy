/**
 * Type definitions for workout-related data models
 */

export interface Workout {
  id: string;
  healthkit_uuid: string;
  start_date: number; // Unix timestamp
  end_date: number; // Unix timestamp
  duration_seconds: number;
  total_distance_meters: number;
  total_energy_kcal: number | null;
  pool_length_meters: number | null;
  pool_length_unit: 'yd' | 'm' | null; // Unit of measurement for pool length
  location_type: 'pool' | 'open_water' | null;
  source_app: string | null;
  data_quality: number; // 0-3 rating
  synced_to_cloud: number; // 0 or 1 (boolean)
  created_at: number; // Unix timestamp
  updated_at: number; // Unix timestamp
}

export interface Segment {
  id: string;
  workout_id: string;
  segment_number: number;
  start_time: number; // Unix timestamp
  end_time: number; // Unix timestamp
  lap_count: number;
  total_distance_meters: number | null;
  total_duration_seconds: number | null; // Total segment time (swim + rest)
  swim_duration_seconds: number | null; // Active swimming time only
  rest_duration_seconds: number | null; // Rest/pause time within segment
  avg_pace_per_100m_seconds: number | null;
}

export interface Lap {
  id: string;
  workout_id: string;
  lap_number: number;
  start_time: number; // Unix timestamp
  end_time: number; // Unix timestamp
  distance_meters: number;
  duration_seconds: number;
  stroke_style: StrokeStyle | null;
  stroke_count: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  swolf_score: number | null;
  pace_per_100m_seconds: number | null;
  segment_id: string | null;
}

export interface StrokeSample {
  id: string;
  workout_id: string;
  lap_id: string | null;
  timestamp: number; // Unix timestamp
  stroke_count: number;
}

export interface HeartRateSample {
  id: string;
  workout_id: string;
  timestamp: number; // Unix timestamp
  heart_rate: number;
}

export interface SyncState {
  key: string;
  value: string;
  updated_at: number; // Unix timestamp
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  query_sql: string | null;
  created_at: number; // Unix timestamp
}

export type StrokeStyle =
  | 'freestyle'
  | 'backstroke'
  | 'breaststroke'
  | 'butterfly'
  | 'mixed'
  | 'kickboard';

export interface WorkoutWithLaps extends Workout {
  laps: Lap[];
}

export interface WorkoutWithSegments extends Workout {
  segments: Segment[];
}

export interface SegmentWithLaps extends Segment {
  laps: Lap[];
}

export interface WorkoutWithAllData extends WorkoutWithLaps {
  segments: Segment[];
  stroke_samples: StrokeSample[];
  heart_rate_samples: HeartRateSample[];
}

/**
 * Query filters for workouts
 */
export interface WorkoutFilters {
  startDate?: Date;
  endDate?: Date;
  strokeStyle?: StrokeStyle;
  locationType?: 'pool' | 'open_water';
  minDistance?: number;
  maxDistance?: number;
  limit?: number;
  offset?: number;
}

/**
 * Import progress tracking
 */
export interface ImportProgress {
  currentWorkout: number;
  totalWorkouts: number;
  currentChunk: string; // Date range being processed
  percentage: number;
  status: 'idle' | 'importing' | 'completed' | 'error';
  error?: string;
}
