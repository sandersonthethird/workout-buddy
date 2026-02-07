/**
 * Workout Formatting Utilities
 *
 * Functions to format workout data for display in the UI
 */

/**
 * Format duration in seconds to h:mm:ss or mm:ss
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format pace in seconds per 100yd/m to mm:ss/100yd or mm:ss/100m
 */
export function formatPace(seconds: number, unit: 'yd' | 'm'): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}/100${unit}`;
}

/**
 * Format distance in meters to yards or meters with unit
 */
export function formatDistance(meters: number, unit: 'yd' | 'm'): string {
  if (unit === 'yd') {
    const yards = Math.round(meters / 0.9144);
    return `${yards} yd`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Format pool length with unit
 */
export function formatPoolLength(meters: number | null, unit: 'yd' | 'm' | null): string {
  if (!meters || !unit) return 'N/A';

  if (unit === 'yd') {
    const yards = Math.round(meters / 0.9144);
    return `${yards} yd`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Format date to readable format
 */
export function formatWorkoutDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Calculate average pace from duration and distance
 */
export function calculateAvgPace(durationSeconds: number, distanceMeters: number, unit: 'yd' | 'm'): number {
  if (distanceMeters === 0) return 0;

  const targetDistance = unit === 'yd' ? 100 * 0.9144 : 100; // 100yd or 100m in meters
  return (durationSeconds / distanceMeters) * targetDistance;
}

/**
 * Format heart rate value with unit
 */
export function formatHeartRate(bpm: number | null): string {
  if (bpm === null || bpm === undefined) return '--';
  return `${Math.round(bpm)} bpm`;
}
