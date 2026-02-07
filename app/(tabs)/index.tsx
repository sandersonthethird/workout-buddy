import { StyleSheet, FlatList, View as RNView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useChat } from '@/hooks/useChat';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { isOpenAIConfigured } from '@/lib/llm';

export default function TabOneScreen() {
  const { isInitialized, error: dbError } = useDatabase();
  const { messages, isLoading, error, sendMessage } = useChat();

  const isReady = isInitialized && isOpenAIConfigured();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <RNView style={styles.header}>
        <Text style={styles.title}>Workout Buddy</Text>
        <Text style={styles.subtitle}>Ask about your swim workouts</Text>
      </RNView>

      {!isReady ? (
        <View style={styles.statusContainer}>
          {dbError ? (
            <Text style={styles.statusError}>Database Error: {dbError.message}</Text>
          ) : !isInitialized ? (
            <Text style={styles.statusLoading}>Initializing database...</Text>
          ) : !isOpenAIConfigured() ? (
            <>
              <Text style={styles.statusError}>OpenAI API key not configured</Text>
              <Text style={styles.statusHint}>
                Add EXPO_PUBLIC_OPENAI_API_KEY to your .env file
              </Text>
            </>
          ) : null}
        </View>
      ) : (
        <>
          <FlatList
            data={messages}
            renderItem={({ item }) => <ChatMessage message={item} />}
            keyExtractor={(item) => item.id}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Ask about your swim workouts!</Text>
                <View style={styles.examplesContainer}>
                  <Text style={styles.examplesTitle}>Try asking:</Text>
                  <Text style={styles.exampleText}>• "What was my first 100 yard split in yesterday's swim?"</Text>
                  <Text style={styles.exampleText}>• "Show my last 5 workouts"</Text>
                  <Text style={styles.exampleText}>• "What's my average SWOLF score for freestyle?"</Text>
                  <Text style={styles.exampleText}>• "What was my average heart rate in yesterday's swim?"</Text>
                  <Text style={styles.exampleText}>• "How many workouts did I do this month?"</Text>
                  <Text style={styles.exampleText}>• "What was my fastest lap ever?"</Text>
                </View>
                <Text style={styles.hintText}>
                  💡 Tip: Sync your workouts in the Settings tab first!
                </Text>
              </View>
            }
          />

          {isLoading && (
            <RNView style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>Thinking...</Text>
            </RNView>
          )}

          {error && !isLoading && (
            <RNView style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </RNView>
          )}

          <ChatInput onSend={sendMessage} disabled={isLoading} />
        </>
      )}
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
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingVertical: 12,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  examplesContainer: {
    alignSelf: 'stretch',
    backgroundColor: '#F9F9F9',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  examplesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  exampleText: {
    fontSize: 14,
    color: '#007AFF',
    marginVertical: 4,
    lineHeight: 20,
  },
  hintText: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  statusContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  statusError: {
    fontSize: 16,
    color: '#F44336',
    textAlign: 'center',
    marginBottom: 8,
  },
  statusHint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  statusLoading: {
    fontSize: 16,
    color: '#666',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#F9F9F9',
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#666',
  },
  errorBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#FFEBEE',
    borderTopWidth: 1,
    borderTopColor: '#FFCDD2',
  },
  errorText: {
    fontSize: 13,
    color: '#C62828',
    textAlign: 'center',
  },
});
