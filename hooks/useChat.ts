import { useState, useCallback } from 'react';
import uuid from 'react-native-uuid';
import { ChatMessage } from '@/types/workout';
import { useDatabase } from '@/contexts/DatabaseContext';
import { processUserQuery } from '@/services/chat/query-parser';
import { formatQueryResults } from '@/services/chat/response-formatter';
import { isOpenAIConfigured } from '@/lib/llm';

/**
 * useChat Hook
 *
 * Manages chat state and handles message sending/receiving.
 */

export function useChat() {
  const { db, isInitialized } = useDatabase();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Send a message and get a response
   */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!db || !isInitialized) {
        setError('Database not initialized');
        return;
      }

      if (!isOpenAIConfigured()) {
        setError('OpenAI API key not configured. Please add EXPO_PUBLIC_OPENAI_API_KEY to your .env file.');
        return;
      }

      setIsLoading(true);
      setError(null);

      // Add user message
      const userMessage: ChatMessage = {
        id: uuid.v4() as string,
        role: 'user',
        content,
        query_sql: null,
        created_at: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);

      try {
        // Process query
        const result = await processUserQuery(db, content);

        if (result.error) {
          // Error response
          const errorMessage: ChatMessage = {
            id: uuid.v4() as string,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${result.error}`,
            query_sql: null,
            created_at: Date.now(),
          };
          setMessages((prev) => [...prev, errorMessage]);
          setError(result.error);
        } else {
          // Success response
          const formattedResponse = formatQueryResults(
            result.results,
            result.explanation
          );

          const assistantMessage: ChatMessage = {
            id: uuid.v4() as string,
            role: 'assistant',
            content: formattedResponse,
            query_sql: result.sql,
            created_at: Date.now(),
          };

          setMessages((prev) => [...prev, assistantMessage]);

          // Optionally save to database
          try {
            await db.runAsync(
              'INSERT INTO chat_messages (id, role, content, query_sql, created_at) VALUES (?, ?, ?, ?, ?)',
              [userMessage.id, userMessage.role, userMessage.content, null, userMessage.created_at]
            );

            await db.runAsync(
              'INSERT INTO chat_messages (id, role, content, query_sql, created_at) VALUES (?, ?, ?, ?, ?)',
              [
                assistantMessage.id,
                assistantMessage.role,
                assistantMessage.content,
                assistantMessage.query_sql,
                assistantMessage.created_at,
              ]
            );
          } catch (saveError) {
            console.warn('Failed to save messages to database:', saveError);
            // Don't fail the whole operation if saving fails
          }
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'An unexpected error occurred';

        const assistantMessage: ChatMessage = {
          id: uuid.v4() as string,
          role: 'assistant',
          content: `Sorry, something went wrong: ${errorMessage}`,
          query_sql: null,
          created_at: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [db, isInitialized]
  );

  /**
   * Clear all messages
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  /**
   * Load chat history from database
   */
  const loadHistory = useCallback(async () => {
    if (!db || !isInitialized) return;

    try {
      const history = await db.getAllAsync<ChatMessage>(
        'SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 50'
      );
      setMessages(history);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }, [db, isInitialized]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    loadHistory,
  };
}
