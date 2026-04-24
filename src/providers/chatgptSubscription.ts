/**
 * ChatGPT subscription provider — uses a persisted OpenAI OAuth token to call
 * chatgpt.com/backend-api via the Responses API shim.
 *
 * Gated behind feature('CHATGPT_SUBSCRIPTION_AUTH'); callers must check before
 * invoking the factory.
 *
 * This is Void's personal-use ChatGPT Plus/Pro integration. It piggybacks on
 * Codex CLI's registered OAuth client (see `openaiOauth.ts` TOS note). It is
 * not a general-purpose OpenAI API provider — use `openai.ts` for that.
 */

import { createResponsesApiShimClient } from '../services/api/responsesApiShim.js'
import {
  DEFAULT_CHATGPT_BACKEND_BASE_URL,
} from '../utils/auth/openaiOauth.js'
import {
  getValidAccessToken,
  loadTokens,
} from '../utils/auth/openaiTokenStore.js'

const DEFAULT_TIMEOUT_MS = 10 * 60_000

export interface ChatgptSubscriptionClientOptions {
  /** Override the base URL — primarily for tests. */
  baseURL?: string
  /** Timeout in ms for a full streamed response. */
  timeout?: number
  /** Conversation id used as `prompt_cache_key`. */
  conversationId?: string
  /** Extra headers to merge onto every request. */
  defaultHeaders?: Record<string, string>
}

/**
 * Create a ChatGPT-subscription client. Returns an Anthropic-compatible shim.
 *
 * Throws synchronously only if tokens are missing; token refresh happens lazily
 * on each request via `getValidAccessToken()`.
 */
export function createChatgptSubscriptionClient(
  options?: ChatgptSubscriptionClientOptions,
) {
  const baseURL =
    options?.baseURL ??
    process.env.CHATGPT_BACKEND_BASE_URL ??
    DEFAULT_CHATGPT_BACKEND_BASE_URL

  return createResponsesApiShimClient({
    baseURL,
    timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
    conversationId: options?.conversationId,
    defaultHeaders: options?.defaultHeaders ?? {},
    getAccessToken: () => getValidAccessToken(),
    getAccountId: async () => {
      const tokens = loadTokens()
      return tokens?.chatgpt_account_id
    },
  })
}

/**
 * Returns true iff a ChatGPT-subscription token is already persisted (does NOT
 * verify it is still valid — call getValidAccessToken() for that).
 */
export function hasChatgptSubscriptionAuth(): boolean {
  const tokens = loadTokens()
  return !!(tokens?.access_token && tokens.refresh_token)
}

/**
 * Factory used by model routing — mirrors the naming pattern from openai.ts /
 * gemini.ts, but without the API-key arg since auth is persisted.
 */
export function getChatgptSubscriptionClient(
  options?: ChatgptSubscriptionClientOptions,
) {
  return createChatgptSubscriptionClient(options)
}
