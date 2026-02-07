import { StyleSheet, ScrollView, View as RNView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Text, View } from '@/components/Themed';
import { useHealthKitSync } from '@/hooks/useHealthKitSync';
import { useDatabase } from '@/contexts/DatabaseContext';

export default function TabTwoScreen() {
  const { isInitialized } = useDatabase();
  const {
    syncProgress,
    isSyncing,
    totalWorkoutsInDB,
    startSync,
    refreshWorkoutCount,
  } = useHealthKitSync();

  // Load workout count on mount
  useEffect(() => {
    refreshWorkoutCount();
  }, [refreshWorkoutCount]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <RNView style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Sync and manage your workout data</Text>
      </RNView>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Database Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Database</Text>
          <RNView style={styles.statsRow}>
            <Text style={styles.statsLabel}>Total Workouts:</Text>
            <Text style={styles.statsValue}>{totalWorkoutsInDB}</Text>
          </RNView>
        </View>

        {/* Sync Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HealthKit Sync</Text>
          <Text style={styles.sectionDescription}>
            Import your historical swim workouts from Apple Health. This will fetch all swimming
            activities including lap times, stroke data, and heart rate.
          </Text>

          <TouchableOpacity
            style={[styles.syncButton, (isSyncing || !isInitialized) && styles.syncButtonDisabled]}
            onPress={startSync}
            disabled={isSyncing || !isInitialized}
          >
            {!isInitialized ? (
              <>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.syncButtonText}>Initializing Database...</Text>
              </>
            ) : isSyncing ? (
              <>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.syncButtonText}>Syncing...</Text>
              </>
            ) : (
              <Text style={styles.syncButtonText}>Sync Workouts from HealthKit</Text>
            )}
          </TouchableOpacity>

          {/* Progress Display */}
          {syncProgress && (
            <RNView style={styles.progressContainer}>
              <Text style={styles.progressMessage}>{syncProgress.message}</Text>

              {syncProgress.total > 0 && (
                <>
                  <RNView style={styles.progressBarBackground}>
                    <RNView
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${(syncProgress.current / syncProgress.total) * 100}%`,
                        },
                      ]}
                    />
                  </RNView>

                  <Text style={styles.progressStats}>
                    {syncProgress.current} / {syncProgress.total} workouts processed
                  </Text>

                  {syncProgress.workoutsSynced > 0 && (
                    <Text style={styles.progressDetail}>
                      ✓ {syncProgress.workoutsSynced} imported
                    </Text>
                  )}

                  {syncProgress.workoutsSkipped > 0 && (
                    <Text style={styles.progressDetail}>
                      ⊘ {syncProgress.workoutsSkipped} skipped (duplicates)
                    </Text>
                  )}
                </>
              )}

              {syncProgress.status === 'complete' && (
                <Text style={styles.successMessage}>
                  ✓ Sync complete! You can now query your workouts in the Chat tab.
                </Text>
              )}

              {syncProgress.status === 'error' && (
                <Text style={styles.errorMessage}>✗ Sync failed. Please try again.</Text>
              )}
            </RNView>
          )}
        </View>

        {/* Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.infoText}>
            This app stores all your workout data locally on your device. Your raw health data never
            leaves your phone - only metadata is sent to OpenAI to generate database queries.
          </Text>

          <RNView style={styles.infoBox}>
            <Text style={styles.infoBoxTitle}>Privacy First</Text>
            <Text style={styles.infoBoxText}>
              • All data stored locally in SQLite{'\n'}
              • Only query metadata sent to OpenAI{'\n'}
              • Raw health data stays on device{'\n'}
              • Optional cloud backup via Supabase
            </Text>
          </RNView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
    color: '#666',
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F9F9F9',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    color: '#000',
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  statsLabel: {
    fontSize: 16,
    color: '#333',
  },
  statsValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  syncButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#FFF',
    borderRadius: 8,
  },
  progressMessage: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressStats: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  progressDetail: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  successMessage: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '500',
    marginTop: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#F44336',
    fontWeight: '500',
    marginTop: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
  infoBox: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#2196F3',
  },
  infoBoxTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 4,
  },
  infoBoxText: {
    fontSize: 13,
    color: '#1565C0',
    lineHeight: 18,
  },
});
