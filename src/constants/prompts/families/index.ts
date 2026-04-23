/**
 * Per-model-family system prompt prefixes.
 *
 * Each family file contains only the family-specific delta — framing,
 * tone tweaks, model-specific guidance. The bulk of the system prompt
 * (tool usage, task rules, tone and style, efficiency) is shared across
 * all families via the base prompt in `src/constants/prompts.ts`.
 *
 * The prefix is prepended to the cacheable (static) portion of the
 * system prompt, BEFORE the SYSTEM_PROMPT_DYNAMIC_BOUNDARY marker, so
 * it participates in the shared prompt-cache prefix.
 */
import {
  resolveModelFamily,
  type ModelFamily,
} from '../../../utils/model/modelFamily.js'
import { ANTHROPIC_FAMILY_PREFIX } from './anthropic.js'
import { OPENAI_FAMILY_PREFIX } from './openai.js'
import { GEMINI_FAMILY_PREFIX } from './gemini.js'
import { XAI_FAMILY_PREFIX } from './xai.js'
import { DEEPSEEK_FAMILY_PREFIX } from './deepseek.js'
import { QWEN_FAMILY_PREFIX } from './qwen.js'
import { KIMI_FAMILY_PREFIX } from './kimi.js'
import { GLM_FAMILY_PREFIX } from './glm.js'

const FAMILY_PREFIX_MAP: Record<ModelFamily, string> = {
  anthropic: ANTHROPIC_FAMILY_PREFIX,
  openai: OPENAI_FAMILY_PREFIX,
  gemini: GEMINI_FAMILY_PREFIX,
  xai: XAI_FAMILY_PREFIX,
  deepseek: DEEPSEEK_FAMILY_PREFIX,
  qwen: QWEN_FAMILY_PREFIX,
  kimi: KIMI_FAMILY_PREFIX,
  glm: GLM_FAMILY_PREFIX,
}

/**
 * Resolve the family-specific system-prompt prefix for a given model ID.
 * Falls back to the Anthropic prefix (Void's default tone) for unknown
 * model IDs — that preserves the pre-families behavior for any model
 * string we haven't classified yet.
 */
export function getModelFamilyPromptPrefix(
  model: string | null | undefined,
): string {
  const family = resolveModelFamily(model)
  return FAMILY_PREFIX_MAP[family]
}
