-- Workout Buddy - Initial Supabase Schema
-- This migration creates all tables for cloud sync functionality

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Workouts table
CREATE TABLE IF NOT EXISTS workouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  healthkit_uuid TEXT NOT NULL,
  start_date BIGINT NOT NULL,
  end_date BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  total_distance_meters REAL NOT NULL,
  total_energy_kcal REAL,
  pool_length_meters REAL,
  location_type TEXT CHECK (location_type IN ('pool', 'open_water')),
  stroke_style TEXT CHECK (stroke_style IN ('freestyle', 'backstroke', 'breaststroke', 'butterfly', 'mixed')),
  source_app TEXT,
  data_quality INTEGER DEFAULT 1 CHECK (data_quality BETWEEN 0 AND 3),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, healthkit_uuid)
);

-- Splits table
CREATE TABLE IF NOT EXISTS splits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  split_number INTEGER NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  distance_meters REAL NOT NULL,
  duration_seconds REAL NOT NULL,
  stroke_count INTEGER,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  swolf_score INTEGER,
  pace_per_100m_seconds REAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stroke samples table
CREATE TABLE IF NOT EXISTS stroke_samples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  split_id UUID REFERENCES splits(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  stroke_count INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Heart rate samples table
CREATE TABLE IF NOT EXISTS heart_rate_samples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  heart_rate INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat messages table (optional)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  query_sql TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_workouts_user_start_date ON workouts(user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_healthkit_uuid ON workouts(healthkit_uuid);
CREATE INDEX IF NOT EXISTS idx_splits_workout ON splits(workout_id, split_number);
CREATE INDEX IF NOT EXISTS idx_splits_user ON splits(user_id);
CREATE INDEX IF NOT EXISTS idx_stroke_samples_workout ON stroke_samples(workout_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_heart_rate_workout ON heart_rate_samples(workout_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at DESC);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE stroke_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE heart_rate_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Workouts policies
CREATE POLICY "Users can view own workouts"
  ON workouts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workouts"
  ON workouts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workouts"
  ON workouts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own workouts"
  ON workouts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Splits policies
CREATE POLICY "Users can view own splits"
  ON splits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own splits"
  ON splits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own splits"
  ON splits FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own splits"
  ON splits FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Stroke samples policies
CREATE POLICY "Users can view own stroke samples"
  ON stroke_samples FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stroke samples"
  ON stroke_samples FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Heart rate samples policies
CREATE POLICY "Users can view own heart rate samples"
  ON heart_rate_samples FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own heart rate samples"
  ON heart_rate_samples FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Chat messages policies
CREATE POLICY "Users can view own chat messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chat messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat messages"
  ON chat_messages FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_workouts_updated_at
  BEFORE UPDATE ON workouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE workouts IS 'Swim workout data synced from HealthKit';
COMMENT ON TABLE splits IS 'Individual laps/splits within workouts';
COMMENT ON TABLE stroke_samples IS 'High-resolution stroke count samples';
COMMENT ON TABLE heart_rate_samples IS 'Heart rate measurements during workouts';
COMMENT ON TABLE chat_messages IS 'Chat history for natural language queries';
