/**
 * Types for the Deliberation Room feature.
 *
 * A deliberation pits multiple models against each other on a topic,
 * encouraging genuine disagreement and convergence only when the
 * arguments are genuinely strong.
 */

export interface DeliberationConfig {
  /** The topic / question for the models to deliberate on */
  topic: string
  /** Model identifiers (e.g. "claude-sonnet-4-20250514", "openai/gpt-4o") */
  models: string[]
  /** Maximum number of deliberation rounds */
  maxRounds: number
  /** Whether to automatically stop when models converge */
  autoStop: boolean
  /** Whether to display per-model token usage */
  showTokenUsage: boolean
  /** Optional additional context to prepend to the topic */
  context?: string
}

export interface ModelResponse {
  /** The model that produced this response */
  model: string
  /** The response content */
  content: string
  /** Which round this response belongs to (1-indexed) */
  round: number
  /** Model identifiers whose prior responses this model was responding to */
  respondingTo: string[]
  /** Token usage for this response */
  tokens: {
    input: number
    output: number
  }
  /** Estimated cost in USD */
  costUSD: number
  /** Latency in milliseconds */
  latencyMs: number
}

export interface Round {
  /** Round number (1-indexed) */
  number: number
  /** All model responses in this round */
  responses: ModelResponse[]
  /** Whether the models converged during this round */
  converged: boolean
}

export type DeliberationStatus =
  | 'running'
  | 'converged'
  | 'stopped'
  | 'complete'

export interface HumanInjection {
  /** Which round the human injected into */
  afterRound: number
  /** The human's message */
  content: string
}

export interface DeliberationState {
  /** The configuration that started this deliberation */
  config: DeliberationConfig
  /** All completed rounds */
  rounds: Round[]
  /** The current round number (1-indexed) */
  currentRound: number
  /** Current status of the deliberation */
  status: DeliberationStatus
  /** Running total cost in USD */
  totalCostUSD: number
  /** Human injections made during the deliberation */
  humanInjections: HumanInjection[]
}
