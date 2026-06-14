import { useState } from 'react';
import { StyleSheet, FlatList, View as RNView, ActivityIndicator, TouchableOpacity, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { Text, View } from '@/components/Themed';
import { Conversation } from '@/types/workout';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useChat } from '@/hooks/useChat';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { isProviderConfigured } from '@/lib/llm';
import { getModel, PROVIDER_LABELS } from '@/lib/models';

export default function TabOneScreen() {
  const { isInitialized, error: dbError } = useDatabase();
  const { selectedModelId } = useSettings();
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    conversations,
    currentConversationId,
    newChat,
    selectConversation,
    removeConversation,
  } = useChat();
  const [showChats, setShowChats] = useState(false);

  const handleDeleteConversation = (item: Conversation) => {
    Alert.alert(
      'Delete chat?',
      `"${item.title || 'Untitled chat'}" and its messages will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeConversation(item.id),
        },
      ]
    );
  };

  const selectedModel = getModel(selectedModelId);
  const providerConfigured = isProviderConfigured(selectedModel.provider);
  const isReady = isInitialized && providerConfigured;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <RNView style={styles.header}>
        <RNView style={styles.headerText}>
          <Text style={styles.title}>Workout Buddy</Text>
          <Text style={styles.subtitle}>Ask about your swim workouts</Text>
        </RNView>
        <RNView style={styles.headerButtons}>
          <TouchableOpacity style={styles.headerButton} onPress={() => setShowChats(true)}>
            <Text style={styles.headerButtonText}>Chats</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerButton, styles.headerButtonPrimary]}
            onPress={newChat}
          >
            <Text style={[styles.headerButtonText, styles.headerButtonPrimaryText]}>＋ New</Text>
          </TouchableOpacity>
        </RNView>
      </RNView>

      {!isReady ? (
        <View style={styles.statusContainer}>
          {dbError ? (
            <Text style={styles.statusError}>Database Error: {dbError.message}</Text>
          ) : !isInitialized ? (
            <Text style={styles.statusLoading}>Initializing database...</Text>
          ) : !providerConfigured ? (
            <>
              <Text style={styles.statusError}>
                {PROVIDER_LABELS[selectedModel.provider]} API key not configured
              </Text>
              <Text style={styles.statusHint}>
                Add{' '}
                {selectedModel.provider === 'anthropic'
                  ? 'EXPO_PUBLIC_ANTHROPIC_API_KEY'
                  : 'EXPO_PUBLIC_OPENAI_API_KEY'}{' '}
                to your environment, or pick a different model in Settings
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

      <Modal
        visible={showChats}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowChats(false)}
      >
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <RNView style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Chats</Text>
            <TouchableOpacity onPress={() => setShowChats(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </RNView>

          <TouchableOpacity
            style={styles.newChatRow}
            onPress={() => {
              newChat();
              setShowChats(false);
            }}
          >
            <Text style={styles.newChatText}>＋ New Chat</Text>
          </TouchableOpacity>

          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isActive = item.id === currentConversationId;
              return (
                <RNView style={[styles.convoRow, isActive && styles.convoRowActive]}>
                  <TouchableOpacity
                    style={styles.convoSelect}
                    onPress={() => {
                      selectConversation(item.id);
                      setShowChats(false);
                    }}
                  >
                    <Text style={styles.convoTitle} numberOfLines={1}>
                      {item.title || 'Untitled chat'}
                    </Text>
                    <Text style={styles.convoDate}>
                      {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.convoDelete}
                    onPress={() => handleDeleteConversation(item)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <FontAwesome name="trash-o" size={18} color="#F44336" />
                  </TouchableOpacity>
                </RNView>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.convoEmpty}>No saved chats yet. Send a message to start one.</Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  headerText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  headerButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  headerButtonPrimary: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  headerButtonPrimaryText: {
    color: '#FFFFFF',
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  modalClose: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  newChatRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  newChatText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  convoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  convoRowActive: {
    backgroundColor: '#F0F7FF',
  },
  convoSelect: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  convoDelete: {
    paddingVertical: 14,
    paddingLeft: 16,
  },
  convoTitle: {
    fontSize: 16,
    color: '#000',
  },
  convoDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  convoEmpty: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    padding: 24,
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
