/**
 * Model discovery service — queries each provider's model list endpoint and
 * caches the resulting catalog for 24h at `~/.void/model-catalog.json`.
 *
 * When offline (no network / missing credentials) we fall back to a small
 * set of hard-coded "best-known" models and emit a warning so the caller
 * can inform the user.
 */

import axios, { type AxiosInstance } from 'axios'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

/**
 * Canonical provider identifiers that expose a model-list endpoint.
 */
export type DiscoveryProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'vercel'
  | 'gitlab'
  | 'gemini'
  // ChatGPT Plus/Pro subscription backend (chatgpt.com/backend-api).
  // Gated behind feature('CHATGPT_SUBSCRIPTION_AUTH') — gpt-5.5 is only
  // available here, not on the public /v1 OpenAI endpoint.
  | 'chatgptSubscription'

export interface DiscoveredModel {
  id: string
  provider: DiscoveryProvider
  name?: string
  contextLength?: number
  /** Raw payload the provider returned — useful for diagnostics. */
  raw?: unknown
}

export interface ProviderCatalog {
  provider: DiscoveryProvider
  fetchedAt: number
  models: DiscoveredModel[]
  /** When true, the models come from the hard-coded fallback table. */
  fallback?: boolean
  /** Optional message explaining why the fallback was used. */
  fallbackReason?: string
}

export interface ModelCatalog {
  version: 1
  providers: Partial<Record<DiscoveryProvider, ProviderCatalog>>
}

/** Cache TTL: 24h in milliseconds (override via VOID_MODEL_CATALOG_TTL_MS for tests). */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function getCacheTTL(): number {
  const fromEnv = process.env.VOID_MODEL_CATALOG_TTL_MS
  if (!fromEnv) return DEFAULT_CACHE_TTL_MS
  const n = Number.parseInt(fromEnv, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_MS
}

export function getCatalogPath(): string {
  const home = getClaudeConfigHomeDir()
  if (!existsSync(home)) {
    try {
      mkdirSync(home, { recursive: true })
    } catch {
      // ignore
    }
  }
  return join(home, 'model-catalog.json')
}

export function readCatalog(): ModelCatalog {
  const path = getCatalogPath()
  if (!existsSync(path)) {
    return { version: 1, providers: {} }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as ModelCatalog
    if (parsed?.version === 1 && parsed.providers) {
      return parsed
    }
  } catch {
    // Corrupt cache — treat as empty.
  }
  return { version: 1, providers: {} }
}

export function writeCatalog(catalog: ModelCatalog): void {
  const path = getCatalogPath()
  try {
    writeFileSync(path, JSON.stringify(catalog, null, 2), 'utf-8')
  } catch {
    // Cache write failure is non-fatal.
  }
}

export function isFresh(entry: ProviderCatalog | undefined, ttlMs: number = getCacheTTL()): boolean {
  if (!entry) return false
  if (entry.fallback) return false
  return Date.now() - entry.fetchedAt < ttlMs
}

/**
 * Hard-coded fallback catalog. Used when the live endpoint is unreachable or
 * the caller has no credentials. Keep this list short and opinionated — the
 * goal is to always return *something* so the CLI stays usable offline.
 */
export const FALLBACK_MODELS: Record<DiscoveryProvider, DiscoveredModel[]> = {
  anthropic: [
    { id: 'claude-opus-4-7-20260101', provider: 'anthropic', name: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6-20251101', provider: 'anthropic', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20250901', provider: 'anthropic', name: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4' },
    { id: 'gpt-5', provider: 'openai', name: 'GPT-5' },
    { id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1' },
  ],
  openrouter: [
    { id: 'anthropic/claude-opus-4.7', provider: 'openrouter' },
    { id: 'openai/gpt-5.4', provider: 'openrouter' },
    { id: 'google/gemini-3-pro', provider: 'openrouter' },
  ],
  vercel: [
    { id: 'anthropic/claude-opus-4.7', provider: 'vercel' },
    { id: 'openai/gpt-5.4', provider: 'vercel' },
    { id: 'google/gemini-3-pro', provider: 'vercel' },
  ],
  gitlab: [
    { id: 'duo-agent-platform-claude-sonnet-4', provider: 'gitlab' },
    { id: 'duo-workflow-claude', provider: 'gitlab' },
  ],
  gemini: [
    { id: 'gemini-3-pro-latest', provider: 'gemini', name: 'Gemini 3 Pro' },
    { id: 'gemini-2.5-flash', provider: 'gemini', name: 'Gemini 2.5 Flash' },
  ],
  // ChatGPT subscription backend — gpt-5.5 is only exposed here, not via /v1.
  // Only usable when feature('CHATGPT_SUBSCRIPTION_AUTH') is enabled AND the
  // user has run `void login chatgpt` to persist OAuth tokens.
  chatgptSubscription: [
    { id: 'gpt-5.5', provider: 'chatgptSubscription', name: 'GPT-5.5 (ChatGPT Plus/Pro)' },
  ],
}

export interface FetchContext {
  /** Optional injected HTTP client for testing. */
  http?: AxiosInstance
  /** Timeout in milliseconds. */
  timeoutMs?: number
}

type Fetcher = (ctx: FetchContext) => Promise<DiscoveredModel[]>

export const PROVIDER_FETCHERS: Record<DiscoveryProvider, Fetcher> = {
  anthropic: fetchAnthropic,
  openai: fetchOpenAI,
  openrouter: fetchOpenRouter,
  vercel: fetchVercel,
  gitlab: fetchGitLab,
  gemini: fetchGemini,
  chatgptSubscription: fetchChatgptSubscription,
}

function client(ctx: FetchContext): AxiosInstance {
  return ctx.http ?? axios.create({ timeout: ctx.timeoutMs ?? 15_000 })
}

async function fetchAnthropic(ctx: FetchContext): Promise<DiscoveredModel[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }
  const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
  const res = await client(ctx).get(`${base.replace(/\/$/, '')}/v1/models`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    timeout: ctx.timeoutMs ?? 15_000,
  })
  const data = (res.data?.data ?? []) as unknown[]
  return data
    .filter((m: any) => typeof m?.id === 'string')
    .map((m: any) => ({
      id: m.id as string,
      provider: 'anthropic' as const,
      name: typeof m.display_name === 'string' ? m.display_name : undefined,
      raw: m,
    }))
}

async function fetchOpenAI(ctx: FetchContext): Promise<DiscoveredModel[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  const res = await client(ctx).get(`${base.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: ctx.timeoutMs ?? 15_000,
  })
  const data = (res.data?.data ?? []) as unknown[]
  return data
    .filter((m: any) => typeof m?.id === 'string')
    .map((m: any) => ({
      id: m.id as string,
      provider: 'openai' as const,
      raw: m,
    }))
}

async function fetchOpenRouter(ctx: FetchContext): Promise<DiscoveredModel[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  // OpenRouter's /models endpoint is public but we still include the key when present.
  const res = await client(ctx).get('https://openrouter.ai/api/v1/models', {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    timeout: ctx.timeoutMs ?? 15_000,
  })
  const data = (res.data?.data ?? []) as unknown[]
  return data
    .filter((m: any) => typeof m?.id === 'string')
    .map((m: any) => ({
      id: m.id as string,
      provider: 'openrouter' as const,
      name: typeof m.name === 'string' ? m.name : undefined,
      contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
      raw: m,
    }))
}

async function fetchVercel(ctx: FetchContext): Promise<DiscoveredModel[]> {
  const apiKey = process.env.VERCEL_AI_GATEWAY_KEY ?? process.env.AI_GATEWAY_API_KEY
  if (!apiKey) {
    throw new Error('VERCEL_AI_GATEWAY_KEY is not set')
  }
  // Vercel AI Gateway exposes an OpenAI-compatible /v1/models endpoint.
  const base = process.env.VERCEL_AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.vercel.sh/v1'
  const res = await client(ctx).get(`${base.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: ctx.timeoutMs ?? 15_000,
  })
  const data = (res.data?.data ?? res.data?.models ?? []) as unknown[]
  return data
    .filter((m: any) => typeof m?.id === 'string')
    .map((m: any) => ({
      id: m.id as string,
      provider: 'vercel' as const,
      name: typeof m.name === 'string' ? m.name : undefined,
      raw: m,
    }))
}

async function fetchGitLab(ctx: FetchContext): Promise<DiscoveredModel[]> {
  const token = process.env.GITLAB_TOKEN
  if (!token) {
    throw new Error('GITLAB_TOKEN is not set')
  }
  const host = (process.env.GITLAB_HOST ?? 'https://gitlab.com').replace(/\/$/, '')
  // GitLab's Duo Agent Platform exposes an AI models list under /api/v4/ai/agents/models.
  // Self-hosted instances honour the same path relative to GITLAB_HOST.
  const res = await client(ctx).get(`${host}/api/v4/ai/agents/models`, {
    headers: { 'PRIVATE-TOKEN': token },
    timeout: ctx.timeoutMs ?? 15_000,
  })
  const data = (Array.isArray(res.data) ? res.data : res.data?.models ?? []) as unknown[]
  return data
    .filter((m: any) => typeof m?.id === 'string' || typeof m?.name === 'string')
    .map((m: any) => ({
      id: (m.id ?? m.name) as string,
      provider: 'gitlab' as const,
      name: typeof m.name === 'string' ? m.name : undefined,
      contextLength: typeof m.context === 'number' ? m.context : undefined,
      raw: m,
    }))
}

/**
 * ChatGPT-subscription "discovery" — there is no list endpoint on chatgpt.com
 * for the subscription-only models, so we short-circuit to the FALLBACK entry
 * whenever the user has persisted OAuth tokens. This keeps the catalog honest
 * without hitting the network.
 */
async function fetchChatgptSubscription(_ctx: FetchContext): Promise<DiscoveredModel[]> {
  // Lazy-require to avoid circular imports at module load time.
  const { loadTokens } = require('../../utils/auth/openaiTokenStore.js') as {
    loadTokens: () => { access_token?: string } | null
  }
  const tokens = loadTokens()
  if (!tokens?.access_token) {
    throw new Error('No ChatGPT subscription tokens — run `void login chatgpt` first')
  }
  return FALLBACK_MODELS.chatgptSubscription
}

async function fetchGemini(ctx: FetchContext): Promise<DiscoveredModel[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set')
  }
  const base = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta'
  const res = await client(ctx).get(`${base.replace(/\/$/, '')}/models`, {
    params: { key: apiKey },
    timeout: ctx.timeoutMs ?? 15_000,
  })
  const data = (res.data?.models ?? []) as unknown[]
  return data
    .filter((m: any) => typeof m?.name === 'string')
    .map((m: any) => ({
      id: (m.name as string).replace(/^models\//, ''),
      provider: 'gemini' as const,
      name: typeof m.displayName === 'string' ? m.displayName : undefined,
      contextLength: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : undefined,
      raw: m,
    }))
}

export interface DiscoverOptions {
  /** Which provider(s) to query. Defaults to all providers with credentials. */
  providers?: DiscoveryProvider[]
  /** When true, bypass the on-disk cache and refetch. */
  refresh?: boolean
  /** Override the catalog cache for testing. */
  existingCatalog?: ModelCatalog
  /** Injected HTTP client for tests. */
  http?: AxiosInstance
  /** Request timeout. */
  timeoutMs?: number
}

export interface DiscoverResult {
  catalog: ModelCatalog
  warnings: string[]
}

/**
 * Return the list of providers that have credentials available for discovery.
 */
export function providersWithCredentials(): DiscoveryProvider[] {
  const list: DiscoveryProvider[] = []
  if (process.env.ANTHROPIC_API_KEY) list.push('anthropic')
  if (process.env.OPENAI_API_KEY) list.push('openai')
  // OpenRouter's models endpoint is public — always include.
  list.push('openrouter')
  if (process.env.VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY) {
    list.push('vercel')
  }
  if (process.env.GITLAB_TOKEN) list.push('gitlab')
  if (process.env.GEMINI_API_KEY) list.push('gemini')
  // ChatGPT subscription is credentialed via persisted OAuth tokens at
  // ~/.void/chatgpt-auth.json. We probe lazily to avoid loading the token
  // store at module init time.
  try {
    const { loadTokens } = require('../../utils/auth/openaiTokenStore.js') as {
      loadTokens: () => { access_token?: string } | null
    }
    if (loadTokens()?.access_token) list.push('chatgptSubscription')
  } catch {
    // non-fatal — just skip
  }
  return list
}

/**
 * Discover models for the requested providers. Respects the 24h cache unless
 * `refresh` is true. Any provider that fails produces a fallback entry plus a
 * warning in the returned result.
 */
export async function discoverModels(
  opts: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const catalog = opts.existingCatalog ?? readCatalog()
  const warnings: string[] = []
  const targets = opts.providers?.length
    ? opts.providers
    : providersWithCredentials()

  for (const provider of targets) {
    const cached = catalog.providers[provider]
    if (!opts.refresh && isFresh(cached)) {
      continue
    }
    try {
      const models = await PROVIDER_FETCHERS[provider]({
        http: opts.http,
        timeoutMs: opts.timeoutMs,
      })
      catalog.providers[provider] = {
        provider,
        fetchedAt: Date.now(),
        models,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      warnings.push(
        `Could not reach ${provider} model-list endpoint: ${reason}. Using fallback catalog.`,
      )
      catalog.providers[provider] = {
        provider,
        fetchedAt: Date.now(),
        fallback: true,
        fallbackReason: reason,
        models: FALLBACK_MODELS[provider],
      }
    }
  }

  if (!opts.existingCatalog) {
    writeCatalog(catalog)
  }

  return { catalog, warnings }
}

/**
 * Flatten the catalog into a single list of discovered models. Useful for
 * filtering + rendering in the CLI.
 */
export function flattenCatalog(
  catalog: ModelCatalog,
  filter?: DiscoveryProvider,
): DiscoveredModel[] {
  const out: DiscoveredModel[] = []
  for (const [provider, entry] of Object.entries(catalog.providers)) {
    if (filter && provider !== filter) continue
    if (!entry) continue
    out.push(...entry.models)
  }
  return out
}
