/**
 * Model Registry
 *
 * Defines the LLM providers and models available for chat query generation.
 * The selected model is persisted via SettingsContext and threaded into the
 * query parser, which routes the request to the matching provider.
 */

export type ProviderId = 'openai' | 'anthropic';

export interface ModelOption {
  /** The exact model string sent to the provider's API. */
  id: string;
  /** Human-readable label shown in the Settings picker. */
  label: string;
  /** Short description shown under the label. */
  description: string;
  provider: ProviderId;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/**
 * All selectable models, grouped by provider in display order.
 *
 * Anthropic model IDs are the exact, complete strings — do not append date
 * suffixes. Opus 4.8 is Anthropic's most capable model and the recommended
 * default for Anthropic.
 */
export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    description: 'Fast and inexpensive',
    provider: 'openai',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'More capable, higher cost',
    provider: 'openai',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    description: 'Most capable Claude model',
    provider: 'anthropic',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'Balanced speed and intelligence',
    provider: 'anthropic',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: 'Fastest and most cost-effective',
    provider: 'anthropic',
  },
];

/**
 * Default model. Kept as the existing OpenAI model so behaviour is unchanged
 * until the user explicitly picks another model in Settings.
 */
export const DEFAULT_MODEL_ID = 'gpt-4o-mini';

export function getModel(id: string | null | undefined): ModelOption {
  const match = AVAILABLE_MODELS.find((m) => m.id === id);
  if (match) return match;
  // Fall back to the default model (guaranteed present in AVAILABLE_MODELS).
  return AVAILABLE_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

export function getProviderForModel(id: string): ProviderId {
  return getModel(id).provider;
}
