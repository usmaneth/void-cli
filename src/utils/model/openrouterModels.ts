import axios from 'axios'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'

/**
 * Represents an OpenRouter model from their API catalog.
 */
export type OpenRouterModel = {
  id: string
  name: string
  provider: string
  contextLength: number
  pricing: {
    prompt: number
    completion: number
  }
}

/** Cache TTL: 1 hour in milliseconds */
const CACHE_TTL_MS = 60 * 60 * 1000

interface CacheEnvelope {
  timestamp: number
  models: OpenRouterModel[]
}

function getCachePath(): string {
  const cacheDir = join(getClaudeConfigHomeDir(), 'cache')
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
  return join(cacheDir, 'openrouter-models.json')
}

function readCache(): CacheEnvelope | null {
  const cachePath = getCachePath()
  if (!existsSync(cachePath)) {
    return null
  }
  try {
    const raw = readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw) as CacheEnvelope
    if (
      typeof parsed.timestamp === 'number' &&
      Array.isArray(parsed.models) &&
      Date.now() - parsed.timestamp < CACHE_TTL_MS
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function writeCache(models: OpenRouterModel[]): void {
  const cachePath = getCachePath()
  const envelope: CacheEnvelope = { timestamp: Date.now(), models }
  try {
    writeFileSync(cachePath, JSON.stringify(envelope), 'utf-8')
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Fetch the full model catalog from OpenRouter.
 * Results are cached to ~/.void/cache/openrouter-models.json with a 1-hour TTL.
 */
export async function fetchOpenRouterModels(
  apiKey: string,
): Promise<OpenRouterModel[]> {
  // Try cache first
  const cached = readCache()
  if (cached) {
    return cached.models
  }

  const response = await axios.get('https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 15_000,
  })

  const rawModels: unknown[] = response.data?.data ?? []
  const models: OpenRouterModel[] = rawModels
    .filter(
      (m: any) =>
        typeof m?.id === 'string' &&
        typeof m?.name === 'string' &&
        typeof m?.context_length === 'number',
    )
    .map((m: any) => {
      // Provider is the first segment of the model ID (e.g. "openai" from "openai/gpt-4")
      const provider = m.id.split('/')[0] ?? 'unknown'
      return {
        id: m.id,
        name: m.name,
        provider,
        contextLength: m.context_length,
        pricing: {
          prompt: parseFloat(m.pricing?.prompt ?? '0'),
          completion: parseFloat(m.pricing?.completion ?? '0'),
        },
      }
    })

  writeCache(models)
  return models
}

/**
 * Extract unique provider names from a list of OpenRouter models.
 * Provider is derived from the first segment of the model ID.
 */
export function getUniqueProviders(models: OpenRouterModel[]): string[] {
  const providers = new Set<string>()
  for (const m of models) {
    providers.add(m.provider)
  }
  return Array.from(providers).sort()
}

/**
 * Filter models by optional search query and/or provider name.
 * Search matches against model id and name (case-insensitive).
 */
export function filterModels(
  models: OpenRouterModel[],
  query?: string,
  provider?: string,
): OpenRouterModel[] {
  let result = models

  if (provider) {
    const lowerProvider = provider.toLowerCase()
    result = result.filter((m) => m.provider.toLowerCase() === lowerProvider)
  }

  if (query) {
    const lowerQuery = query.toLowerCase()
    result = result.filter(
      (m) =>
        m.id.toLowerCase().includes(lowerQuery) ||
        m.name.toLowerCase().includes(lowerQuery),
    )
  }

  return result
}
