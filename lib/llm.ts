import OpenAI from 'openai';
import Constants from 'expo-constants';

/**
 * OpenAI Client Configuration
 *
 * Initializes the OpenAI client for natural language query processing.
 *
 * Setup Instructions:
 * 1. Get your API key from https://platform.openai.com/api-keys
 * 2. Add it to your app config:
 *    - For development: create a .env file with:
 *      EXPO_PUBLIC_OPENAI_API_KEY=your-api-key
 *    - For production: add to app.json extra config
 */

const openaiApiKey = Constants.expoConfig?.extra?.openaiApiKey ||
                     process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
                     '';

if (!openaiApiKey) {
  console.warn(
    'OpenAI API key not configured. Chat functionality will be disabled.\n' +
    'To enable chat, add EXPO_PUBLIC_OPENAI_API_KEY to your environment.'
  );
}

export const openai = new OpenAI({
  apiKey: openaiApiKey,
  dangerouslyAllowBrowser: true,
  // Use React Native's global fetch
  fetch: fetch,
});

/**
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  return Boolean(openaiApiKey);
}

/**
 * Models to use for different purposes
 */
export const MODELS = {
  QUERY_GENERATION: 'gpt-4o-mini', // Fast and cheap for SQL generation
  ANALYSIS: 'gpt-4o', // More capable for complex analysis
} as const;
