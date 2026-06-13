import Constants from 'expo-constants';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ProviderId } from './models';

/**
 * LLM Client Configuration
 *
 * Initializes provider clients (OpenAI and Anthropic) for natural language
 * query processing. The model the user selects in Settings determines which
 * provider is used at request time — see services/chat/query-parser.ts.
 *
 * Setup Instructions:
 * 1. Get an API key:
 *    - OpenAI: https://platform.openai.com/api-keys
 *    - Anthropic: https://console.anthropic.com/settings/keys
 * 2. Add it to your environment:
 *    - For development: create a .env file with
 *      EXPO_PUBLIC_OPENAI_API_KEY=your-key
 *      EXPO_PUBLIC_ANTHROPIC_API_KEY=your-key
 *    - For EAS builds: set the same variables on the build profile's
 *      environment (eas env:create) so they're embedded at build time.
 */

const openaiApiKey =
  Constants.expoConfig?.extra?.openaiApiKey ||
  process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
  '';

const anthropicApiKey =
  Constants.expoConfig?.extra?.anthropicApiKey ||
  process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ||
  '';

if (!openaiApiKey && !anthropicApiKey) {
  console.warn(
    'No LLM API key configured. Chat functionality will be disabled.\n' +
      'Add EXPO_PUBLIC_OPENAI_API_KEY or EXPO_PUBLIC_ANTHROPIC_API_KEY to your environment.'
  );
}

// Force usage of the global (native) fetch — without this, the SDKs reach for
// a fetch implementation that crashes in React Native.
const customFetch: typeof fetch = async (url, init) => {
  return globalThis.fetch(url, init);
};

export const openai = new OpenAI({
  apiKey: openaiApiKey,
  dangerouslyAllowBrowser: true,
  fetch: customFetch,
});

export const anthropic = new Anthropic({
  apiKey: anthropicApiKey,
  dangerouslyAllowBrowser: true,
  fetch: customFetch,
});

/**
 * Return the API key for a provider (read directly from env at call time).
 */
export function getApiKey(provider: ProviderId): string {
  return provider === 'anthropic' ? anthropicApiKey : openaiApiKey;
}

/**
 * Check if a given provider has an API key configured.
 */
export function isProviderConfigured(provider: ProviderId): boolean {
  return Boolean(getApiKey(provider));
}

/**
 * @deprecated Kept for backwards compatibility. Prefer isProviderConfigured().
 */
export function isOpenAIConfigured(): boolean {
  return Boolean(openaiApiKey);
}

/**
 * Legacy model constants (OpenAI). New code should use the model registry in
 * lib/models.ts and the user-selected model instead.
 */
export const MODELS = {
  QUERY_GENERATION: 'gpt-4o-mini',
  ANALYSIS: 'gpt-4o',
} as const;
