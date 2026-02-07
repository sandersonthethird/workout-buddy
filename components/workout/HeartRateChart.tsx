import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { HeartRateSample, Segment } from '@/types/workout';
import { formatDuration, formatHeartRate } from '@/services/formatting/workout-formatters';

interface SegmentSummary extends Segment {
  lap_count: number;
  avg_pace_per_100_seconds: number;
  stroke_style: string | null;
}

interface HeartRateChartProps {
  samples: HeartRateSample[];
  workoutStartTime: number;
  workoutDuration: number;
  segments: SegmentSummary[];
}

export function HeartRateChart({
  samples,
  workoutStartTime,
  workoutDuration,
  segments
}: HeartRateChartProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const screenWidth = Dimensions.get('window').width;

  // Process and aggregate samples for performance
  const chartData = useMemo(() => {
    if (samples.length === 0) {
      return { labels: [], datasets: [{ data: [0] }] };
    }

    // Sort samples by timestamp
    const sortedSamples = [...samples].sort((a, b) => a.timestamp - b.timestamp);

    // Limit to max 100 points for performance (keep granular data)
    const maxPoints = 100;
    const skipInterval = Math.max(1, Math.floor(sortedSamples.length / maxPoints));

    const aggregatedSamples = sortedSamples.filter((_, index) =>
      index % skipInterval === 0
    );

    // Create data arrays
    const hrData = aggregatedSamples.map(s => s.heart_rate);

    // Create labels with segment numbers centered in each segment
    const labels = aggregatedSamples.map((s) => {
      // Find which segment this sample belongs to
      if (segments.length > 0) {
        const segment = segments.find(seg =>
          s.timestamp >= seg.start_time && s.timestamp <= seg.end_time
        );

        if (segment) {
          // Get all samples in this segment
          const segmentSamples = aggregatedSamples.filter(sample =>
            sample.timestamp >= segment.start_time && sample.timestamp <= segment.end_time
          );

          // Find the middle sample in this segment
          const middleIndex = Math.floor(segmentSamples.length / 2);

          if (segmentSamples[middleIndex] === s) {
            return `${segment.segment_number}`;
          }
        }
      }
      return '';
    });

    return {
      labels,
      datasets: [{
        data: hrData,
        color: (opacity = 1) => `rgba(255, 59, 48, ${opacity})`, // iOS red
        strokeWidth: 2,
      }],
    };
  }, [samples, segments]);

  if (samples.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Heart Rate</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No heart rate data available</Text>
          <Text style={styles.emptySubtext}>
            Heart rate is recorded when using Apple Watch during workouts
          </Text>
        </View>
      </View>
    );
  }

  const minHR = Math.min(...chartData.datasets[0].data);
  const maxHR = Math.max(...chartData.datasets[0].data);
  const avgHR = Math.round(
    chartData.datasets[0].data.reduce((sum, hr) => sum + hr, 0) /
    chartData.datasets[0].data.length
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.headerButton}
        onPress={() => setIsExpanded(!isExpanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerContent}>
          <Text style={styles.title}>Heart Rate</Text>
          <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg</Text>
            <Text style={styles.statValue}>{formatHeartRate(avgHR)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Min</Text>
            <Text style={styles.statValue}>{formatHeartRate(minHR)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Max</Text>
            <Text style={styles.statValue}>{formatHeartRate(maxHR)}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.chartContainer}>
          <LineChart
            data={chartData}
            width={screenWidth - 40} // padding
            height={220}
            chartConfig={{
              backgroundColor: '#fff',
              backgroundGradientFrom: '#fff',
              backgroundGradientTo: '#fff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(255, 59, 48, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(102, 102, 102, ${opacity})`,
              style: {
                borderRadius: 12,
              },
              propsForDots: {
                r: '0', // Hide dots for cleaner look
              },
            }}
            bezier // Smooth curves
            style={styles.chart}
            withInnerLines={true}
            withOuterLines={true}
            withVerticalLines={false}
            withHorizontalLines={true}
            withVerticalLabels={true}
            withHorizontalLabels={true}
            fromZero={false} // Start from min HR, not 0
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerButton: {
    padding: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  expandIcon: {
    fontSize: 14,
    color: '#666',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30', // iOS red to match chart
  },
  chartContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 12,
  },
  emptyState: {
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
});
