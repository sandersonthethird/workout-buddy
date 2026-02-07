import * as SQLite from 'expo-sqlite';
import { SyncState } from '@/types/workout';

/**
 * Sync State Repository
 *
 * Manages sync state and checkpoint tracking.
 */

/**
 * Set a sync state value
 */
export async function setSyncState(
  db: SQLite.SQLiteDatabase,
  key: string,
  value: string
): Promise<void> {
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO sync_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
    [key, value, now, value, now]
  );
}

/**
 * Get a sync state value
 */
export async function getSyncState(
  db: SQLite.SQLiteDatabase,
  key: string
): Promise<string | null> {
  const result = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    [key]
  );
  return result?.value || null;
}

/**
 * Get sync state as typed value
 */
export async function getSyncStateTyped<T>(
  db: SQLite.SQLiteDatabase,
  key: string
): Promise<T | null> {
  const value = await getSyncState(db, key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

/**
 * Set sync state with typed value
 */
export async function setSyncStateTyped<T>(
  db: SQLite.SQLiteDatabase,
  key: string,
  value: T
): Promise<void> {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  await setSyncState(db, key, stringValue);
}

/**
 * Delete a sync state entry
 */
export async function deleteSyncState(
  db: SQLite.SQLiteDatabase,
  key: string
): Promise<void> {
  await db.runAsync('DELETE FROM sync_state WHERE key = ?', [key]);
}

/**
 * Get all sync states
 */
export async function getAllSyncStates(
  db: SQLite.SQLiteDatabase
): Promise<SyncState[]> {
  const results = await db.getAllAsync<SyncState>(
    'SELECT * FROM sync_state ORDER BY key ASC'
  );
  return results;
}

// Common sync state keys
export const SYNC_KEYS = {
  INITIAL_IMPORT_COMPLETE: 'initial_import_complete',
  LAST_FULL_SYNC: 'last_full_sync',
  LAST_INCREMENTAL_SYNC: 'last_incremental_sync',
  IMPORT_CHECKPOINT: 'import_checkpoint',
} as const;
