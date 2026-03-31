/**
 * Fetch telemetry - stubbed (telemetry stripped)
 */

export function classifyFetchError(_error: unknown): string {
  return 'unknown'
}

export function logPluginFetch(
  _url: string,
  _metadata?: Record<string, unknown>,
): void {}
