import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { ChatMessage as ChatMessageType } from '@/types/workout';

interface ChatMessageProps {
  message: ChatMessageType;
  isUser?: boolean;
}

export function ChatMessage({ message, isUser }: ChatMessageProps) {
  const role = message.role || (isUser ? 'user' : 'assistant');
  const isUserMessage = role === 'user';

  return (
    <View
      style={[
        styles.container,
        isUserMessage ? styles.userContainer : styles.assistantContainer,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUserMessage ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        <Text
          style={[
            styles.text,
            isUserMessage ? styles.userText : styles.assistantText,
          ]}
        >
          {message.content}
        </Text>
        {message.query_sql && !isUserMessage && (
          <View style={styles.sqlContainer}>
            <Text style={styles.sqlLabel}>SQL Query:</Text>
            <Text style={styles.sqlText}>{message.query_sql}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    marginHorizontal: 12,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: '#007AFF',
  },
  assistantBubble: {
    backgroundColor: '#E9E9EB',
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {
    color: '#000000',
  },
  sqlContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  sqlLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  sqlText: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#333',
  },
});
