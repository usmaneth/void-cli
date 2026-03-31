/**
 * Denial tracking - stubbed (telemetry stripped)
 */

export type DenialTrackingState = {
  denials: Map<string, number>
  successes: Map<string, number>
  consecutiveDenials: number
  totalDenials: number
}

export const DENIAL_LIMITS = {
  maxDenials: 3,
  fallbackThreshold: 2,
} as const

export function createDenialTrackingState(): DenialTrackingState {
  return {
    denials: new Map(),
    successes: new Map(),
    consecutiveDenials: 0,
    totalDenials: 0,
  }
}

export function recordDenial(
  _state: DenialTrackingState,
  _toolName: string,
): void {}

export function recordSuccess(
  _state: DenialTrackingState,
  _toolName: string,
): void {}

export function shouldFallbackToPrompting(
  _state: DenialTrackingState,
  _toolName: string,
): boolean {
  return false
}
