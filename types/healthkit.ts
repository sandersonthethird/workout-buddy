/**
 * HealthKit Type Definitions
 *
 * Type definitions for react-native-health (RNAppleHealthKit)
 */

export interface HealthKitPermissions {
  read: string[];
  write?: string[];
}

export interface HKWorkoutEvent {
  eventType: string; // 'HKWorkoutEventTypeLap' | 'HKWorkoutEventTypeSegment'
  eventTypeInt: number;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
}

export interface HKWorkout {
  id: string;
  uuid: string;
  activityId: number;
  activityName: string;
  calories: number;
  tracked: boolean;
  metadata?: Record<string, any>;
  sourceName: string;
  sourceId: string;
  device?: string;
  start: string; // ISO date string
  end: string; // ISO date string
  duration: number; // seconds
  distance?: number; // meters
  workoutEvents?: HKWorkoutEvent[]; // Lap and segment data
}

export interface HKQuantitySample {
  id: string;
  uuid: string;
  value: number;
  startDate: string;
  endDate: string;
  metadata?: Record<string, any>;
  sourceName: string;
  sourceId: string;
}

export interface HKSwimmingWorkoutMetadata {
  HKSwimmingLocationType?: number; // 1 = pool, 2 = open water
  HKSwimmingStrokeStyle?: number; // See HKSwimmingStrokeStyle below
  HKLapLength?: { unit: string; quantity: number };
}

export enum HKSwimmingLocationType {
  Unknown = 0,
  Pool = 1,
  OpenWater = 2,
}

// Values match Apple's HKSwimmingStrokeStyle exactly — do not renumber.
// https://developer.apple.com/documentation/healthkit/hkswimmingstrokestyle
export enum HKSwimmingStrokeStyle {
  Unknown = 0,
  Mixed = 1,
  Freestyle = 2,
  Backstroke = 3,
  Breaststroke = 4,
  Butterfly = 5,
  Kickboard = 6,
}

// HealthKit Constants
export const HK_WORKOUT_ACTIVITY_TYPE_SWIMMING = 46;
export const HK_WORKOUT_ACTIVITY_TYPE_LAP_SWIMMING = 82;

// HealthKit Permission Constants
export const HK_PERMISSIONS = {
  WORKOUTS: 'Workout',
  DISTANCE_SWIMMING: 'DistanceSwimming',
  SWIMMING_STROKE_COUNT: 'SwimmingStrokeCount',
  HEART_RATE: 'HeartRate',
  ACTIVE_ENERGY_BURNED: 'ActiveEnergyBurned',
} as const;
