/**
 * Stub: Claude.ai rate limits removed in Void CLI rebrand.
 * Types and no-op exports retained to avoid breaking dependents.
 */

// Re-export message functions from centralized location
export {
  getRateLimitErrorMessage,
  getRateLimitWarning,
  getUsingOverageText,
} from './rateLimitMessages.js'

type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

export function getRateLimitDisplayName(_type: RateLimitType): string {
  return 'rate limit'
}

export type OverageDisabledReason =
  | 'overage_not_provisioned'
  | 'org_level_disabled'
  | 'org_level_disabled_until'
  | 'out_of_credits'
  | 'seat_tier_level_disabled'
  | 'member_level_disabled'
  | 'seat_tier_zero_credit_limit'
  | 'group_zero_credit_limit'
  | 'member_zero_credit_limit'
  | 'org_service_level_disabled'
  | 'org_service_zero_credit_limit'
  | 'no_limits_configured'
  | 'unknown'

export type ClaudeAILimits = {
  status: QuotaStatus
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: QuotaStatus
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

type StatusChangeListener = (limits: ClaudeAILimits) => void

export let currentLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

type RawUtilization = {
  utilization: number | undefined
  rateLimitType: RateLimitType | undefined
  five_hour?: { utilization: number; rateLimitType: RateLimitType } | undefined
  seven_day?: { utilization: number; rateLimitType: RateLimitType } | undefined
}

export function getRawUtilization(): RawUtilization {
  return { utilization: undefined, rateLimitType: undefined }
}

export const statusListeners: Set<StatusChangeListener> = new Set()

export function emitStatusChange(_limits: ClaudeAILimits): void {
  // no-op
}

export async function checkQuotaStatus(): Promise<void> {
  // no-op
}

export function extractQuotaStatusFromHeaders(
  _headers: Record<string, string | null | undefined>,
): void {
  // no-op
}

export function extractQuotaStatusFromError(_error: unknown): void {
  // no-op
}
