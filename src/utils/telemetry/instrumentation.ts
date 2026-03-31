/**
 * OpenTelemetry instrumentation - stubbed (telemetry stripped)
 */

export function bootstrapTelemetry(): void {}

export function parseExporterTypes(_value: string | undefined): string[] {
  return []
}

export function isTelemetryEnabled(): boolean {
  return false
}

export async function initializeTelemetry(): Promise<undefined> {
  return undefined
}

export async function flushTelemetry(): Promise<void> {}
