import type { OpenRouterModel } from './openrouterModels.js'

/**
 * A suggestion pairing a model with a human-readable reason label.
 */
export type ModelSuggestion = {
  model: OpenRouterModel
  label: string
}

/**
 * Heuristic rules mapping file patterns to recommended model IDs.
 */
const SUGGESTION_RULES: Array<{
  test: (ctx: SuggestionContext) => boolean
  modelId: string
  label: string
}> = [
  {
    test: (ctx) =>
      /\.(tsx|css|html|scss|less|svelte|vue)$/.test(ctx.filePath ?? ''),
    modelId: 'google/gemini-3.1-pro',
    label: 'Recommended for frontend/UI files',
  },
  {
    test: (ctx) =>
      /\/api\//.test(ctx.filePath ?? '') ||
      /\.service\./.test(ctx.filePath ?? ''),
    modelId: 'openai/gpt-5.4',
    label: 'Recommended for API/service logic',
  },
  {
    test: (ctx) =>
      /\.(test|spec)\.[^.]+$/.test(ctx.filePath ?? '') ||
      /\/__tests__\//.test(ctx.filePath ?? ''),
    modelId: 'thudm/glm-5.1',
    label: 'Recommended for test files',
  },
  {
    test: (ctx) =>
      /\.md$/.test(ctx.filePath ?? '') || /\/docs\//.test(ctx.filePath ?? ''),
    modelId: 'anthropic/claude-sonnet-4.6',
    label: 'Recommended for documentation',
  },
]

/**
 * Context used by the suggestion engine to determine which models to recommend.
 */
export type SuggestionContext = {
  /** The current file path being edited, if any. */
  filePath?: string
}

/**
 * Given a context (e.g. current file), return matching model suggestions
 * from the available OpenRouter models catalog.
 *
 * Each suggestion includes the full model object and a human-readable label
 * explaining why it was suggested.
 */
export function getSuggestedModels(
  context: SuggestionContext,
  availableModels: OpenRouterModel[],
): ModelSuggestion[] {
  const suggestions: ModelSuggestion[] = []
  const seen = new Set<string>()

  // Build a lookup map for O(1) matching
  const modelMap = new Map<string, OpenRouterModel>()
  for (const m of availableModels) {
    modelMap.set(m.id, m)
  }

  for (const rule of SUGGESTION_RULES) {
    if (rule.test(context)) {
      const model = modelMap.get(rule.modelId)
      if (model && !seen.has(model.id)) {
        seen.add(model.id)
        suggestions.push({ model, label: rule.label })
      }
    }
  }

  return suggestions
}
