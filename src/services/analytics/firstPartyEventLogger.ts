/**
 * First party event logger - stubbed (telemetry stripped)
 */

export function shutdown1PEventLogging(): void {}

export function logEventTo1P(
  _eventName: string,
  _additionalMetadata?: Record<string, unknown>,
): void {}

export function is1PEventLoggingEnabled(): boolean {
  return false
}

export function logGrowthBookExperimentTo1P(
  _experimentId: string,
  _variationId: number,
  _inExperiment: boolean,
  _hashAttribute: string,
  _hashValue: string,
): void {}
