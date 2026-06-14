/**
 * Database Schema for Workout Buddy
 *
 * This file contains all SQL schema definitions for the local SQLite database.
 * The schema is designed to support:
 * - Efficient storage of HealthKit swim workout data
 * - Complex queries for the chat interface
 * - Offline-first architecture with cloud sync tracking
 */

export const CREATE_WORKOUTS_TABLE = `
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  healthkit_uuid TEXT UNIQUE NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  total_distance_meters REAL NOT NULL,
  total_energy_kcal REAL,
  pool_length_meters REAL,
  pool_length_unit TEXT,
  location_type TEXT,
  source_app TEXT,
  data_quality INTEGER DEFAULT 1,
  synced_to_cloud INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export const CREATE_SEGMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL,
  segment_number INTEGER NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  lap_count INTEGER NOT NULL,
  total_distance_meters REAL,
  total_duration_seconds REAL,
  swim_duration_seconds REAL,
  rest_duration_seconds REAL,
  avg_pace_per_100m_seconds REAL,
  FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);
`;

export const CREATE_LAPS_TABLE = `
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
`;

export const CREATE_STROKE_SAMPLES_TABLE = `
CREATE TABLE IF NOT EXISTS stroke_samples (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL,
  lap_id TEXT,
  timestamp INTEGER NOT NULL,
  stroke_count INTEGER NOT NULL,
  FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
  FOREIGN KEY (lap_id) REFERENCES laps(id) ON DELETE CASCADE
);
`;

export const CREATE_HEART_RATE_SAMPLES_TABLE = `
CREATE TABLE IF NOT EXISTS heart_rate_samples (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  heart_rate INTEGER NOT NULL,
  FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);
`;

export const CREATE_SYNC_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export const CREATE_CONVERSATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export const CREATE_CHAT_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  query_sql TEXT,
  created_at INTEGER NOT NULL
);
`;

// Indexes for performance optimization
export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_workouts_start_date ON workouts(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_synced ON workouts(synced_to_cloud);
CREATE INDEX IF NOT EXISTS idx_segments_workout ON segments(workout_id, segment_number);
CREATE INDEX IF NOT EXISTS idx_laps_workout ON laps(workout_id, lap_number);
CREATE INDEX IF NOT EXISTS idx_laps_segment ON laps(segment_id);
CREATE INDEX IF NOT EXISTS idx_stroke_samples_workout ON stroke_samples(workout_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_stroke_samples_lap ON stroke_samples(lap_id);
CREATE INDEX IF NOT EXISTS idx_heart_rate_workout ON heart_rate_samples(workout_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
`;

// All table creation statements in order
export const ALL_TABLES = [
  CREATE_WORKOUTS_TABLE,
  CREATE_SEGMENTS_TABLE,
  CREATE_LAPS_TABLE,
  CREATE_STROKE_SAMPLES_TABLE,
  CREATE_HEART_RATE_SAMPLES_TABLE,
  CREATE_SYNC_STATE_TABLE,
  CREATE_CONVERSATIONS_TABLE,
  CREATE_CHAT_MESSAGES_TABLE,
];

// Indexes are created separately, AFTER reconcileSchema() has added any columns
// missing from older databases — some indexes reference reconciled columns
// (e.g. chat_messages.conversation_id), so creating them too early fails.

// Database version for migrations
export const CURRENT_SCHEMA_VERSION = 4;
