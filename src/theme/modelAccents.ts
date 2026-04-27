/**
 * Per-model-family accent colors.
 *
 * Void surfaces a subtle accent stripe in the UI that reflects which model
 * family is currently driving the conversation. Accents are sourced from the
 * locked palette spec at
 * `docs/superpowers/specs/2026-04-27-palette-design.md` and are designed to
 * stay readable on Void's dark background.
 *
 * `resolveModelAccent` layers two extra discriminators on top of
 * `resolveModelFamily` so that:
 *   1. OpenAI API ids (`openai/...`) map to a separate accent from bare
 *      `gpt-*` ids that imply a ChatGPT subscription routing.
 *   2. Local-runner ids (`ollama/...`, `lmstudio/...`, `local/...`,
 *      `*-local`) get their own neutral accent regardless of the underlying
 *      model family.
 */

import { resolveModelFamily } from '../utils/model/modelFamily.js'

export type AccentFamily =
  | 'anthropic'
  | 'chatgptSubscription'
  | 'openaiApi'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'eastasian'
  | 'local'

export const MODEL_ACCENTS: Record<AccentFamily, string> = {
  anthropic: '#7dcfff',
  chatgptSubscription: '#bb9af7',
  openaiApi: '#9ece6a',
  gemini: '#7aa2f7',
  xai: '#ff7eb6',
  deepseek: '#ff9e64',
  eastasian: '#e0af68',
  local: '#9aa5ce',
}

const OPENAI_API_PREFIX = /(^|\/)openai\//i
const LOCAL_RUNNER_PREFIX = /^(ollama|lmstudio|local)\//i
const LOCAL_SUFFIX = /-local$/i

/**
 * Resolve the accent hex color for a raw model id.
 *
 * Order of operations:
 *   1. Empty / null / undefined → anthropic fallback.
 *   2. `openai/...` (including nested gateway slugs like
 *      `openrouter/openai/gpt-5.4`) → `openaiApi`.
 *   3. Local-runner patterns (`*-local` suffix or `ollama/`, `lmstudio/`,
 *      `local/` prefix) → `local`.
 *   4. Otherwise delegate to `resolveModelFamily` and fold qwen/kimi/glm
 *      into the shared `eastasian` accent.
 */
export function resolveModelAccent(model: string | null | undefined): string {
  if (!model) return MODEL_ACCENTS.anthropic

  const id = model.trim()
  if (!id) return MODEL_ACCENTS.anthropic

  if (OPENAI_API_PREFIX.test(id)) return MODEL_ACCENTS.openaiApi
  if (LOCAL_RUNNER_PREFIX.test(id) || LOCAL_SUFFIX.test(id)) {
    return MODEL_ACCENTS.local
  }

  const family = resolveModelFamily(id)
  switch (family) {
    case 'anthropic':
      return MODEL_ACCENTS.anthropic
    case 'openai':
      // Bare `gpt-*` / `o1`, `codex` etc. — the `openai/` prefix would have
      // matched above, so reaching here implies a subscription-style id.
      return MODEL_ACCENTS.chatgptSubscription
    case 'gemini':
      return MODEL_ACCENTS.gemini
    case 'xai':
      return MODEL_ACCENTS.xai
    case 'deepseek':
      return MODEL_ACCENTS.deepseek
    case 'qwen':
    case 'kimi':
    case 'glm':
      return MODEL_ACCENTS.eastasian
    default:
      return MODEL_ACCENTS.anthropic
  }
}
