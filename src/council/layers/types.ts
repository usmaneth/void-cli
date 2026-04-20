/**
 * Shared types for the Effect-TS council layers.
 *
 * Keeps the layer modules framework-light: they re-export these types and
 * only pull `effect` for Layer/Context wiring.
 */
import type { CouncilConfig, CouncilMember, CouncilResponse } from '../types.js'

export type ProviderExecuteInput = {
  member: CouncilMember
  prompt: string
  systemPrompt?: string
}

export type ProviderExecuteOutput = Pick<
  CouncilResponse,
  'content' | 'tokens'
>

export type AuthCredentials = {
  /** Anthropic API key or OAuth token */
  anthropic?: string
  /** OpenRouter API key */
  openrouter?: string
  /** Whether the current Anthropic credential is a Claude.ai subscriber OAuth token */
  anthropicIsOAuth?: boolean
}

export type PermissionDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }

export type PermissionRequest = {
  memberId: string
  model: string
  prompt: string
}

export type { CouncilConfig, CouncilMember, CouncilResponse }
