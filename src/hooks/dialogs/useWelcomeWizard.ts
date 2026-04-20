/**
 * Pure state machine for the 3-step welcome wizard. Kept completely free
 * of React so Voidex (or a headless CLI fallback) can reuse the logic.
 *
 * Steps:
 *   0 — pick a provider (anthropic | openrouter | openai | gemini)
 *   1 — enter API key (skippable when the provider supports OAuth / env)
 *   2 — choose a default model (from the provider's built-in catalog)
 *
 * The reducer is exported separately from the React hook so tests can
 * drive transitions without mounting Ink. `useWelcomeWizard` is a thin
 * wrapper added in the component layer.
 */

export type WizardProvider =
  | 'anthropic'
  | 'openrouter'
  | 'openai'
  | 'gemini'

export const WIZARD_PROVIDERS: readonly WizardProvider[] = [
  'anthropic',
  'openrouter',
  'openai',
  'gemini',
]

export type WizardState = {
  readonly stepIndex: 0 | 1 | 2 | 3
  readonly provider: WizardProvider | null
  readonly apiKey: string
  readonly model: string | null
  readonly skipped: boolean
  readonly complete: boolean
}

export type WizardAction =
  | { kind: 'selectProvider'; provider: WizardProvider }
  | { kind: 'setApiKey'; value: string }
  | { kind: 'selectModel'; model: string }
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'skip' }
  | { kind: 'finish' }

export const WIZARD_INITIAL: WizardState = {
  stepIndex: 0,
  provider: null,
  apiKey: '',
  model: null,
  skipped: false,
  complete: false,
}

/** Which step is valid to leave given the current state. */
export function canAdvance(state: WizardState): boolean {
  if (state.stepIndex === 0) return state.provider !== null
  if (state.stepIndex === 1) {
    // API key optional for Anthropic (OAuth login) — required otherwise
    // unless an env var is already set (caller can inject `skipped`).
    if (state.provider === 'anthropic') return true
    return state.apiKey.trim().length > 0
  }
  if (state.stepIndex === 2) return state.model !== null
  return false
}

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.kind) {
    case 'selectProvider':
      return { ...state, provider: action.provider }
    case 'setApiKey':
      return { ...state, apiKey: action.value }
    case 'selectModel':
      return { ...state, model: action.model }
    case 'next': {
      if (!canAdvance(state)) return state
      if (state.stepIndex >= 2) {
        return { ...state, stepIndex: 3, complete: true }
      }
      return { ...state, stepIndex: (state.stepIndex + 1) as 0 | 1 | 2 }
    }
    case 'back': {
      if (state.stepIndex === 0) return state
      return { ...state, stepIndex: (state.stepIndex - 1) as 0 | 1 | 2 }
    }
    case 'skip':
      return { ...state, skipped: true, complete: true, stepIndex: 3 }
    case 'finish':
      return { ...state, complete: true, stepIndex: 3 }
    default:
      return state
  }
}

/**
 * Suggested default models per provider. Kept here (not in React) so tests
 * and Voidex's renderer share the same catalog.
 */
export const WIZARD_MODEL_SUGGESTIONS: Record<WizardProvider, readonly { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7 — most capable' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
  ],
  openrouter: [
    { id: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4.7 via OpenRouter' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4 via OpenRouter' },
    { id: 'google/gemini-3-pro', label: 'Gemini 3 Pro via OpenRouter' },
  ],
  openai: [
    { id: 'openai/gpt-5.4', label: 'GPT-5.4 — OpenAI flagship' },
    { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini — fast & cheap' },
  ],
  gemini: [
    { id: 'google/gemini-3-pro', label: 'Gemini 3 Pro — flagship' },
    { id: 'google/gemini-3-flash', label: 'Gemini 3 Flash — fast' },
  ],
}
