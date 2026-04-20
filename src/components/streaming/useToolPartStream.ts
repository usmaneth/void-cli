/**
 * React hook: subscribe to a ToolPart stream and expose the aggregated
 * snapshot as component state.
 *
 * Backpressure: raw events from a busy tool (Bash streaming 10k lines)
 * can fire at kilohertz rates; rendering Ink on every tick saturates
 * the terminal. We coalesce on a requestAnimationFrame-ish tick
 * (~30fps) so the UI updates visibly but the reconciler doesn't melt.
 *
 * - Events always feed the reducer immediately (no dropped data).
 * - The *rendered* snapshot is refreshed from a timer so at most one
 *   setState per 33ms. Final/cancel events flush immediately — the
 *   user shouldn't wait a frame to see the terminal transition.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyAggregate,
  reducePartEvent,
  type AggregatedParts,
  type PartEvent,
} from './aggregator.js'
import {
  getPartStream,
  isStreamingEnabled,
  peekPartStream,
  type PartStream,
  type ToolPart,
} from './toolParts.js'

const DEFAULT_FPS = 30
const frameInterval = (fps: number) => Math.max(16, Math.floor(1000 / fps))

export type UseToolPartStreamOptions = {
  /** Max frames per second for UI updates. Default 30. */
  fps?: number
  /** If true, will not create a stream on demand — returns empty if none. */
  passive?: boolean
}

export function useToolPartStream(
  toolUseID: string | undefined,
  opts: UseToolPartStreamOptions = {},
): AggregatedParts {
  const [snapshot, setSnapshot] = useState<AggregatedParts>(emptyAggregate)
  // Live aggregate mutates independently of React state so we don't
  // lose events between frames. setSnapshot merely sprays the newest
  // value on the next tick.
  const liveRef = useRef<AggregatedParts>(emptyAggregate())
  const dirtyRef = useRef(false)
  const frameRef = useRef<NodeJS.Timeout | null>(null)

  const fps = opts.fps ?? DEFAULT_FPS
  const interval = frameInterval(fps)

  useEffect(() => {
    if (!toolUseID) return
    if (!isStreamingEnabled()) return

    const stream: PartStream | undefined = opts.passive
      ? peekPartStream(toolUseID)
      : getPartStream(toolUseID)
    if (!stream) return

    // Replay any existing state would be nice but PartStream doesn't
    // buffer by design — it's a live pubsub. Mounting after parts have
    // already been emitted means we miss history; that's acceptable
    // because ToolCard always mounts at tool_use time (see
    // UserToolSuccessMessage wiring). If we ever need replay we can
    // add a ring buffer inside PartStream.

    const apply = (ev: PartEvent) => {
      const next = reducePartEvent(liveRef.current, ev)
      if (next === liveRef.current) return
      liveRef.current = next
      dirtyRef.current = true

      // Terminal events flush immediately so the UI sees the transition
      // in the same turn (final result, interrupted spinner, etc.).
      if (ev.type === 'final' || ev.type === 'cancel') {
        flush()
      } else {
        schedule()
      }
    }

    const flush = () => {
      if (frameRef.current) {
        clearTimeout(frameRef.current)
        frameRef.current = null
      }
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setSnapshot(liveRef.current)
    }

    const schedule = () => {
      if (frameRef.current != null) return
      frameRef.current = setTimeout(() => {
        frameRef.current = null
        if (!dirtyRef.current) return
        dirtyRef.current = false
        setSnapshot(liveRef.current)
      }, interval)
    }

    const onPart = (part: ToolPart) => apply({ type: 'part', part })
    const onFinal = () => apply({ type: 'final' })
    const onCancel = () => apply({ type: 'cancel' })

    stream.on('part', onPart)
    stream.on('final', onFinal)
    stream.on('cancel', onCancel)

    return () => {
      stream.off('part', onPart)
      stream.off('final', onFinal)
      stream.off('cancel', onCancel)
      if (frameRef.current) clearTimeout(frameRef.current)
      frameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolUseID, interval, opts.passive])

  return snapshot
}

/**
 * Convenience: memoized predicate for consumers that want to gate
 * rendering on whether streaming is active *right now*. Decouples the
 * ToolCard from the env-flag import.
 */
export function useIsStreamingEnabled(): boolean {
  return useMemo(() => isStreamingEnabled(), [])
}
