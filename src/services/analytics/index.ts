/**
 * Analytics service - stubbed (telemetry stripped)
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  return metadata
}

export type AnalyticsSink = {
  logEvent: (
    eventName: string,
    metadata: { [key: string]: boolean | number | undefined },
  ) => void
  logEventAsync: (
    eventName: string,
    metadata: { [key: string]: boolean | number | undefined },
  ) => Promise<void>
}

export function attachAnalyticsSink(_newSink: AnalyticsSink): void {}

export function logEvent(
  _eventName: string,
  _metadata: { [key: string]: boolean | number | undefined },
): void {}

export async function logEventAsync(
  _eventName: string,
  _metadata: { [key: string]: boolean | number | undefined },
): Promise<void> {}

export function _resetForTesting(): void {}
