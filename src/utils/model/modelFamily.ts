/**
 * Model-family detection for system prompt tuning.
 *
 * Void can route to many API providers (firstParty, bedrock, vertex, foundry,
 * openrouter, vercelGateway, gitlab, openai, gemini), but any of those can
 * host any model family — openrouter can serve Claude, GPT, Gemini, Grok, or
 * DeepSeek; bedrock serves Claude, Llama, Mistral, etc.
 *
 * System-prompt framing is a function of the *model family*, not the
 * provider. This helper classifies a raw model ID string into one of the
 * families we hand-tuned prompt prefixes for. Default is `anthropic` because
 * that preserves Void's existing tone when the model is unknown.
 *
 * Matching is prefix-based on the lowercased model ID. OpenRouter-style
 * "org/model" slugs are handled by stripping the org prefix.
 */

export type ModelFamily =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'glm'

const DEFAULT_FAMILY: ModelFamily = 'anthropic'

/**
 * Resolve the model family from a raw model ID (e.g. `claude-opus-4-7`,
 * `gpt-5.4-high`, `openrouter/anthropic/claude-sonnet-4-6`,
 * `gemini-2.5-pro`, `grok-4`, `deepseek-v3`, `qwen2.5-coder-32b`).
 *
 * Unknown models fall back to `anthropic`, which mirrors the stock Void
 * prompt tone.
 */
export function resolveModelFamily(model: string | null | undefined): ModelFamily {
  if (!model) return DEFAULT_FAMILY

  // Normalize: lowercase, strip org prefix from "org/model" slugs so
  // `anthropic/claude-sonnet-4-6` and `openrouter/deepseek/deepseek-v3`
  // resolve the same way as bare model IDs. We keep stripping until there's
  // no slash left so triple-nested gateway paths still work.
  let id = model.toLowerCase().trim()
  while (id.includes('/')) {
    id = id.slice(id.indexOf('/') + 1)
  }

  // Order matters for prefixes that overlap (e.g. `qwq` vs `qwen`). The most
  // specific checks come first.
  if (id.startsWith('claude-') || id.startsWith('claude')) return 'anthropic'
  if (
    id.startsWith('gpt-') ||
    id.startsWith('gpt') ||
    id.startsWith('o1-') ||
    id.startsWith('o1') ||
    id.startsWith('o3-') ||
    id.startsWith('o3') ||
    id.startsWith('o4-') ||
    id.startsWith('codex')
  ) {
    return 'openai'
  }
  if (id.startsWith('gemini-') || id.startsWith('gemini')) return 'gemini'
  if (id.startsWith('grok-') || id.startsWith('grok')) return 'xai'
  if (id.startsWith('deepseek-') || id.startsWith('deepseek')) return 'deepseek'
  if (
    id.startsWith('qwen') ||
    id.startsWith('qwq-') ||
    id.startsWith('qwq')
  ) {
    return 'qwen'
  }
  if (
    id.startsWith('kimi-') ||
    id.startsWith('kimi') ||
    id.startsWith('moonshot-') ||
    id.startsWith('moonshot')
  ) {
    return 'kimi'
  }
  if (
    id.startsWith('glm-') ||
    id.startsWith('glm') ||
    id.startsWith('chatglm-') ||
    id.startsWith('chatglm')
  ) {
    return 'glm'
  }

  return DEFAULT_FAMILY
}
