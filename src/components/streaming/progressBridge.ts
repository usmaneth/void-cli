/**
 * Bridge: convert existing ToolCallProgress events into ToolPart events.
 *
 * Tools in this repo already emit `onProgress({ toolUseID, data })`
 * with shape-per-tool payloads (BashProgress, etc.). Rather than
 * rewriting every tool, we wrap the callback: inspect the data, and if
 * we recognize the shape, emit one or more ToolParts into the stream
 * for that toolUseID.
 *
 * Unrecognized progress shapes pass through untouched — the tool's
 * existing ProgressMessage rendering still works, so this is additive.
 *
 * When VOID_STREAMING_PARTS is unset, `wrapProgressCallback` returns
 * the original callback unchanged so there's zero overhead.
 */

import {
  emitPart,
  isStreamingEnabled,
  type ToolPart,
} from './toolParts.js'

/** Type-narrow helpers — progress payloads are typed as `any` in this repo. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export type ProgressBridgeInput = {
  toolUseID: string
  data: unknown
}

/**
 * Translate one progress event into zero-or-more ToolParts. Kept pure
 * (no side effects) so the bridge layer can be tested against sample
 * payloads.
 */
export function progressToParts(evt: ProgressBridgeInput): ToolPart[] {
  const { toolUseID, data } = evt
  if (!isRecord(data)) return []
  const out: ToolPart[] = []
  const mkId = (suffix: string) => `${toolUseID}:${suffix}`

  // Bash — BashProgress carries `lines` or `stdout` chunks.
  if ('lines' in data && Array.isArray(data.lines)) {
    for (let i = 0; i < data.lines.length; i++) {
      const raw = data.lines[i]
      const text = typeof raw === 'string' ? raw : String(raw ?? '')
      out.push({
        kind: 'bash_line',
        id: mkId(`bash-${i}-${hashString(text)}`),
        sequence: i,
        state: data.isIncomplete ? 'streaming' : 'complete',
        stream: 'stdout',
        text,
      })
    }
  } else if (typeof (data as { stdout?: unknown }).stdout === 'string') {
    const stdout = (data as { stdout: string }).stdout
    const chunks = stdout.split(/\r?\n/)
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i]
      if (text.length === 0 && i === chunks.length - 1) continue
      out.push({
        kind: 'bash_line',
        id: mkId(`bash-${i}`),
        sequence: i,
        state: 'streaming',
        stream: 'stdout',
        text,
      })
    }
  }

  // FileRead — progress with `path` and optionally `sizeBytes`/`lineCount`.
  if (typeof (data as { path?: unknown }).path === 'string') {
    out.push({
      kind: 'read_path',
      id: mkId('path'),
      sequence: 0,
      state: 'complete',
      path: (data as { path: string }).path,
    })
    const size = (data as { sizeBytes?: unknown }).sizeBytes
    const lines = (data as { lineCount?: unknown }).lineCount
    if (typeof size === 'number' || typeof lines === 'number') {
      out.push({
        kind: 'read_meta',
        id: mkId('meta'),
        sequence: 1,
        state: 'complete',
        sizeBytes: typeof size === 'number' ? size : undefined,
        lineCount: typeof lines === 'number' ? lines : undefined,
      })
    }
  }

  // Edit/Write — progress with `edit`/`diff` shape. We accept a loose
  // shape: { filePath: string, hunks?: Array<{before,after}> }.
  if (
    typeof (data as { filePath?: unknown }).filePath === 'string' &&
    (data as { kind?: unknown }).kind !== 'read' // don't double-match FileRead
  ) {
    const filePath = (data as { filePath: string }).filePath
    const hunks = (data as { hunks?: unknown }).hunks
    out.push({
      kind: 'edit_skeleton',
      id: mkId('edit-skel'),
      sequence: 0,
      state: 'complete',
      path: filePath,
      hunkCount: Array.isArray(hunks) ? hunks.length : undefined,
    })
    if (Array.isArray(hunks)) {
      for (let i = 0; i < hunks.length; i++) {
        const h = hunks[i]
        if (!isRecord(h)) continue
        out.push({
          kind: 'edit_hunk',
          id: mkId(`edit-hunk-${i}`),
          sequence: i + 1,
          state: 'complete',
          hunkIndex: i,
          beforeSnippet:
            typeof h.before === 'string' ? h.before : undefined,
          afterSnippet: typeof h.after === 'string' ? h.after : undefined,
        })
      }
    }
  }

  // Glob/Grep — progress with `count` or `totalMatches`.
  const count =
    typeof (data as { count?: unknown }).count === 'number'
      ? (data as { count: number }).count
      : typeof (data as { totalMatches?: unknown }).totalMatches === 'number'
        ? (data as { totalMatches: number }).totalMatches
        : undefined
  if (count != null) {
    out.push({
      kind: 'search_count',
      id: mkId('search'),
      sequence: 0,
      state: 'streaming',
      total: count,
    })
  }

  return out
}

/**
 * Wrap a ToolCallProgress callback so it also emits ToolParts.
 *
 * Usage (from query.ts / QueryEngine.ts, or at the tool caller layer):
 *
 *   const wrapped = wrapProgressCallback(toolUseID, onProgress)
 *   await tool.call(input, ctx, canUse, parent, wrapped)
 *
 * If streaming is disabled, the original callback is returned so there
 * is literally zero overhead.
 */
export function wrapProgressCallback<
  Fn extends ((evt: { toolUseID: string; data: unknown }) => void) | undefined,
>(toolUseID: string, original: Fn): Fn {
  if (!isStreamingEnabled()) return original
  const wrapped = ((evt: { toolUseID: string; data: unknown }) => {
    try {
      for (const part of progressToParts({ toolUseID, data: evt.data })) {
        emitPart(toolUseID, part)
      }
    } catch {
      // Never let a bridge bug break the tool — swallow and fall through.
    }
    original?.(evt)
  }) as NonNullable<Fn>
  return wrapped as Fn
}

// Cheap string hash — only used to make Bash-line part IDs stable across
// duplicate lines. FNV-1a is fine; we just need non-colliding in-practice.
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
