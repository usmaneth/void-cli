/**
 * Stub: Claude.ai rate limits hook removed in Void CLI rebrand.
 */

import { type ClaudeAILimits, currentLimits } from './claudeAiLimits.js'

export function useClaudeAiLimits(): ClaudeAILimits {
  return { ...currentLimits }
}
