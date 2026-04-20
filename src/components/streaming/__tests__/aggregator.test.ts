/**
 * Unit tests for the part-stream aggregator reducer.
 *
 * Run with `node --test src/components/streaming/__tests__/aggregator.test.ts`
 * on Node >= 22 (which supports type-stripping .ts natively). The reducer
 * is side-effect-free so we drive it synchronously.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  emptyAggregate,
  reducePartEvent,
  type PartEvent,
} from '../aggregator.js'
import type { ToolPart } from '../toolParts.js'

function line(
  sequence: number,
  text: string,
  state: ToolPart['state'] = 'streaming',
): ToolPart {
  return {
    kind: 'bash_line',
    id: `line-${sequence}`,
    sequence,
    state,
    stream: 'stdout',
    text,
  }
}

function apply(events: PartEvent[]): ReturnType<typeof emptyAggregate> {
  return events.reduce(reducePartEvent, emptyAggregate())
}

describe('reducePartEvent - ordering', () => {
  it('appends parts in ascending sequence', () => {
    const out = apply([
      { type: 'part', part: line(0, 'a') },
      { type: 'part', part: line(1, 'b') },
      { type: 'part', part: line(2, 'c') },
    ])
    assert.deepEqual(
      out.ordered.map(p => p.sequence),
      [0, 1, 2],
    )
  })

  it('inserts late-arriving lower-sequence parts in the correct slot', () => {
    const out = apply([
      { type: 'part', part: line(0, 'a') },
      { type: 'part', part: line(2, 'c') },
      { type: 'part', part: line(1, 'b') },
    ])
    assert.deepEqual(
      out.ordered.map(p => (p as any).text),
      ['a', 'b', 'c'],
    )
  })

  it('handles many out-of-order parts', () => {
    const shuffled = [4, 0, 2, 3, 1].map(i => line(i, `l${i}`))
    const out = apply(shuffled.map(part => ({ type: 'part', part })))
    assert.deepEqual(
      out.ordered.map(p => p.sequence),
      [0, 1, 2, 3, 4],
    )
  })
})

describe('reducePartEvent - dedupe', () => {
  it('replaces a part with the same id on re-emission', () => {
    const out = apply([
      { type: 'part', part: line(0, 'pending', 'pending') },
      { type: 'part', part: line(0, 'complete', 'complete') },
    ])
    assert.equal(out.ordered.length, 1)
    assert.equal(out.ordered[0].state, 'complete')
    assert.equal((out.ordered[0] as any).text, 'complete')
  })

  it('does not regress terminal state back to streaming', () => {
    const out = apply([
      { type: 'part', part: line(0, 'done', 'complete') },
      { type: 'part', part: line(0, 'late', 'streaming') },
    ])
    assert.equal(out.ordered[0].state, 'complete')
  })
})

describe('reducePartEvent - final/cancel transitions', () => {
  it("flips pending/streaming parts to 'complete' on final", () => {
    const out = apply([
      { type: 'part', part: line(0, 'a', 'streaming') },
      { type: 'part', part: line(1, 'b', 'pending') },
      { type: 'final' },
    ])
    assert.equal(out.done, true)
    assert.deepEqual(
      out.ordered.map(p => p.state),
      ['complete', 'complete'],
    )
  })

  it("flips in-flight parts to 'error' with error='interrupted' on cancel", () => {
    const out = apply([
      { type: 'part', part: line(0, 'a', 'streaming') },
      { type: 'part', part: line(1, 'b', 'complete') },
      { type: 'cancel' },
    ])
    assert.equal(out.cancelled, true)
    assert.equal(out.ordered[0].state, 'error')
    assert.equal(out.ordered[0].error, 'interrupted')
    // Already-complete parts are preserved as-is.
    assert.equal(out.ordered[1].state, 'complete')
  })

  it('ignores parts arriving after cancel — partial content is frozen', () => {
    const out = apply([
      { type: 'part', part: line(0, 'before', 'streaming') },
      { type: 'cancel' },
      { type: 'part', part: line(1, 'after', 'streaming') },
    ])
    assert.equal(out.ordered.length, 1)
    assert.equal(out.ordered[0].error, 'interrupted')
  })

  it('ignores parts arriving after final', () => {
    const out = apply([
      { type: 'part', part: line(0, 'done', 'complete') },
      { type: 'final' },
      { type: 'part', part: line(1, 'late', 'streaming') },
    ])
    assert.equal(out.ordered.length, 1)
    assert.equal(out.done, true)
  })
})

describe('reducePartEvent - referential stability', () => {
  it('returns the same snapshot reference when nothing changes', () => {
    const base = apply([{ type: 'part', part: line(0, 'a', 'complete') }])
    const unchanged = reducePartEvent(base, { type: 'final' })
    // Apply final again — second final is a no-op and must not re-allocate.
    const unchanged2 = reducePartEvent(unchanged, { type: 'final' })
    assert.equal(unchanged, unchanged2)
  })

  it("cancel after final is a no-op (terminal wins)", () => {
    const base = apply([
      { type: 'part', part: line(0, 'a', 'complete') },
      { type: 'final' },
    ])
    const unchanged = reducePartEvent(base, { type: 'cancel' })
    assert.equal(unchanged, base)
    assert.equal(unchanged.done, true)
    assert.equal(unchanged.cancelled, false)
  })
})
