/**
 * Session Tracing - stubbed (telemetry stripped)
 */

import type { Span } from '@opentelemetry/api'

// Re-export for callers
export type { Span }

export type LLMRequestNewContext = {
  querySource?: string
  [key: string]: unknown
}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function isEnhancedTelemetryEnabled(): boolean {
  return false
}

const dummySpan: Span = {
  spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
  setAttribute: () => dummySpan,
  setAttributes: () => dummySpan,
  addEvent: () => dummySpan,
  addLink: () => dummySpan,
  addLinks: () => dummySpan,
  setStatus: () => dummySpan,
  updateName: () => dummySpan,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
} as unknown as Span

export function startInteractionSpan(_userPrompt: string): Span {
  return dummySpan
}

export function endInteractionSpan(): void {}

export function startLLMRequestSpan(
  _model: string,
  _newContext?: LLMRequestNewContext,
  _messagesForAPI?: unknown[],
  _fastMode?: boolean,
): Span {
  return dummySpan
}

export function endLLMRequestSpan(
  _span?: Span,
  _metadata?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    success?: boolean
    statusCode?: number
    error?: string
    attempt?: number
    modelResponse?: string
    modelOutput?: string
    thinkingOutput?: string
    hasToolCall?: boolean
    ttftMs?: number
    requestSetupMs?: number
    attemptStartTimes?: number[]
  },
): void {}

export function startToolSpan(
  _toolName: string,
  _toolAttributes?: Record<string, string | number | boolean>,
  _toolInput?: string,
): Span {
  return dummySpan
}

export function startToolBlockedOnUserSpan(): Span {
  return dummySpan
}

export function endToolBlockedOnUserSpan(
  _decision?: string,
  _source?: string,
): void {}

export function startToolExecutionSpan(): Span {
  return dummySpan
}

export function endToolExecutionSpan(_metadata?: {
  success?: boolean
  error?: string
}): void {}

export function endToolSpan(
  _toolResult?: string,
  _resultTokens?: number,
): void {}

export function addToolContentEvent(
  _eventName: string,
  _attributes: Record<string, string | number | boolean>,
): void {}

export function getCurrentSpan(): Span | null {
  return null
}

export async function executeInSpan<T>(
  _spanName: string,
  fn: (span: Span) => Promise<T>,
  _attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return fn(dummySpan)
}

export function startHookSpan(
  _hookEvent: string,
  _hookName: string,
  _numHooks: number,
  _hookDefinitions: string,
): Span {
  return dummySpan
}

export function endHookSpan(
  _span: Span,
  _metadata?: {
    numSuccess?: number
    numBlocking?: number
    numNonBlockingError?: number
    numCancelled?: number
  },
): void {}
