/**
 * Telemetry logger - stubbed (telemetry stripped)
 */

export function logTelemetry(
  _eventName: string,
  _metadata?: Record<string, unknown>,
): void {}

export class ClaudeCodeDiagLogger {
  debug(_msg: string, ..._args: unknown[]): void {}
  info(_msg: string, ..._args: unknown[]): void {}
  warn(_msg: string, ..._args: unknown[]): void {}
  error(_msg: string, ..._args: unknown[]): void {}
}
