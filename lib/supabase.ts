import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

/**
 * Supabase Client Configuration
 *
 * Initializes the Supabase client for cloud sync functionality.
 *
 * Setup Instructions:
 * 1. Create a project at https://supabase.com
 * 2. Get your project URL and anon key from Project Settings > API
 * 3. Add them to your app config:
 *    - For development: create a .env file with:
 *      EXPO_PUBLIC_SUPABASE_URL=your-project-url
 *      EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
 *    - For production: add to app.json extra config
 */

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl ||
                    process.env.EXPO_PUBLIC_SUPABASE_URL ||
                    '';

const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey ||
                        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
                        '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not configured. Cloud sync will be disabled.\n' +
    'To enable cloud sync, add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your environment.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // For now, we'll use anonymous access
    // In production, implement proper authentication
    autoRefreshToken: true,
    persistSession: true,
  },
});

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
