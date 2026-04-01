/**
 * SDK event queue - stubbed (telemetry stripped)
 */

export function enqueueSdkEvent(_event: unknown): void {}

export function emitTaskTerminatedSdk(_taskId?: string, _status?: string, _metadata?: Record<string, unknown>): void {}

export function drainSdkEvents(): unknown[] {
  return []
}
