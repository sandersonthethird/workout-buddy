import * as SQLite from 'expo-sqlite';
import uuid from 'react-native-uuid';
import { ChatMessage, Conversation } from '@/types/workout';

/**
 * Chat Repository
 *
 * Persists chat conversations and their messages so prior chats can be
 * reopened. A conversation groups an ordered list of chat_messages.
 */

/**
 * Build a short, phrase-like conversation title from the first user message:
 * the first handful of words, capped in length, with a trailing ellipsis when
 * the message continues beyond that.
 */
export function makeConversationTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New chat';

  const MAX_WORDS = 6;
  const MAX_CHARS = 40;

  const words = cleaned.split(' ');
  let title = words.slice(0, MAX_WORDS).join(' ');
  let truncated = words.length > MAX_WORDS;

  if (title.length > MAX_CHARS) {
    title = title.slice(0, MAX_CHARS).trim();
    truncated = true;
  }

  // Drop trailing punctuation/whitespace before adding the ellipsis.
  title = title.replace(/[\s,.;:!?-]+$/, '');
  // Capitalize the first letter for a tidy title.
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return truncated ? `${title}…` : title;
}

/** List conversations, most recently updated first. */
export async function listConversations(
  db: SQLite.SQLiteDatabase
): Promise<Conversation[]> {
  return db.getAllAsync<Conversation>(
    'SELECT * FROM conversations ORDER BY updated_at DESC'
  );
}

/** Create a new conversation and return it. */
export async function createConversation(
  db: SQLite.SQLiteDatabase,
  title: string
): Promise<Conversation> {
  const now = Date.now();
  const id = uuid.v4() as string;
  await db.runAsync(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, title, now, now]
  );
  return { id, title, created_at: now, updated_at: now };
}

/** Load all messages for a conversation in chronological order. */
export async function getConversationMessages(
  db: SQLite.SQLiteDatabase,
  conversationId: string
): Promise<ChatMessage[]> {
  return db.getAllAsync<ChatMessage>(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId]
  );
}

/** Insert a single message into a conversation. */
export async function insertChatMessage(
  db: SQLite.SQLiteDatabase,
  conversationId: string,
  message: ChatMessage
): Promise<void> {
  await db.runAsync(
    `INSERT INTO chat_messages (id, conversation_id, role, content, query_sql, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      conversationId,
      message.role,
      message.content,
      message.query_sql,
      message.created_at,
    ]
  );
}

/** Bump a conversation's updated_at so it sorts to the top of the list. */
export async function touchConversation(
  db: SQLite.SQLiteDatabase,
  conversationId: string,
  updatedAt: number = Date.now()
): Promise<void> {
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [
    updatedAt,
    conversationId,
  ]);
}

/** Delete a conversation and all of its messages. */
export async function deleteConversation(
  db: SQLite.SQLiteDatabase,
  conversationId: string
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM chat_messages WHERE conversation_id = ?', [
      conversationId,
    ]);
    await db.runAsync('DELETE FROM conversations WHERE id = ?', [conversationId]);
  });
}

/**
 * Assign any pre-existing messages that have no conversation (from before
 * multi-conversation support) to a single "Previous chat" conversation so they
 * aren't lost. No-op when there are none.
 */
export async function migrateOrphanMessages(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  const orphan = await db.getFirstAsync<{ count: number; min_created: number | null }>(
    'SELECT COUNT(*) as count, MIN(created_at) as min_created FROM chat_messages WHERE conversation_id IS NULL'
  );
  if (!orphan || orphan.count === 0) return;

  const now = Date.now();
  const id = uuid.v4() as string;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, 'Previous chat', orphan.min_created || now, now]
    );
    await db.runAsync(
      'UPDATE chat_messages SET conversation_id = ? WHERE conversation_id IS NULL',
      [id]
    );
  });
}
