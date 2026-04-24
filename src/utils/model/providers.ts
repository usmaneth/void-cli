import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'vercelGateway'
  | 'gitlab'
  | 'chatgptSubscription'

/**
 * Resolve the active API provider based on `VOID_USE_*` env flags. The order
 * below is the authoritative precedence — flags earlier in the chain win.
 *
 * We keep the original `isEnvTruthy` chain (rather than switching to a lookup
 * table) so call sites that expected `firstParty` to be the default continue
 * to work when *no* flag is set.
 */
export function getAPIProvider(): APIProvider {
  if (isEnvTruthy(process.env.VOID_USE_BEDROCK)) return 'bedrock'
  if (isEnvTruthy(process.env.VOID_USE_VERTEX)) return 'vertex'
  if (isEnvTruthy(process.env.VOID_USE_FOUNDRY)) return 'foundry'
  if (isEnvTruthy(process.env.VOID_USE_CHATGPT_SUBSCRIPTION)) return 'chatgptSubscription'
  if (isEnvTruthy(process.env.VOID_USE_OPENAI)) return 'openai'
  if (isEnvTruthy(process.env.VOID_USE_GEMINI)) return 'gemini'
  if (isEnvTruthy(process.env.VOID_USE_OPENROUTER)) return 'openrouter'
  if (isEnvTruthy(process.env.VOID_USE_VERCEL_GATEWAY)) return 'vercelGateway'
  if (isEnvTruthy(process.env.VOID_USE_GITLAB)) return 'gitlab'
  return 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
