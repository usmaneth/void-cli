import { getBestModel, parseUserSpecifiedModel } from './model.js'

type FriendlyModelResolver = string | ((matchText: string) => string)

type FriendlyModelSpec = {
  pattern: RegExp
  resolve: FriendlyModelResolver
}

type FriendlyModelMatch = {
  end: number
  model: string
  matchedText: string
  specIndex: number
  start: number
}

type ExtractedFriendlyModels = {
  matches: FriendlyModelMatch[]
  models: string[]
  remainingText: string
}

const DIRECT_MODEL_ID_PATTERNS = [
  /\b(?:anthropic|openai|google|thudm|z-ai|meta-llama|deepseek|qwen|mistralai)\/[a-z0-9._:-]+(?:\[[^\]]+])?\b/i,
  /\bclaude-[a-z0-9._:-]+(?:\[[^\]]+])?\b/i,
]

const FRIENDLY_MODEL_SPECS: FriendlyModelSpec[] = [
  {
    pattern:
      /\b(?:anthropic|openai|google|thudm|z-ai|meta-llama|deepseek|qwen|mistralai)\/[a-z0-9._:-]+(?:\[[^\]]+])?\b/i,
    resolve: matchedText => matchedText,
  },
  {
    pattern: /\bclaude-[a-z0-9._:-]+(?:\[[^\]]+])?\b/i,
    resolve: matchedText => matchedText,
  },
  {
    pattern:
      /\bgemini\s*3[\.\s]*1[\s-]*pro[\s-]*preview\b/i,
    resolve: 'google/gemini-3.1-pro-preview',
  },
  {
    pattern: /\bgemini\s*3[\.\s]*1[\s-]*pro\b/i,
    resolve: 'google/gemini-3.1-pro',
  },
  {
    pattern:
      /\bgemini\s*2[\.\s]*5[\s-]*pro(?:[\s-]*preview)?\b/i,
    resolve: 'google/gemini-2.5-pro-preview',
  },
  {
    pattern:
      /\bgemini\s*2[\.\s]*5[\s-]*flash(?:[\s-]*preview)?\b/i,
    resolve: 'google/gemini-2.5-flash-preview',
  },
  {
    pattern: /\bgpt[\s-]*5[\.\s]*4\b/i,
    resolve: 'openai/gpt-5.4',
  },
  {
    pattern: /\bgpt[\s-]*5[\.\s]*3\b/i,
    resolve: 'openai/gpt-5.3',
  },
  {
    pattern: /\bgpt[\s-]*5[\.\s]*2\b/i,
    resolve: 'openai/gpt-5.2',
  },
  {
    pattern: /\bgpt[\s-]*4[\.\s]*1[\s-]*mini\b/i,
    resolve: 'openai/gpt-4.1-mini',
  },
  {
    pattern: /\bgpt[\s-]*4[\.\s]*1\b/i,
    resolve: 'openai/gpt-4.1',
  },
  {
    pattern: /\bgpt[\s-]*4[\s-]*o[\s-]*mini\b/i,
    resolve: 'openai/gpt-4o-mini',
  },
  {
    pattern: /\bgpt[\s-]*4[\s-]*o\b/i,
    resolve: 'openai/gpt-4o',
  },
  {
    pattern: /\bo3[\s-]*mini\b/i,
    resolve: 'openai/o3-mini',
  },
  {
    pattern: /\bo4[\s-]*mini\b/i,
    resolve: 'openai/o4-mini',
  },
  {
    pattern: /\bo3\b/i,
    resolve: 'openai/o3',
  },
  {
    pattern: /\bglm[\s-]*5[\.\s]*1\b/i,
    resolve: 'z-ai/glm-5.1',
  },
  {
    pattern: /\bglm[\s-]*5\b/i,
    resolve: 'z-ai/glm-5',
  },
  {
    pattern: /\bglm[\s-]*4[\.\s]*7\b/i,
    resolve: 'z-ai/glm-4.7',
  },
  {
    pattern: /\bglm[\s-]*4\b/i,
    resolve: 'z-ai/glm-4.7',
  },
  {
    pattern: /\bllama[\s-]*4[\s-]*maverick\b/i,
    resolve: 'meta-llama/llama-4-maverick',
  },
  {
    pattern: /\bllama[\s-]*4\b/i,
    resolve: 'meta-llama/llama-4-maverick',
  },
  {
    pattern: /\bdeepseek[\s-]*chat[\s-]*v3\b/i,
    resolve: 'deepseek/deepseek-chat-v3-0324',
  },
  {
    pattern: /\bdeepseek[\s-]*v3\b/i,
    resolve: 'deepseek/deepseek-chat-v3-0324',
  },
  {
    pattern: /\bdeepseek[\s-]*r1\b/i,
    resolve: 'deepseek/deepseek-r1',
  },
  {
    pattern: /\bqwen[\s-]*3\b/i,
    resolve: 'qwen/qwen3-235b-a22b',
  },
  {
    pattern: /\bmistral[\s-]*large\b/i,
    resolve: 'mistralai/mistral-large',
  },
  {
    pattern: /\bclaude[\s-]*opus[\s-]*4[\.\s]*6\b/i,
    resolve: 'claude-opus-4-6',
  },
  {
    pattern: /\bclaude[\s-]*sonnet[\s-]*4[\.\s]*6\b/i,
    resolve: 'claude-sonnet-4-6',
  },
  {
    pattern: /\bclaude[\s-]*haiku[\s-]*4[\.\s]*5\b/i,
    resolve: 'claude-haiku-4-5-20251001',
  },
  {
    pattern: /\bopus\s*4[\.\s]*6\b/i,
    resolve: 'claude-opus-4-6',
  },
  {
    pattern: /\bsonnet\s*4[\.\s]*6\b/i,
    resolve: 'claude-sonnet-4-6',
  },
  {
    pattern: /\bhaiku\s*4[\.\s]*5\b/i,
    resolve: 'claude-haiku-4-5-20251001',
  },
  {
    pattern: /\bopus\s*4[\.\s]*5\b/i,
    resolve: 'claude-opus-4-5-20251101',
  },
  {
    pattern: /\bsonnet\s*4[\.\s]*5\b/i,
    resolve: 'claude-sonnet-4-5-20250929',
  },
  {
    pattern: /\bopus\s*4[\.\s]*1\b/i,
    resolve: 'claude-opus-4-1-20250805',
  },
  {
    pattern: /\bopus\s*4\b/i,
    resolve: 'claude-opus-4-20250514',
  },
  {
    pattern: /\bsonnet\s*4\b/i,
    resolve: 'claude-sonnet-4-20250514',
  },
  {
    pattern: /\bclaude[\s-]*opus\b/i,
    resolve: () => parseUserSpecifiedModel('opus'),
  },
  {
    pattern: /\bclaude[\s-]*sonnet\b/i,
    resolve: () => parseUserSpecifiedModel('sonnet'),
  },
  {
    pattern: /\bclaude[\s-]*haiku\b/i,
    resolve: () => parseUserSpecifiedModel('haiku'),
  },
  {
    pattern: /\bgemini[\s-]*pro\b/i,
    resolve: 'google/gemini-3.1-pro',
  },
  {
    pattern: /\bgemini[\s-]*flash\b/i,
    resolve: 'google/gemini-2.5-flash-preview',
  },
  {
    pattern: /\bmaverick\b/i,
    resolve: 'meta-llama/llama-4-maverick',
  },
  {
    pattern: /\bdeepseek\b/i,
    resolve: 'deepseek/deepseek-chat-v3-0324',
  },
  {
    pattern: /\bqwen\b/i,
    resolve: 'qwen/qwen3-235b-a22b',
  },
  {
    pattern: /\bmistral\b/i,
    resolve: 'mistralai/mistral-large',
  },
  {
    pattern: /\bglm\b/i,
    resolve: 'z-ai/glm-5.1',
  },
  {
    pattern: /\bgemini\b/i,
    resolve: 'google/gemini-3.1-pro',
  },
  {
    pattern: /\bbest\b/i,
    resolve: () => getBestModel(),
  },
  {
    pattern: /\bopus\b/i,
    resolve: () => parseUserSpecifiedModel('opus'),
  },
  {
    pattern: /\bsonnet\b/i,
    resolve: () => parseUserSpecifiedModel('sonnet'),
  },
  {
    pattern: /\bhaiku\b/i,
    resolve: () => parseUserSpecifiedModel('haiku'),
  },
]

const MODEL_FUZZY_FILLER_PATTERN =
  /^[\s,.;:!?()[\]{}'"`+-]*(?:(?:set|switch|change|use|using|to|model|models|main|loop|please|the|a|an|for|as|on|run|with|me|just|want|wanna|make|it|be|default|into|power|void|give|us|some|of|kind|like|try|lets|let's)\b[\s,.;:!?()[\]{}'"`+-]*)*$/i

function findNextFriendlyModelMatch(
  text: string,
): FriendlyModelMatch | null {
  let best: FriendlyModelMatch | null = null

  for (let index = 0; index < FRIENDLY_MODEL_SPECS.length; index++) {
    const spec = FRIENDLY_MODEL_SPECS[index]!
    const match = spec.pattern.exec(text)
    if (!match || match.index === undefined) {
      continue
    }

    const candidate: FriendlyModelMatch = {
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
      model:
        typeof spec.resolve === 'function'
          ? spec.resolve(match[0])
          : spec.resolve,
      specIndex: index,
    }

    if (
      !best ||
      candidate.start < best.start ||
      (candidate.start === best.start && candidate.specIndex < best.specIndex)
    ) {
      best = candidate
    }
  }

  return best
}

export function extractFriendlyModelsFromText(
  text: string,
): ExtractedFriendlyModels {
  let working = text
  const matches: FriendlyModelMatch[] = []

  while (true) {
    const match = findNextFriendlyModelMatch(working)
    if (!match) {
      break
    }
    matches.push(match)
    working =
      working.slice(0, match.start) +
      ' '.repeat(match.end - match.start) +
      working.slice(match.end)
  }

  const seen = new Set<string>()
  const models: string[] = []
  for (const match of matches) {
    if (!seen.has(match.model)) {
      seen.add(match.model)
      models.push(match.model)
    }
  }

  return {
    matches,
    models,
    remainingText: working,
  }
}

export function looksLikeDirectModelId(input: string): boolean {
  const trimmed = input.trim()
  return DIRECT_MODEL_ID_PATTERNS.some(pattern => pattern.test(trimmed))
}

export function resolveFriendlyModelInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  if (looksLikeDirectModelId(trimmed)) {
    return trimmed
  }

  const extracted = extractFriendlyModelsFromText(trimmed)
  if (extracted.models.length !== 1) {
    return null
  }

  if (!MODEL_FUZZY_FILLER_PATTERN.test(extracted.remainingText)) {
    return null
  }

  return extracted.models[0]!
}
