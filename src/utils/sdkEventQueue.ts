/**
 * SDK event queue - stubbed (telemetry stripped)
 */

export function enqueueSdkEvent(_event: unknown): void {}

export function emitTaskTerminatedSdk(_taskId?: string): void {}

export function drainSdkEvents(): unknown[] {
  return []
}
