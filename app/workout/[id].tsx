import { useState, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useDatabase } from '@/contexts/DatabaseContext';
import {
  getWorkoutById,
  getLapsByWorkoutId,
  getSegmentsByWorkoutId,
  getRecentWorkouts,
  getHeartRateSamplesByWorkoutId,
} from '@/services/database/repositories/workout';
import { Workout, Lap, Segment, HeartRateSample } from '@/types/workout';
import { HeartRateChart } from '@/components/workout/HeartRateChart';
import {
  formatWorkoutDate,
  formatDuration,
  formatDistance,
  formatPace,
  calculateAvgPace,
  formatHeartRate,
} from '@/services/formatting/workout-formatters';

type SplitSize = 25 | 50 | 100;
type ViewMode = 'all' | 'segments';

interface Split {
  split_number: number;
  start_distance: number;
  end_distance: number;
  duration_seconds: number;
  stroke_count: number;
  pace_per_100_seconds: number;
}

interface SegmentSummary extends Segment {
  lap_count: number;
  avg_pace_per_100_seconds: number;
  stroke_style: string | null;
}

interface StrokeBreakdown {
  strokeStyle: string;
  distance: number;
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { db } = useDatabase();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [segments, setSegments] = useState<SegmentSummary[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [strokeBreakdown, setStrokeBreakdown] = useState<StrokeBreakdown[]>([]);
  const [heartRateSamples, setHeartRateSamples] = useState<HeartRateSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [workoutIds, setWorkoutIds] = useState<string[]>([]);

  // UI state
  const [splitSize, setSplitSize] = useState<SplitSize>(100);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);

  // Set header title and back button when workout loads
  useEffect(() => {
    navigation.setOptions({
      headerTitle: workout ? formatWorkoutDate(workout.start_date) : '',
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => {
            router.push('/(tabs)/workouts');
          }}
          style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}
        >
          <Text style={{ fontSize: 17, color: '#007AFF' }}>
            {'< '}Workouts
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [workout, navigation, router]);

  useEffect(() => {
    loadWorkoutData();
  }, [id, db]);

  useEffect(() => {
    loadWorkoutIds();
  }, [db]);

  useEffect(() => {
    if (workout && laps.length > 0) {
      calculateSplits();
    }
  }, [splitSize, workout, laps, expandedSegment, viewMode]);

  async function loadWorkoutIds() {
    if (!db) return;
    try {
      // Load all workouts to get IDs for swipe navigation
      const allWorkouts = await getRecentWorkouts(db, 1000); // Get up to 1000 workouts
      setWorkoutIds(allWorkouts.map(w => w.id));
    } catch (error) {
      console.error('Error loading workout IDs:', error);
    }
  }

  function navigateToWorkout(direction: 'prev' | 'next') {
    if (!id || workoutIds.length === 0) return;

    const currentIndex = workoutIds.indexOf(id);
    if (currentIndex === -1) return;

    let targetIndex: number;
    if (direction === 'prev') {
      // Swipe right = previous (earlier) workout
      targetIndex = currentIndex + 1;
    } else {
      // Swipe left = next (later) workout
      targetIndex = currentIndex - 1;
    }

    if (targetIndex >= 0 && targetIndex < workoutIds.length) {
      const targetId = workoutIds[targetIndex];
      // Note: router.push() always animates right-to-left regardless of swipe direction
      // This is a limitation of Expo Router's navigation system
      router.push(`/workout/${targetId}`);
    }
  }

  // PanResponder for swipe detection
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      // Only capture horizontal swipes
      return Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
    },
    onPanResponderRelease: (evt, gestureState) => {
      const SWIPE_THRESHOLD = 100;
      if (Math.abs(gestureState.dx) > SWIPE_THRESHOLD) {
        if (gestureState.dx > 0) {
          // Swipe right = previous (earlier) workout
          navigateToWorkout('prev');
        } else {
          // Swipe left = next (later) workout
          navigateToWorkout('next');
        }
      }
    },
  });

  async function loadWorkoutData() {
    if (!db || !id) return;

    try {
      setLoading(true);

      // Load workout
      const workoutData = await getWorkoutById(db, id);
      setWorkout(workoutData);

      if (workoutData) {
        // Load laps
        const lapsData = await getLapsByWorkoutId(db, id);
        setLaps(lapsData);

        // Load heart rate samples
        const hrSamples = await getHeartRateSamplesByWorkoutId(db, id);
        setHeartRateSamples(hrSamples);

        // Debug: Check first few laps for stroke style
        console.log('[Workout Detail] First 5 laps:', lapsData.slice(0, 5).map(lap => ({
          lap_number: lap.lap_number,
          stroke_style: lap.stroke_style,
          distance: lap.distance_meters,
        })));

        // Debug: Check ALL unique stroke styles in the workout
        const uniqueStrokes = [...new Set(lapsData.map(lap => lap.stroke_style))];
        console.log('[Workout Detail] All unique stroke styles found:', uniqueStrokes);

        // Calculate stroke breakdown by distance
        const strokeDistances = lapsData.reduce((acc, lap) => {
          const style = lap.stroke_style || 'unknown';
          acc[style] = (acc[style] || 0) + lap.distance_meters;
          return acc;
        }, {} as Record<string, number>);

        console.log('[Workout Detail] Stroke distances (including unknown):', strokeDistances);

        const breakdown: StrokeBreakdown[] = Object.entries(strokeDistances)
          .filter(([style]) => style !== 'unknown')
          .map(([strokeStyle, distance]) => ({ strokeStyle, distance }))
          .sort((a, b) => b.distance - a.distance);

        console.log('[Workout Detail] Stroke breakdown:', breakdown);
        setStrokeBreakdown(breakdown);

        // Load segments with summaries
        const segmentsData = await getSegmentsByWorkoutId(db, id);
        const segmentSummaries: SegmentSummary[] = segmentsData.map(segment => {
          const segmentLaps = lapsData.filter(lap => lap.segment_id === segment.id);
          const totalDistance = segmentLaps.reduce((sum, lap) => sum + lap.distance_meters, 0);
          const totalDuration = segmentLaps.reduce((sum, lap) => sum + lap.duration_seconds, 0);

          // Find the most common stroke style in this segment
          const strokeCounts = segmentLaps.reduce((acc, lap) => {
            const style = lap.stroke_style || 'unknown';
            acc[style] = (acc[style] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          const dominantStroke = Object.entries(strokeCounts).reduce((max, [style, count]) =>
            count > max.count ? { style, count } : max,
            { style: null as string | null, count: 0 }
          ).style;

          const unit = workoutData.pool_length_unit || 'm';
          const avgPace = calculateAvgPace(totalDuration, totalDistance, unit);

          console.log(`[Segment ${segment.segment_number}] Calculated:`, {
            segmentId: segment.id,
            lapCount: segmentLaps.length,
            totalDistance,
            totalDuration,
            avgPace,
            dominantStroke,
          });

          // Build summary with calculated values taking precedence
          return {
            id: segment.id,
            workout_id: segment.workout_id,
            segment_number: segment.segment_number,
            start_time: segment.start_time,
            end_time: segment.end_time,
            lap_count: segmentLaps.length,
            total_distance_meters: totalDistance,
            total_duration_seconds: segment.total_duration_seconds || totalDuration,
            swim_duration_seconds: segment.swim_duration_seconds,
            rest_duration_seconds: segment.rest_duration_seconds,
            avg_pace_per_100m_seconds: avgPace,
            avg_pace_per_100_seconds: avgPace,
            stroke_style: dominantStroke,
          };
        });
        setSegments(segmentSummaries);
      }
    } catch (error) {
      console.error('Error loading workout:', error);
    } finally {
      setLoading(false);
    }
  }

  function calculateSplits() {
    if (!workout || laps.length === 0) return;

    const unit = workout.pool_length_unit || 'm';
    const targetDistance = splitSize * (unit === 'yd' ? 0.9144 : 1);

    // Filter laps based on view mode
    let filteredLaps = laps;
    if (viewMode === 'segments' && expandedSegment) {
      filteredLaps = laps.filter(lap => lap.segment_id === expandedSegment);
      console.log('[calculateSplits] Filtering for segment:', {
        expandedSegment,
        totalLaps: laps.length,
        filteredLaps: filteredLaps.length,
        sampleLapSegmentId: laps[0]?.segment_id,
        sampleLapSegmentIdType: typeof laps[0]?.segment_id,
        expandedSegmentType: typeof expandedSegment,
      });
    }

    const calculatedSplits: Split[] = [];
    let currentDistance = 0;
    let currentDuration = 0;
    let currentStrokes = 0;
    let splitNumber = 1;

    for (const lap of filteredLaps) {
      currentDistance += lap.distance_meters;
      currentDuration += lap.duration_seconds;
      currentStrokes += lap.stroke_count || 0;

      if (currentDistance >= targetDistance) {
        calculatedSplits.push({
          split_number: splitNumber,
          start_distance: (splitNumber - 1) * splitSize,
          end_distance: splitNumber * splitSize,
          duration_seconds: currentDuration,
          stroke_count: currentStrokes,
          pace_per_100_seconds: (currentDuration / currentDistance) * (100 * (unit === 'yd' ? 0.9144 : 1)),
        });

        splitNumber++;
        currentDistance = 0;
        currentDuration = 0;
        currentStrokes = 0;
      }
    }

    // Handle remaining partial split
    if (currentDistance > 0) {
      const actualDistance = unit === 'yd' ? currentDistance / 0.9144 : currentDistance;
      calculatedSplits.push({
        split_number: splitNumber,
        start_distance: (splitNumber - 1) * splitSize,
        end_distance: Math.round((splitNumber - 1) * splitSize + actualDistance),
        duration_seconds: currentDuration,
        stroke_count: currentStrokes,
        pace_per_100_seconds: (currentDuration / currentDistance) * (100 * (unit === 'yd' ? 0.9144 : 1)),
      });
    }

    setSplits(calculatedSplits);
  }

  function toggleSegment(segmentId: string) {
    if (expandedSegment === segmentId) {
      setExpandedSegment(null);
      // Stay in segments view when collapsing
    } else {
      setExpandedSegment(segmentId);
      setViewMode('segments');
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading workout...</Text>
      </View>
    );
  }

  if (!workout) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Workout not found</Text>
      </View>
    );
  }

  const unit = workout.pool_length_unit || 'm';

  // Format times
  const startTime = new Date(workout.start_date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const endTime = new Date(workout.end_date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <ScrollView style={styles.scrollContent}>
      {/* Workout Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.dateTimeRow}>
          <Text style={styles.date}>{formatWorkoutDate(workout.start_date)}</Text>
          <Text style={styles.time}>{startTime} - {endTime}</Text>
        </View>

        <View style={styles.summaryStats}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Duration</Text>
            <Text style={styles.summaryValue}>{formatDuration(workout.duration_seconds)}</Text>
          </View>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Distance</Text>
            <Text style={styles.summaryValue}>
              {formatDistance(workout.total_distance_meters, unit)}
            </Text>
          </View>

          {(laps.some(lap => lap.avg_heart_rate !== null)) && (
            <>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Avg HR</Text>
                <Text style={styles.summaryValue}>
                  {formatHeartRate(
                    Math.round(
                      laps
                        .filter(lap => lap.avg_heart_rate !== null)
                        .reduce((sum, lap) => sum + (lap.avg_heart_rate || 0), 0) /
                      laps.filter(lap => lap.avg_heart_rate !== null).length
                    )
                  )}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Max HR</Text>
                <Text style={styles.summaryValue}>
                  {formatHeartRate(
                    Math.max(...laps.map(lap => lap.max_heart_rate || 0))
                  )}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Stroke Breakdown */}
        {strokeBreakdown.length > 0 && (
          <View style={styles.strokeBreakdownSection}>
            <Text style={styles.strokeBreakdownTitle}>Strokes</Text>
            <View style={styles.strokeBreakdownList}>
              {strokeBreakdown.map((stroke) => (
                <View key={stroke.strokeStyle} style={styles.strokeBreakdownItem}>
                  <Text style={styles.strokeBreakdownLabel}>
                    {stroke.strokeStyle.charAt(0).toUpperCase() + stroke.strokeStyle.slice(1)}
                  </Text>
                  <Text style={styles.strokeBreakdownValue}>
                    {formatDistance(stroke.distance, unit)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Heart Rate Chart */}
      {heartRateSamples.length > 0 && (
        <HeartRateChart
          samples={heartRateSamples}
          workoutStartTime={workout.start_date}
          workoutDuration={workout.duration_seconds}
          segments={segments}
        />
      )}

      {/* View Mode Toggle */}
      {segments.length > 0 && (
        <View style={styles.controlsCard}>
          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[styles.toggleButton, viewMode === 'all' && styles.toggleButtonActive]}
              onPress={() => {
                setViewMode('all');
                setExpandedSegment(null);
              }}
            >
              <Text style={[styles.toggleText, viewMode === 'all' && styles.toggleTextActive]}>
                All Splits
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, viewMode === 'segments' && styles.toggleButtonActive]}
              onPress={() => setViewMode('segments')}
            >
              <Text style={[styles.toggleText, viewMode === 'segments' && styles.toggleTextActive]}>
                By Segment
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Segments View */}
      {viewMode === 'segments' && (
        <View style={styles.segmentsSection}>
          <Text style={styles.sectionTitle}>Segments</Text>
          {segments.map((segment) => (
            <View key={segment.id}>
              <TouchableOpacity
                style={[
                  styles.segmentCard,
                  expandedSegment === segment.id && styles.segmentCardExpanded
                ]}
                onPress={() => toggleSegment(segment.id)}
              >
                <View style={styles.segmentHeader}>
                  <Text style={styles.segmentTitle}>Segment {segment.segment_number}</Text>
                  <View style={styles.segmentHeaderRight}>
                    {segment.stroke_style && segment.stroke_style !== 'unknown' && (
                      <Text style={styles.strokeType}>
                        {segment.stroke_style.charAt(0).toUpperCase() + segment.stroke_style.slice(1)}
                      </Text>
                    )}
                    <Text style={styles.segmentArrow}>
                      {expandedSegment === segment.id ? '▼' : '▶'}
                    </Text>
                  </View>
                </View>

                <View style={styles.segmentStats}>
                  <View style={styles.segmentStatItem}>
                    <Text style={styles.segmentStatLabel}>Swim</Text>
                    <Text style={styles.segmentStatValue}>
                      {formatDuration(segment.swim_duration_seconds || 0)}
                    </Text>
                  </View>

                  <View style={styles.segmentStatItem}>
                    <Text style={styles.segmentStatLabel}>Rest</Text>
                    <Text style={styles.segmentStatValue}>
                      {formatDuration(segment.rest_duration_seconds || 0)}
                    </Text>
                  </View>

                  <View style={styles.segmentStatItem}>
                    <Text style={styles.segmentStatLabel}>Distance</Text>
                    <Text style={styles.segmentStatValue}>
                      {formatDistance(segment.total_distance_meters || 0, unit)}
                    </Text>
                  </View>

                  <View style={styles.segmentStatItem}>
                    <Text style={styles.segmentStatLabel}>Laps</Text>
                    <Text style={styles.segmentStatValue}>{segment.lap_count}</Text>
                  </View>

                  <View style={styles.segmentStatItem}>
                    <Text style={styles.segmentStatLabel}>Avg Pace</Text>
                    <Text style={styles.segmentStatValue}>
                      {formatPace(segment.avg_pace_per_100_seconds, unit)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Show splits for expanded segment */}
              {expandedSegment === segment.id && (
                <View style={styles.segmentSplitsContainer}>
                  {renderSplitControls()}
                  {renderSplitsTable()}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* All Splits View */}
      {viewMode === 'all' && (
        <View style={styles.splitsSection}>
          {renderSplitControls()}
          {renderSplitsTable()}
        </View>
      )}
      </ScrollView>
    </View>
  );

  function renderSplitControls() {
    return (
      <View style={styles.splitControls}>
        <Text style={styles.splitControlsLabel}>Split Size:</Text>
        <View style={styles.splitButtonGroup}>
          {([25, 50, 100] as SplitSize[]).map((size) => (
            <TouchableOpacity
              key={size}
              style={[
                styles.splitButton,
                splitSize === size && styles.splitButtonActive
              ]}
              onPress={() => setSplitSize(size)}
            >
              <Text style={[
                styles.splitButtonText,
                splitSize === size && styles.splitButtonTextActive
              ]}>
                {size}{unit}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function renderSplitsTable() {
    if (splits.length === 0) {
      return (
        <View style={styles.emptySplits}>
          <Text style={styles.emptyText}>No lap data available</Text>
          <Text style={styles.emptySubtext}>
            This workout may have been recorded without lap markers
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.splitsTable}>
        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, styles.splitColumn]}>Split</Text>
          <Text style={[styles.headerCell, styles.paceColumn]}>Pace</Text>
          <Text style={[styles.headerCell, styles.timeStrokesColumn]}>Time/Strokes</Text>
        </View>

        {/* Table Rows */}
        {splits.map((split) => (
          <View key={split.split_number} style={styles.tableRow}>
            <Text style={[styles.cell, styles.splitColumn]}>
              {split.split_number}: {split.start_distance}-{split.end_distance}{unit}
            </Text>
            <Text style={[styles.cell, styles.paceColumn]}>
              {formatPace(split.pace_per_100_seconds, unit)}
            </Text>
            <Text style={[styles.cell, styles.timeStrokesColumn]}>
              {formatDuration(split.duration_seconds)}/{split.stroke_count}
            </Text>
          </View>
        ))}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
  },
  summaryCard: {
    backgroundColor: '#fff',
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dateTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  date: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  time: {
    fontSize: 14,
    color: '#666',
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  strokeBreakdownSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  strokeBreakdownTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  strokeBreakdownList: {
    gap: 8,
  },
  strokeBreakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  strokeBreakdownLabel: {
    fontSize: 14,
    color: '#666',
  },
  strokeBreakdownValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  controlsCard: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  toggleButtonActive: {
    backgroundColor: '#007AFF',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  toggleTextActive: {
    color: '#fff',
  },
  segmentsSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  segmentCard: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentCardExpanded: {
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  segmentTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  segmentHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  strokeType: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
    backgroundColor: '#E5F1FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  segmentArrow: {
    fontSize: 12,
    color: '#999',
  },
  segmentStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  segmentStatItem: {
    alignItems: 'center',
  },
  segmentStatLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
  },
  segmentStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  segmentSplitsContainer: {
    backgroundColor: '#f9f9f9',
    padding: 16,
    marginBottom: 8,
  },
  splitsSection: {
    backgroundColor: '#fff',
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  splitControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  splitControlsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginRight: 12,
  },
  splitButtonGroup: {
    flexDirection: 'row',
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  splitButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
  },
  splitButtonActive: {
    backgroundColor: '#007AFF',
  },
  splitButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  splitButtonTextActive: {
    color: '#fff',
  },
  emptySplits: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  splitsTable: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8f8f8',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerCell: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
  },
  cell: {
    fontSize: 14,
    color: '#333',
  },
  splitColumn: {
    flex: 2.5,
  },
  paceColumn: {
    flex: 2,
  },
  timeStrokesColumn: {
    flex: 1.5,
    textAlign: 'right',
  },
});
