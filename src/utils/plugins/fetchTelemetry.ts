/**
 * Fetch telemetry - stubbed (telemetry stripped)
 */

export function classifyFetchError(_error: unknown): string {
  return 'unknown'
}

export function logPluginFetch(
  _label: string,
  _url?: string,
  _status?: string,
  _duration?: number,
  _error?: string,
): void {}
