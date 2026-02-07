import { useState, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { useDatabase } from '@/contexts/DatabaseContext';
import { requestHealthKitPermissions } from '@/services/healthkit/permissions';
import {
  querySwimWorkoutsPaginated,
  queryStrokeCountSamples,
  queryHeartRateSamples,
  queryDistanceSwimmingSamples,
} from '@/services/healthkit/queries';
import { parseCompleteWorkoutData } from '@/services/healthkit/parsers';
import {
  insertCompleteWorkoutData,
  workoutExistsByHealthKitUuid,
  getWorkoutCount,
} from '@/services/database/repositories/workout';

export interface SyncProgress {
  current: number;
  total: number;
  workoutsSynced: number;
  workoutsSkipped: number;
  status: 'requesting_permissions' | 'syncing' | 'complete' | 'error';
  message: string;
}

export interface UseHealthKitSyncResult {
  syncProgress: SyncProgress | null;
  isSyncing: boolean;
  totalWorkoutsInDB: number;
  startSync: () => Promise<void>;
  refreshWorkoutCount: () => Promise<void>;
}

/**
 * Hook for syncing HealthKit workout data to local database
 */
export function useHealthKitSync(): UseHealthKitSyncResult {
  const { db } = useDatabase();
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [totalWorkoutsInDB, setTotalWorkoutsInDB] = useState(0);

  // Refresh workout count from database
  const refreshWorkoutCount = useCallback(async () => {
    if (!db) return;
    try {
      const count = await getWorkoutCount(db);
      setTotalWorkoutsInDB(count);
    } catch (error) {
      console.error('Error getting workout count:', error);
    }
  }, [db]);

  // Main sync function
  const startSync = useCallback(async () => {
    if (!db) {
      Alert.alert('Error', 'Database not initialized');
      return;
    }

    if (Platform.OS !== 'ios') {
      Alert.alert('Error', 'HealthKit is only available on iOS');
      return;
    }

    setIsSyncing(true);
    setSyncProgress({
      current: 0,
      total: 0,
      workoutsSynced: 0,
      workoutsSkipped: 0,
      status: 'requesting_permissions',
      message: 'Requesting HealthKit permissions...',
    });

    try {
      // Step 1: Request permissions
      const hasPermissions = await requestHealthKitPermissions();
      if (!hasPermissions) {
        throw new Error('HealthKit permissions denied');
      }

      setSyncProgress((prev) => ({
        ...prev!,
        status: 'syncing',
        message: 'Fetching workouts from HealthKit...',
      }));

      // Step 2: Query all swim workouts from the beginning of time
      // HealthKit launched with iOS 8 in September 2014, so start from there
      const healthKitLaunchDate = new Date('2014-09-01');
      const now = new Date();

      const workouts = await querySwimWorkoutsPaginated(
        healthKitLaunchDate,
        now,
        (current, total) => {
          setSyncProgress((prev) => ({
            ...prev!,
            message: `Fetching workouts... (chunk ${current}/${total})`,
          }));
        }
      );

      if (workouts.length === 0) {
        setSyncProgress({
          current: 0,
          total: 0,
          workoutsSynced: 0,
          workoutsSkipped: 0,
          status: 'complete',
          message: 'No swim workouts found in HealthKit',
        });
        Alert.alert('Sync Complete', 'No swim workouts found in HealthKit');
        return;
      }

      setSyncProgress((prev) => ({
        ...prev!,
        total: workouts.length,
        message: `Found ${workouts.length} workouts. Starting import...`,
      }));

      // Step 3: Import each workout
      let workoutsSynced = 0;
      let workoutsSkipped = 0;
      let workoutsFailed = 0;

      for (let i = 0; i < workouts.length; i++) {
        const hkWorkout = workouts[i];

        // Check if workout already exists
        const exists = await workoutExistsByHealthKitUuid(db, hkWorkout.uuid);
        if (exists) {
          workoutsSkipped++;
          setSyncProgress((prev) => ({
            ...prev!,
            current: i + 1,
            workoutsSkipped,
            message: `Skipping duplicate (${i + 1}/${workouts.length})`,
          }));
          continue;
        }

        setSyncProgress((prev) => ({
          ...prev!,
          current: i + 1,
          message: `Importing workout ${i + 1}/${workouts.length}...`,
        }));

        try {
          // Debug: Log the raw workout data structure
          console.log('[Sync] Raw workout data:', {
            uuid: hkWorkout.uuid,
            hasWorkoutEvents: !!hkWorkout.workoutEvents,
            workoutEventsCount: hkWorkout.workoutEvents?.length || 0,
            workoutEventsRaw: hkWorkout.workoutEvents ? JSON.stringify(hkWorkout.workoutEvents.slice(0, 2)) : 'none'
          });
          console.log('[Sync] Full workout object keys:', Object.keys(hkWorkout));
          console.log('[Sync] Workout metadata:', JSON.stringify(hkWorkout.metadata, null, 2));

          // Fetch detailed data for this workout
          const [distanceSamples, strokeSamples, heartRateSamples] = await Promise.all([
            queryDistanceSwimmingSamples(hkWorkout),
            queryStrokeCountSamples(hkWorkout),
            queryHeartRateSamples(hkWorkout),
          ]);

          // Parse into our format
          const parsedData = parseCompleteWorkoutData(
            hkWorkout,
            distanceSamples,
            strokeSamples,
            heartRateSamples
          );

          console.log(`[Sync] ✅ Parsed workout ${i + 1}:`, {
            distance: parsedData.workout.total_distance_meters,
            laps: parsedData.laps.length,
            poolLength: parsedData.workout.pool_length_meters,
            unit: parsedData.workout.pool_length_unit
          });

          // Insert into database
          await insertCompleteWorkoutData(
            db,
            parsedData.workout,
            parsedData.laps,
            parsedData.segments,
            parsedData.strokeSamples,
            parsedData.heartRateSamples
          );

          workoutsSynced++;
          setSyncProgress((prev) => ({
            ...prev!,
            workoutsSynced,
          }));
        } catch (error) {
          workoutsFailed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Sync] ❌ FAILED workout ${i + 1}:`, errorMsg);
          console.error('[Sync] Workout details:', {
            uuid: hkWorkout.uuid,
            start: hkWorkout.start,
            end: hkWorkout.end,
            hasWorkoutEvents: !!hkWorkout.workoutEvents,
            workoutEventsCount: hkWorkout.workoutEvents?.length || 0,
          });
          console.error('[Sync] Full error:', error);
          // Continue with next workout instead of failing completely
        }
      }

      // Step 4: Complete
      setSyncProgress({
        current: workouts.length,
        total: workouts.length,
        workoutsSynced,
        workoutsSkipped,
        status: 'complete',
        message: `Sync complete! ${workoutsSynced} workouts imported, ${workoutsSkipped} skipped${workoutsFailed > 0 ? `, ${workoutsFailed} failed` : ''}`,
      });

      // Refresh count
      await refreshWorkoutCount();

      // Build alert message
      let alertMessage = `Successfully imported ${workoutsSynced} workout${workoutsSynced !== 1 ? 's' : ''}!`;
      if (workoutsSkipped > 0) {
        alertMessage += `\n${workoutsSkipped} duplicate${workoutsSkipped !== 1 ? 's' : ''} skipped.`;
      }
      if (workoutsFailed > 0) {
        alertMessage += `\n⚠️ ${workoutsFailed} workout${workoutsFailed !== 1 ? 's' : ''} failed to import. Check console for details.`;
      }

      Alert.alert(
        workoutsFailed > 0 ? 'Sync Completed with Errors' : 'Sync Complete',
        alertMessage
      );
    } catch (error) {
      console.error('Sync error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      setSyncProgress({
        current: 0,
        total: 0,
        workoutsSynced: 0,
        workoutsSkipped: 0,
        status: 'error',
        message: `Error: ${errorMessage}`,
      });

      Alert.alert('Sync Failed', errorMessage);
    } finally {
      setIsSyncing(false);
    }
  }, [db, refreshWorkoutCount]);

  return {
    syncProgress,
    isSyncing,
    totalWorkoutsInDB,
    startSync,
    refreshWorkoutCount,
  };
}
