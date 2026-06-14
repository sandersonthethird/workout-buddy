import { useState, useCallback, useEffect } from 'react';
import uuid from 'react-native-uuid';
import { ChatMessage, Conversation } from '@/types/workout';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useSettings } from '@/contexts/SettingsContext';
import { processUserQuery } from '@/services/chat/query-parser';
import { formatQueryResults } from '@/services/chat/response-formatter';
import { isProviderConfigured } from '@/lib/llm';
import { getModel, PROVIDER_LABELS } from '@/lib/models';
import {
  listConversations,
  createConversation,
  getConversationMessages,
  insertChatMessage,
  touchConversation,
  deleteConversation,
  migrateOrphanMessages,
  makeConversationTitle,
} from '@/services/database/repositories/chat';

/**
 * useChat Hook
 *
 * Manages chat state across multiple conversations. The active conversation's
 * messages are shown; a new chat is created lazily on the first message so
 * empty conversations never clutter the list. Prior conversations are
 * persisted and can be reopened.
 */

export function useChat() {
  const { db, isInitialized } = useDatabase();
  const { selectedModelId } = useSettings();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    if (!db) return;
    try {
      setConversations(await listConversations(db));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [db]);

  // On startup: migrate any legacy messages, load the conversation list, and
  // open the most recent conversation so the user resumes where they left off.
  useEffect(() => {
    let active = true;

    async function init() {
      if (!db || !isInitialized) return;
      try {
        await migrateOrphanMessages(db);
        const list = await listConversations(db);
        if (!active) return;
        setConversations(list);

        if (list.length > 0) {
          const recent = list[0]; // ordered by updated_at DESC
          const msgs = await getConversationMessages(db, recent.id);
          if (!active) return;
          setCurrentConversationId(recent.id);
          setMessages(msgs);
        }
      } catch (err) {
        console.error('Failed to initialize chat:', err);
      }
    }

    init();
    return () => {
      active = false;
    };
  }, [db, isInitialized]);

  /** Start a fresh chat (the conversation is created on the first message). */
  const newChat = useCallback(() => {
    setCurrentConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  /** Delete a conversation; if it's the open one, drop back to a new chat. */
  const removeConversation = useCallback(
    async (conversationId: string) => {
      if (!db) return;
      try {
        await deleteConversation(db, conversationId);
        if (conversationId === currentConversationId) {
          setCurrentConversationId(null);
          setMessages([]);
        }
        await refreshConversations();
      } catch (err) {
        console.error('Failed to delete conversation:', err);
      }
    },
    [db, currentConversationId, refreshConversations]
  );

  /** Open an existing conversation and load its messages. */
  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (!db) return;
      setError(null);
      setCurrentConversationId(conversationId);
      try {
        setMessages(await getConversationMessages(db, conversationId));
      } catch (err) {
        console.error('Failed to load conversation:', err);
        setMessages([]);
      }
    },
    [db]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!db || !isInitialized) {
        setError('Database not initialized');
        return;
      }

      const model = getModel(selectedModelId);
      if (!isProviderConfigured(model.provider)) {
        const envVar =
          model.provider === 'anthropic'
            ? 'EXPO_PUBLIC_ANTHROPIC_API_KEY'
            : 'EXPO_PUBLIC_OPENAI_API_KEY';
        setError(
          `${PROVIDER_LABELS[model.provider]} API key not configured. Add ${envVar} to your environment to use ${model.label}.`
        );
        return;
      }

      setIsLoading(true);
      setError(null);

      const userMessage: ChatMessage = {
        id: uuid.v4() as string,
        role: 'user',
        content,
        query_sql: null,
        created_at: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);

      try {
        const result = await processUserQuery(db, content, selectedModelId);

        if (result.error) {
          // Error responses are shown but not persisted.
          const errorMessage: ChatMessage = {
            id: uuid.v4() as string,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${result.error}`,
            query_sql: null,
            created_at: Date.now(),
          };
          setMessages((prev) => [...prev, errorMessage]);
          setError(result.error);
          return;
        }

        const formattedResponse = formatQueryResults(result.results, result.explanation);
        const assistantMessage: ChatMessage = {
          id: uuid.v4() as string,
          role: 'assistant',
          content: formattedResponse,
          query_sql: result.sql,
          created_at: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Persist this successful exchange, creating the conversation lazily on
        // the first message so empty/errored chats aren't saved.
        try {
          let conversationId = currentConversationId;
          if (!conversationId) {
            const convo = await createConversation(db, makeConversationTitle(content));
            conversationId = convo.id;
            setCurrentConversationId(convo.id);
          }
          await insertChatMessage(db, conversationId, userMessage);
          await insertChatMessage(db, conversationId, assistantMessage);
          await touchConversation(db, conversationId, assistantMessage.created_at);
          await refreshConversations();
        } catch (saveError) {
          console.warn('Failed to save messages to database:', saveError);
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
    [db, isInitialized, selectedModelId, currentConversationId, refreshConversations]
  );

  return {
    messages,
    conversations,
    currentConversationId,
    isLoading,
    error,
    sendMessage,
    newChat,
    selectConversation,
    removeConversation,
  };
}
