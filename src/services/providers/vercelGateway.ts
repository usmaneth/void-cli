/**
 * Vercel AI Gateway provider — exposes an OpenAI-compatible `/v1/chat/completions`
 * and `/v1/models` endpoint that fronts every major LLM provider (Anthropic,
 * OpenAI, Google, Groq, Mistral, ...). Enabled when `VOID_USE_VERCEL_GATEWAY=1`
 * and `VERCEL_AI_GATEWAY_KEY` is set.
 *
 * We re-use the existing OpenAI-compatible client shim because the gateway is
 * wire-protocol compatible with OpenAI. If `@ai-sdk/vercel` is available in the
 * running process we prefer it (lazily loaded) so downstream code that wants a
 * richer provider object can opt in.
 */

import { createOpenAIShimClient } from '../api/openaiShim.js'

/** Default Vercel AI Gateway base URL (OpenAI-compatible). */
export const VERCEL_AI_GATEWAY_DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh/v1'

const DEFAULT_TIMEOUT_MS = 60_000

export interface VercelGatewayClientOptions {
  timeout?: number
  /** Override the base URL (useful for regional gateways). */
  baseURL?: string
}

/**
 * Resolve the Vercel AI Gateway API key. Accepts the canonical
 * `VERCEL_AI_GATEWAY_KEY` and the legacy `AI_GATEWAY_API_KEY` env var.
 */
export function getVercelGatewayApiKey(): string | null {
  return (
    process.env.VERCEL_AI_GATEWAY_KEY ??
    process.env.AI_GATEWAY_API_KEY ??
    null
  )
}

/**
 * Return the configured base URL for the gateway.
 */
export function getVercelGatewayBaseUrl(): string {
  return (
    process.env.VERCEL_AI_GATEWAY_BASE_URL ??
    VERCEL_AI_GATEWAY_DEFAULT_BASE_URL
  )
}

/**
 * Create an Anthropic-compatible client that talks to the Vercel AI Gateway
 * via the OpenAI wire protocol.
 */
export function createVercelGatewayClient(
  apiKey: string,
  options: VercelGatewayClientOptions = {},
) {
  return createOpenAIShimClient({
    apiKey,
    baseURL: options.baseURL ?? getVercelGatewayBaseUrl(),
    defaultHeaders: {
      'x-provider': 'vercel-ai-gateway',
    },
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  })
}

/**
 * Lazily load `@ai-sdk/vercel` if installed. Returns `null` when the package
 * is not present — callers should fall back to the OpenAI shim in that case.
 */
export async function tryLoadVercelAiSdk(): Promise<unknown | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import('@ai-sdk/vercel').catch(() => null)
    return mod ?? null
  } catch {
    return null
  }
}
