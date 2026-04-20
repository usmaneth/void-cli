/**
 * Pure reducer for ToolPart event streams.
 *
 * Keeps the React hook thin: the hook feeds parts/cancel/final events
 * into `reducePartEvent` and stores the returned AggregatedParts in
 * React state. No timers, no effects — this module is side-effect-free
 * so unit tests can drive it synchronously with ordinary arrays.
 *
 * Responsibilities:
 * - **Ordering** — parts are stored by sequence, ascending. Late-arriving
 *   parts with smaller sequence numbers are inserted in order, not
 *   appended.
 * - **Dedupe** — parts are keyed by `id`. If the same id arrives again,
 *   the later one replaces the earlier (state transitions, filling in
 *   metadata, etc.).
 * - **Final-state transitions** — on 'final', any part still in
 *   'streaming' or 'pending' flips to 'complete'. On 'cancel', they flip
 *   to 'error' with error='interrupted'. This mirrors how opencode's
 *   renderer treats a late cancellation: the partial content stays
 *   visible but rendering halts.
 */

import type { ToolPart, ToolPartState } from './toolParts.js'

export type AggregatedParts = {
  /** Parts in ascending sequence order. */
  ordered: ToolPart[]
  /** True once we've seen a 'final' event. */
  done: boolean
  /** True once we've seen a 'cancel' event. */
  cancelled: boolean
}

export function emptyAggregate(): AggregatedParts {
  return { ordered: [], done: false, cancelled: false }
}

export type PartEvent =
  | { type: 'part'; part: ToolPart }
  | { type: 'final' }
  | { type: 'cancel' }

/**
 * Apply a single event to an AggregatedParts snapshot. Returns a new
 * snapshot when it changes; returns the same reference when nothing
 * changed (so React bails out of re-renders).
 */
export function reducePartEvent(
  prev: AggregatedParts,
  event: PartEvent,
): AggregatedParts {
  switch (event.type) {
    case 'part':
      return mergePart(prev, event.part)
    case 'final':
      return finalize(prev)
    case 'cancel':
      return cancel(prev)
  }
}

function mergePart(prev: AggregatedParts, part: ToolPart): AggregatedParts {
  // Ignore further parts after a terminal transition. Without this a
  // late 'part' after 'cancel' could flip an errored part back to
  // 'streaming' — we explicitly want partial content frozen.
  if (prev.cancelled || prev.done) {
    return prev
  }

  const existingIdx = prev.ordered.findIndex(p => p.id === part.id)
  if (existingIdx !== -1) {
    // Dedupe: replace in place. Preserve sequence from the newer event
    // so re-ordering uses the freshest info.
    const next = prev.ordered.slice()
    // Guard against state regression (complete → streaming). This can
    // happen if a progress tick arrives after the final result was
    // already emitted — keep the later-terminal state.
    const existing = prev.ordered[existingIdx]
    const merged =
      stateRank(existing.state) > stateRank(part.state)
        ? { ...part, state: existing.state }
        : part
    next[existingIdx] = merged
    return { ...prev, ordered: next }
  }

  // New part: insert in sequence order. In the common case parts
  // arrive in order so the splice hits the tail; the loop handles
  // rare interleavings (e.g., two tools racing on a shared queue).
  const next = prev.ordered.slice()
  let i = next.length
  while (i > 0 && next[i - 1].sequence > part.sequence) {
    i--
  }
  next.splice(i, 0, part)
  return { ...prev, ordered: next }
}

function finalize(prev: AggregatedParts): AggregatedParts {
  if (prev.done) return prev
  const ordered = prev.ordered.map(p =>
    p.state === 'pending' || p.state === 'streaming'
      ? ({ ...p, state: 'complete' } as ToolPart)
      : p,
  )
  return { ...prev, ordered, done: true }
}

function cancel(prev: AggregatedParts): AggregatedParts {
  if (prev.cancelled || prev.done) return prev
  const ordered = prev.ordered.map(p =>
    p.state === 'pending' || p.state === 'streaming'
      ? ({ ...p, state: 'error', error: 'interrupted' } as ToolPart)
      : p,
  )
  return { ordered, done: false, cancelled: true }
}

function stateRank(s: ToolPartState): number {
  switch (s) {
    case 'pending':
      return 0
    case 'streaming':
      return 1
    case 'complete':
      return 2
    case 'error':
      return 3
  }
}
