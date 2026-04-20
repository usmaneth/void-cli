/**
 * ToolPart streaming abstraction.
 *
 * A ToolPart is a granular unit of tool output (a line of stdout, a
 * resolved file path, a computed diff, a result-count tick). Rather than
 * the previous "single final blob" model, tools can publish parts as
 * they progress; the UI subscribes and re-renders each tick.
 *
 * Ported in spirit from opencode's session renderer: see
 * /tmp/opencode-src/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
 * for the pattern (a `part.state.status` that transitions pending →
 * streaming → completed/error and drives incremental rendering).
 *
 * This module is self-contained on purpose — it does not modify the
 * existing Tool.ts progress contract. Tool authors (or a bridge layer)
 * opt in by calling `emitPart()` alongside their existing `onProgress`
 * callback. When the VOID_STREAMING_PARTS flag is off, emitPart is a
 * no-op and nothing subscribes.
 */

import { EventEmitter } from 'events'
import { isEnvTruthy } from '../../utils/envUtils.js'

/** Feature flag — opt-in so we can A/B in dev before defaulting on. */
export function isStreamingEnabled(): boolean {
  return isEnvTruthy(process.env.VOID_STREAMING_PARTS)
}

export type ToolPartState = 'pending' | 'streaming' | 'complete' | 'error'

/**
 * Discriminated union covering the part kinds we render today. Extend
 * this union (not a string enum) so downstream reducers get exhaustive
 * type-checking when a new kind is added.
 */
export type ToolPart =
  /** A single line of stdout/stderr. `stream` distinguishes the source. */
  | {
      kind: 'bash_line'
      id: string
      sequence: number
      state: ToolPartState
      stream: 'stdout' | 'stderr'
      text: string
      error?: string
    }
  /** Path resolved — show immediately, before we know size. */
  | {
      kind: 'read_path'
      id: string
      sequence: number
      state: ToolPartState
      path: string
      error?: string
    }
  /** Size/line-count info for an in-flight read. */
  | {
      kind: 'read_meta'
      id: string
      sequence: number
      state: ToolPartState
      sizeBytes?: number
      lineCount?: number
      error?: string
    }
  /** Skeleton diff — path + hunks count, before bodies arrive. */
  | {
      kind: 'edit_skeleton'
      id: string
      sequence: number
      state: ToolPartState
      path: string
      hunkCount?: number
      error?: string
    }
  /** Filled diff body for a specific hunk. */
  | {
      kind: 'edit_hunk'
      id: string
      sequence: number
      state: ToolPartState
      hunkIndex: number
      beforeSnippet?: string
      afterSnippet?: string
      error?: string
    }
  /** Result count ticking up (Glob/Grep). */
  | {
      kind: 'search_count'
      id: string
      sequence: number
      state: ToolPartState
      total: number
      error?: string
    }
  /** Free-form text line — fallback for tools we haven't specialized. */
  | {
      kind: 'text_line'
      id: string
      sequence: number
      state: ToolPartState
      text: string
      error?: string
    }

export type ToolPartKind = ToolPart['kind']

/** Narrow by kind — useful in reducers. */
export function partOfKind<K extends ToolPartKind>(
  kind: K,
  part: ToolPart,
): part is Extract<ToolPart, { kind: K }> {
  return part.kind === kind
}

// ---------------------------------------------------------------------------
// Per-invocation event streams
// ---------------------------------------------------------------------------

/**
 * Events emitted by a PartStream:
 * - 'part'   → a new or updated ToolPart
 * - 'final'  → the tool finished (all parts flushed to state=complete unless error)
 * - 'cancel' → Ctrl+C or otherwise aborted; consumers should mark any streaming
 *              parts as state='error' with error='interrupted' and stop rendering live.
 */
export class PartStream extends EventEmitter {
  readonly toolUseID: string
  private _finalized = false
  private _cancelled = false
  private _seq = 0

  constructor(toolUseID: string) {
    super()
    // Prevent accidental warnings; ToolCard is the only expected subscriber
    // per id but there may be double-mounts during dev.
    this.setMaxListeners(32)
    this.toolUseID = toolUseID
  }

  get isFinalized(): boolean {
    return this._finalized
  }

  get isCancelled(): boolean {
    return this._cancelled
  }

  nextSequence(): number {
    return this._seq++
  }

  /** Publish a part. Sequence is auto-assigned if omitted. */
  emit_part(part: Omit<ToolPart, 'sequence'> & { sequence?: number }): boolean {
    if (this._finalized || this._cancelled) return false
    const seq = part.sequence ?? this.nextSequence()
    const full = { ...part, sequence: seq } as ToolPart
    return this.emit('part', full)
  }

  finalize(): void {
    if (this._finalized) return
    this._finalized = true
    this.emit('final')
  }

  cancel(): void {
    if (this._cancelled || this._finalized) return
    this._cancelled = true
    this.emit('cancel')
  }
}

// ---------------------------------------------------------------------------
// Registry — lookup by toolUseID so the renderer and the emitter can find
// the same stream without threading refs through props.
// ---------------------------------------------------------------------------

const STREAMS = new Map<string, PartStream>()

/** Get or create the PartStream for a given toolUseID. */
export function getPartStream(toolUseID: string): PartStream {
  let s = STREAMS.get(toolUseID)
  if (!s) {
    s = new PartStream(toolUseID)
    STREAMS.set(toolUseID, s)
  }
  return s
}

/** Peek — does not create a stream. */
export function peekPartStream(toolUseID: string): PartStream | undefined {
  return STREAMS.get(toolUseID)
}

/** Clear a stream. Called on final render so long sessions don't leak. */
export function disposePartStream(toolUseID: string): void {
  const s = STREAMS.get(toolUseID)
  if (!s) return
  s.removeAllListeners()
  STREAMS.delete(toolUseID)
}

/** Publish a part if streaming is enabled. No-op otherwise. */
export function emitPart(
  toolUseID: string,
  part: Omit<ToolPart, 'sequence' | 'id'> & { id?: string; sequence?: number },
): void {
  if (!isStreamingEnabled()) return
  const stream = getPartStream(toolUseID)
  const id = part.id ?? `${part.kind}-${stream.nextSequence()}`
  stream.emit_part({ ...part, id } as ToolPart)
}

/** Mark a stream as cancelled (Ctrl+C path). */
export function cancelStream(toolUseID: string): void {
  const s = STREAMS.get(toolUseID)
  s?.cancel()
}

/** Mark a stream as finalized after the tool completes (with or without error). */
export function finalizeStream(toolUseID: string): void {
  const s = STREAMS.get(toolUseID)
  s?.finalize()
}

/** Test-only: reset the registry. Not exported via barrel. */
export function __resetRegistryForTests(): void {
  for (const s of STREAMS.values()) s.removeAllListeners()
  STREAMS.clear()
}
