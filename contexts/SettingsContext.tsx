import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useDatabase } from './DatabaseContext';
import { DEFAULT_MODEL_ID, getModel } from '../lib/models';

/**
 * Settings Context
 *
 * Persists user preferences (currently the selected chat model) in a simple
 * key-value table in the existing SQLite database. The table is created on
 * demand so no schema migration is required.
 */

const SELECTED_MODEL_KEY = 'selected_model';

interface SettingsContextType {
  /** The id of the currently selected chat model. */
  selectedModelId: string;
  /** Persist a new selected model. */
  setSelectedModel: (modelId: string) => Promise<void>;
  /** True once settings have been loaded from the database. */
  isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextType>({
  selectedModelId: DEFAULT_MODEL_ID,
  setSelectedModel: async () => {},
  isLoaded: false,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { db, isInitialized } = useDatabase();
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted settings once the database is ready.
  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!db || !isInitialized) return;

      try {
        await db.execAsync(
          'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)'
        );

        const row = await db.getFirstAsync<{ value: string }>(
          'SELECT value FROM settings WHERE key = ?',
          [SELECTED_MODEL_KEY]
        );

        if (isMounted && row?.value) {
          // Validate against the registry; fall back to default if stale.
          setSelectedModelId(getModel(row.value).id);
        }
      } catch (err) {
        console.warn('Failed to load settings:', err);
      } finally {
        if (isMounted) setIsLoaded(true);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [db, isInitialized]);

  const setSelectedModel = useCallback(
    async (modelId: string) => {
      const valid = getModel(modelId).id;
      setSelectedModelId(valid);

      if (!db) return;
      try {
        await db.runAsync(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [SELECTED_MODEL_KEY, valid]
        );
      } catch (err) {
        console.warn('Failed to save selected model:', err);
      }
    },
    [db]
  );

  return (
    <SettingsContext.Provider value={{ selectedModelId, setSelectedModel, isLoaded }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
