import { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  View,
  Text,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useDatabase } from '@/contexts/DatabaseContext';
import { getWorkouts, getLapsByWorkoutId } from '@/services/database/repositories/workout';
import { Workout } from '@/types/workout';
import {
  formatWorkoutDate,
  formatDuration,
  formatDistance,
  calculateAvgPace,
  formatPace,
  formatHeartRate,
} from '@/services/formatting/workout-formatters';

interface WorkoutWithLapCount extends Workout {
  lap_count: number;
  avg_heart_rate: number | null;
}

export default function WorkoutsScreen() {
  const router = useRouter();
  const { db } = useDatabase();
  const [workouts, setWorkouts] = useState<WorkoutWithLapCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dbWorkoutCount, setDbWorkoutCount] = useState<number | null>(null);

  // Load workouts when the screen comes into focus (e.g., after syncing on Settings tab)
  useFocusEffect(
    useCallback(() => {
      loadWorkouts();
    }, [db])
  );

  async function loadWorkouts(isRefreshing = false) {
    if (!db) {
      console.log('[Workouts] No database instance');
      return;
    }

    try {
      if (isRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      console.log('[Workouts] Loading workouts...');

      // Debug: Check actual count in database
      const countResult = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM workouts'
      );
      const totalCount = countResult?.count || 0;
      setDbWorkoutCount(totalCount);
      console.log('[Workouts] Total workouts in DB:', totalCount);

      // Get all workouts
      const recentWorkouts = await getWorkouts(db);
      console.log('[Workouts] Found', recentWorkouts.length, 'workouts from query');

      // Get lap count for each workout
      const workoutsWithLaps = await Promise.all(
        recentWorkouts.map(async (workout) => {
          const laps = await getLapsByWorkoutId(db, workout.id);

          // Calculate average HR from laps with HR data
          const lapsWithHR = laps.filter(lap => lap.avg_heart_rate !== null);
          const avgHR = lapsWithHR.length > 0
            ? Math.round(lapsWithHR.reduce((sum, lap) => sum + (lap.avg_heart_rate || 0), 0) / lapsWithHR.length)
            : null;

          console.log('[Workouts] Workout', workout.id.substring(0, 8), ':', {
            distance: workout.total_distance_meters,
            laps: laps.length,
            poolLength: workout.pool_length_meters,
            unit: workout.pool_length_unit,
            avgHR: avgHR
          });
          return {
            ...workout,
            lap_count: laps.length,
            avg_heart_rate: avgHR,
          };
        })
      );

      setWorkouts(workoutsWithLaps);
      console.log('[Workouts] Set state with', workoutsWithLaps.length, 'workouts');
    } catch (error) {
      console.error('[Workouts] Error loading workouts:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleRefresh() {
    loadWorkouts(true);
  }

  function renderWorkoutCard({ item }: { item: WorkoutWithLapCount }) {
    const unit = item.pool_length_unit || 'm';
    const avgPace = calculateAvgPace(item.duration_seconds, item.total_distance_meters, unit);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/workout/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.date}>{formatWorkoutDate(item.start_date)}</Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Duration</Text>
            <Text style={styles.statValue}>{formatDuration(item.duration_seconds)}</Text>
          </View>

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>
              {formatDistance(item.total_distance_meters, unit)}
            </Text>
          </View>

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Laps</Text>
            <Text style={styles.statValue}>{item.lap_count}</Text>
          </View>

          {item.avg_heart_rate !== null ? (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Avg HR</Text>
              <Text style={styles.statValue}>{formatHeartRate(item.avg_heart_rate)}</Text>
            </View>
          ) : (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Avg Pace</Text>
              <Text style={styles.statValue}>
                {avgPace > 0 ? formatPace(avgPace, unit) : 'N/A'}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading workouts...</Text>
      </View>
    );
  }

  if (workouts.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>No workouts found</Text>
        <Text style={styles.emptySubtext}>
          {dbWorkoutCount !== null && dbWorkoutCount > 0
            ? `Database contains ${dbWorkoutCount} workout(s) but query returned none. Check console logs.`
            : 'Go to Settings to sync your swim workouts from HealthKit'}
        </Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={handleRefresh}
        >
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={workouts}
        keyExtractor={(item) => item.id}
        renderItem={renderWorkoutCard}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  date: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  poolLength: {
    fontSize: 14,
    color: '#666',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});
