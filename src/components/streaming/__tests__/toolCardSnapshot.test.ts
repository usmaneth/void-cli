/**
 * Snapshot tests for the streaming ToolCard view model.
 *
 * We exercise `computeStreamingView` — the pure decision layer — and
 * verify that for each tool type, the view model matches the expected
 * streaming-vs-complete structure. The JSX layer (StreamingToolBody)
 * is a thin adapter over this, so covering the decisions here gives
 * us the same confidence as an Ink-based snapshot while running under
 * plain `node --test` without the terminal dependency.
 *
 * Run with:
 *   node --test dist/components/streaming/__tests__/toolCardSnapshot.test.js
 * (after `npm run build`)
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeStreamingView } from '../streamingView.js'
import type { AggregatedParts } from '../aggregator.js'
import type { ToolPart } from '../toolParts.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bashAgg(
  lines: string[],
  done = false,
  cancelled = false,
): AggregatedParts {
  return {
    ordered: lines.map(
      (text, i): ToolPart => ({
        kind: 'bash_line',
        id: `bash-${i}`,
        sequence: i,
        state: done
          ? 'complete'
          : cancelled
            ? 'error'
            : 'streaming',
        stream: 'stdout',
        text,
        ...(cancelled ? { error: 'interrupted' } : {}),
      }),
    ),
    done,
    cancelled,
  }
}

function readAgg(
  path: string,
  meta?: { sizeBytes?: number; lineCount?: number },
  done = false,
): AggregatedParts {
  const ordered: ToolPart[] = [
    { kind: 'read_path', id: 'p', sequence: 0, state: 'complete', path },
  ]
  if (meta) {
    ordered.push({
      kind: 'read_meta',
      id: 'm',
      sequence: 1,
      state: 'complete',
      sizeBytes: meta.sizeBytes,
      lineCount: meta.lineCount,
    })
  }
  return { ordered, done, cancelled: false }
}

function editAgg(
  path: string,
  hunks: Array<{ before: string; after: string }>,
): AggregatedParts {
  const ordered: ToolPart[] = [
    {
      kind: 'edit_skeleton',
      id: 'skel',
      sequence: 0,
      state: 'complete',
      path,
      hunkCount: hunks.length,
    },
    ...hunks.map(
      (h, i): ToolPart => ({
        kind: 'edit_hunk',
        id: `h-${i}`,
        sequence: i + 1,
        state: 'complete',
        hunkIndex: i,
        beforeSnippet: h.before,
        afterSnippet: h.after,
      }),
    ),
  ]
  return { ordered, done: false, cancelled: false }
}

function searchAgg(total: number, done = false): AggregatedParts {
  return {
    ordered: [
      {
        kind: 'search_count',
        id: 'c',
        sequence: 0,
        state: done ? 'complete' : 'streaming',
        total,
      },
    ],
    done,
    cancelled: false,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeStreamingView - bash', () => {
  it('streaming: shows each line, spinner on', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: bashAgg(['a', 'b']),
      hasFallback: false,
    })
    assert.equal(v.kind, 'bash')
    if (v.kind !== 'bash') throw new Error('narrow')
    assert.deepEqual(v.visible, ['a', 'b'])
    assert.equal(v.hiddenCount, 0)
    assert.equal(v.showSpinner, true)
    assert.equal(v.interrupted, false)
  })

  it('respects the 10-line collapse limit and reports hidden count', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line-${i}`)
    const v = computeStreamingView({
      type: 'bash',
      agg: bashAgg(lines),
      hasFallback: false,
    })
    if (v.kind !== 'bash') throw new Error('narrow')
    assert.equal(v.visible.length, 10)
    assert.equal(v.hiddenCount, 5)
    assert.equal(v.visible[0], 'line-5')
    assert.equal(v.visible[9], 'line-14')
  })

  it('complete state disables the spinner', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: bashAgg(['ok'], true, false),
      hasFallback: false,
    })
    if (v.kind !== 'bash') throw new Error('narrow')
    assert.equal(v.showSpinner, false)
  })

  it('cancelled state flags interrupted', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: bashAgg(['partial'], false, true),
      hasFallback: false,
    })
    if (v.kind !== 'bash') throw new Error('narrow')
    assert.equal(v.interrupted, true)
    assert.equal(v.showSpinner, false)
  })
})

describe('computeStreamingView - read', () => {
  it('streaming: shows path immediately, meta absent', () => {
    const v = computeStreamingView({
      type: 'read',
      agg: readAgg('/foo.ts'),
      hasFallback: false,
    })
    if (v.kind !== 'read') throw new Error('narrow')
    assert.equal(v.path, '/foo.ts')
    assert.equal(v.sizeBytes, undefined)
    assert.equal(v.lineCount, undefined)
    assert.equal(v.showSpinner, true)
  })

  it('complete: fills in size/line-count', () => {
    const v = computeStreamingView({
      type: 'read',
      agg: readAgg('/foo.ts', { sizeBytes: 512, lineCount: 20 }, true),
      hasFallback: false,
    })
    if (v.kind !== 'read') throw new Error('narrow')
    assert.equal(v.sizeBytes, 512)
    assert.equal(v.lineCount, 20)
    assert.equal(v.showSpinner, false)
  })
})

describe('computeStreamingView - edit/write', () => {
  it('skeleton first: hunks=[] but hunkCount=0 present', () => {
    const v = computeStreamingView({
      type: 'edit',
      agg: editAgg('/x.ts', []),
      hasFallback: false,
    })
    if (v.kind !== 'edit') throw new Error('narrow')
    assert.equal(v.path, '/x.ts')
    assert.equal(v.hunkCount, 0)
    assert.deepEqual(v.hunks, [])
  })

  it('fills in each hunk before/after', () => {
    const v = computeStreamingView({
      type: 'edit',
      agg: editAgg('/x.ts', [
        { before: 'foo', after: 'bar' },
        { before: 'baz', after: 'qux' },
      ]),
      hasFallback: false,
    })
    if (v.kind !== 'edit') throw new Error('narrow')
    assert.equal(v.hunks.length, 2)
    assert.deepEqual(v.hunks[0], { before: 'foo', after: 'bar' })
    assert.deepEqual(v.hunks[1], { before: 'baz', after: 'qux' })
  })
})

describe('computeStreamingView - glob/grep', () => {
  it('ticks up the count', () => {
    const v1 = computeStreamingView({
      type: 'grep',
      agg: searchAgg(0),
      hasFallback: false,
    })
    const v2 = computeStreamingView({
      type: 'grep',
      agg: searchAgg(42),
      hasFallback: false,
    })
    if (v1.kind !== 'search') throw new Error('narrow')
    if (v2.kind !== 'search') throw new Error('narrow')
    assert.equal(v1.count, 0)
    assert.equal(v2.count, 42)
    assert.equal(v1.showSpinner, true)
  })

  it('complete state disables the spinner', () => {
    const v = computeStreamingView({
      type: 'glob',
      agg: searchAgg(3, true),
      hasFallback: false,
    })
    if (v.kind !== 'search') throw new Error('narrow')
    assert.equal(v.showSpinner, false)
  })
})

describe('computeStreamingView - fallback path', () => {
  it('no parts + no force → fallback', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: { ordered: [], done: false, cancelled: false },
      hasFallback: true,
    })
    assert.equal(v.kind, 'fallback')
  })

  it('terminal + hasFallback → fallback (legacy renderer wins)', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: bashAgg(['done'], true),
      hasFallback: true,
    })
    assert.equal(v.kind, 'fallback')
  })

  it('terminal + no fallback → streaming view still renders', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: bashAgg(['done'], true),
      hasFallback: false,
    })
    assert.equal(v.kind, 'bash')
  })

  it('forceStreaming overrides fallback', () => {
    const v = computeStreamingView({
      type: 'bash',
      agg: { ordered: [], done: false, cancelled: false },
      hasFallback: true,
      forceStreaming: true,
    })
    assert.equal(v.kind, 'bash')
  })
})

describe('computeStreamingView - backpressure-agnostic determinism', () => {
  // The view is a pure function of AggregatedParts — same input → same
  // output across ticks. This is what lets the React hook safely
  // coalesce updates at 30fps without stale frames.
  it('returns the same structural view for equal aggregates', () => {
    const agg = bashAgg(['a', 'b', 'c'])
    const v1 = computeStreamingView({ type: 'bash', agg, hasFallback: false })
    const v2 = computeStreamingView({ type: 'bash', agg, hasFallback: false })
    assert.deepEqual(v1, v2)
  })
})
