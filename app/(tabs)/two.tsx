import { StyleSheet, ScrollView, View as RNView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Text, View } from '@/components/Themed';
import { useHealthKitSync } from '@/hooks/useHealthKitSync';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useSettings } from '@/contexts/SettingsContext';
import { AVAILABLE_MODELS, PROVIDER_LABELS, getModel, type ProviderId } from '@/lib/models';
import { isProviderConfigured } from '@/lib/llm';

export default function TabTwoScreen() {
  const { isInitialized } = useDatabase();
  const { selectedModelId, setSelectedModel } = useSettings();
  const {
    syncProgress,
    isSyncing,
    totalWorkoutsInDB,
    startSync,
    refreshWorkoutCount,
    clearAllWorkouts,
  } = useHealthKitSync();

  const handleClearWorkouts = () => {
    Alert.alert(
      'Clear All Workouts?',
      `This deletes all ${totalWorkoutsInDB} imported workouts and their data from this device. Your Apple Health data is not affected — you can re-sync at any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearAllWorkouts(),
        },
      ]
    );
  };

  const selectedModel = getModel(selectedModelId);
  const providers = Array.from(
    new Set(AVAILABLE_MODELS.map((m) => m.provider))
  ) as ProviderId[];

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
        {/* Chat Model */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Chat Model</Text>
          <Text style={styles.sectionDescription}>
            Choose which AI model generates database queries from your questions.
          </Text>

          {providers.map((provider) => {
            const configured = isProviderConfigured(provider);
            const models = AVAILABLE_MODELS.filter((m) => m.provider === provider);

            return (
              <RNView key={provider} style={styles.providerGroup}>
                <RNView style={styles.providerHeaderRow}>
                  <Text style={styles.providerLabel}>{PROVIDER_LABELS[provider]}</Text>
                  {!configured && <Text style={styles.providerBadge}>API key needed</Text>}
                </RNView>

                {models.map((model) => {
                  const isSelected = model.id === selectedModelId;
                  return (
                    <TouchableOpacity
                      key={model.id}
                      style={[styles.modelRow, isSelected && styles.modelRowSelected]}
                      onPress={() => setSelectedModel(model.id)}
                      activeOpacity={0.7}
                    >
                      <RNView style={styles.modelInfo}>
                        <Text style={styles.modelLabel}>{model.label}</Text>
                        <Text style={styles.modelDescription}>{model.description}</Text>
                      </RNView>
                      {isSelected && <Text style={styles.modelCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </RNView>
            );
          })}

          {!isProviderConfigured(selectedModel.provider) && (
            <RNView style={styles.warningBox}>
              <Text style={styles.warningText}>
                {selectedModel.label} needs a {PROVIDER_LABELS[selectedModel.provider]} API key.
                Add {selectedModel.provider === 'anthropic'
                  ? 'EXPO_PUBLIC_ANTHROPIC_API_KEY'
                  : 'EXPO_PUBLIC_OPENAI_API_KEY'}{' '}
                to your environment, then rebuild.
              </Text>
            </RNView>
          )}
        </View>

        {/* Database Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Database</Text>
          <RNView style={styles.statsRow}>
            <Text style={styles.statsLabel}>Total Workouts:</Text>
            <Text style={styles.statsValue}>{totalWorkoutsInDB}</Text>
          </RNView>

          <TouchableOpacity
            style={[
              styles.clearButton,
              (isSyncing || totalWorkoutsInDB === 0) && styles.clearButtonDisabled,
            ]}
            onPress={handleClearWorkouts}
            disabled={isSyncing || totalWorkoutsInDB === 0}
          >
            <Text style={styles.clearButtonText}>Clear All Workouts</Text>
          </TouchableOpacity>
          <Text style={styles.clearHint}>
            Removes imported workouts so you can re-sync from HealthKit. Does not affect Apple Health.
          </Text>
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
            leaves your phone - only your question and the database schema are sent to your selected
            AI provider to generate database queries.
          </Text>

          <RNView style={styles.infoBox}>
            <Text style={styles.infoBoxTitle}>Privacy First</Text>
            <Text style={styles.infoBoxText}>
              • All data stored locally in SQLite{'\n'}
              • Only your question + schema sent to the AI provider{'\n'}
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
  providerGroup: {
    marginBottom: 12,
  },
  providerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  providerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  providerBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B26A00',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    marginBottom: 8,
  },
  modelRowSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F7FF',
  },
  modelInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modelLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  modelDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  modelCheck: {
    fontSize: 18,
    fontWeight: '700',
    color: '#007AFF',
    marginLeft: 12,
  },
  warningBox: {
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FB8C00',
    marginTop: 4,
  },
  warningText: {
    fontSize: 13,
    color: '#B26A00',
    lineHeight: 18,
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
  clearButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F44336',
    backgroundColor: '#FFF',
    alignItems: 'center',
  },
  clearButtonDisabled: {
    opacity: 0.4,
  },
  clearButtonText: {
    color: '#F44336',
    fontSize: 15,
    fontWeight: '600',
  },
  clearHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    lineHeight: 16,
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
