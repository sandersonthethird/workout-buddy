import AppleHealthKit from 'react-native-health';
import { Platform } from 'react-native';
import { HK_PERMISSIONS } from '@/types/healthkit';

// Type definitions for react-native-health
type HealthKitPermissions = {
  permissions: {
    read: string[];
    write: string[];
  };
};

/**
 * HealthKit Permissions Manager
 *
 * Handles requesting and checking HealthKit permissions.
 */

const REQUIRED_PERMISSIONS: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.Workout,
      AppleHealthKit.Constants.Permissions.DistanceSwimming,
      AppleHealthKit.Constants.Permissions.SwimmingStrokeCount,
      AppleHealthKit.Constants.Permissions.HeartRate,
      AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
    ],
    write: [], // We don't write to HealthKit
  },
};

/**
 * Initialize HealthKit
 * Must be called before any other HealthKit operations
 */
export async function initHealthKit(): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    console.warn('HealthKit is only available on iOS');
    return false;
  }

  return new Promise((resolve) => {
    AppleHealthKit.initHealthKit(REQUIRED_PERMISSIONS, (error: string) => {
      if (error) {
        console.error('Failed to initialize HealthKit:', error);
        resolve(false);
      } else {
        console.log('HealthKit initialized successfully');
        resolve(true);
      }
    });
  });
}

/**
 * Check if HealthKit is available on this device
 */
export function isHealthKitAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    AppleHealthKit.isAvailable((error: Object, available: boolean) => {
      if (error) {
        console.error('Error checking HealthKit availability:', error);
        resolve(false);
      } else {
        resolve(available);
      }
    });
  });
}

/**
 * Request HealthKit permissions
 * Shows iOS permission dialog to user
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  const available = await isHealthKitAvailable();

  if (!available) {
    console.warn('HealthKit not available on this device');
    return false;
  }

  return await initHealthKit();
}

/**
 * Check authorization status for a specific permission
 * Note: iOS doesn't allow apps to check if read permissions were granted
 * We can only check if the permission was requested
 */
export function getAuthorizationStatus(
  permission: string
): Promise<'authorized' | 'denied' | 'notDetermined'> {
  return new Promise((resolve) => {
    AppleHealthKit.getAuthStatus(
      REQUIRED_PERMISSIONS,
      (error: Object, result: any) => {
        if (error) {
          console.error('Error getting auth status:', error);
          resolve('notDetermined');
        } else {
          // The result format varies, we'll do our best to interpret it
          resolve('notDetermined'); // iOS doesn't let us check read permissions
        }
      }
    );
  });
}
