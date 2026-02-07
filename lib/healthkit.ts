import AppleHealthKit from 'react-native-health';
import { Platform } from 'react-native';
import {
  initHealthKit,
  requestHealthKitPermissions,
  isHealthKitAvailable,
} from '@/services/healthkit/permissions';

/**
 * HealthKit Core Module
 *
 * Central module for all HealthKit operations.
 * Provides a simplified, type-safe interface to react-native-health.
 */

export { initHealthKit, requestHealthKitPermissions, isHealthKitAvailable };

// Re-export AppleHealthKit for direct access when needed
export { AppleHealthKit };

/**
 * Check if HealthKit is supported on this platform
 */
export function isHealthKitSupported(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Get the underlying HealthKit library
 * Useful for advanced operations not wrapped by our API
 */
export function getHealthKitLibrary() {
  return AppleHealthKit;
}
