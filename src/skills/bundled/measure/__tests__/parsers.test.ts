/**
 * Tests for per-tool stdout parsers. Sample inputs reproduce the shape
 * each tool emits in `--print --output-format json` (claude/void) or
 * `exec --json` (codex) modes. The opencode stub is exercised for its
 * graceful-degradation behavior.
 */
import { describe, expect, it } from 'vitest'
import {
  parseClaudeOrVoidOutput,
  parseCodexOutput,
  parseOpencodeOutput,
  parseToolOutput,
} from '../parsers.js'

const CLAUDE_RESULT_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  duration_ms: 5_400,
  duration_api_ms: 4_900,
  is_error: false,
  num_turns: 3,
  result: 'all done',
  total_cost_usd: 0.0142,
  session_id: 'sess-abc',
})

describe('parseClaudeOrVoidOutput', () => {
  it('parses a clean SDK result JSON object', () => {
    const r = parseClaudeOrVoidOutput(CLAUDE_RESULT_JSON)
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(true)
    expect(r!.costUsd).toBeCloseTo(0.0142, 5)
    expect(r!.costAvailable).toBe(true)
    expect(r!.numTurns).toBe(3)
    expect(r!.apiLatencyMs).toBe(4_900)
    expect(r!.finalMessage).toBe('all done')
    expect(r!.sessionId).toBe('sess-abc')
  })

  it('returns null on empty stdout', () => {
    expect(parseClaudeOrVoidOutput('')).toBeNull()
    expect(parseClaudeOrVoidOutput('   ')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(parseClaudeOrVoidOutput('{not json')).toBeNull()
  })

  it('falls back to scanning when banner text precedes the JSON', () => {
    const r = parseClaudeOrVoidOutput(`some banner\n${CLAUDE_RESULT_JSON}\n`)
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(true)
  })

  it('marks ok=false when is_error is true', () => {
    const errored = JSON.stringify({
      type: 'result',
      subtype: 'error',
      duration_ms: 100,
      duration_api_ms: 50,
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      session_id: 's',
    })
    const r = parseClaudeOrVoidOutput(errored)
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(false)
  })

  it('returns null when the type is not result', () => {
    const notResult = JSON.stringify({ type: 'system', x: 1 })
    expect(parseClaudeOrVoidOutput(notResult)).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    const partial = JSON.stringify({ type: 'result', session_id: 's' })
    expect(parseClaudeOrVoidOutput(partial)).toBeNull()
  })
})

describe('parseCodexOutput', () => {
  it('returns null on empty input', () => {
    expect(parseCodexOutput('')).toBeNull()
  })

  it('counts a task_complete event as successful', () => {
    const stream = [
      JSON.stringify({ type: 'task_started' }),
      JSON.stringify({ type: 'task_complete' }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(true)
  })

  it('flags ok=false when an error event is present', () => {
    const stream = [
      JSON.stringify({ type: 'task_started' }),
      JSON.stringify({ type: 'error', message: 'rate limited' }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(false)
  })

  it('extracts cost from total_cost_usd if present', () => {
    const stream = [
      JSON.stringify({
        type: 'task_complete',
        total_cost_usd: 0.05,
      }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.costUsd).toBeCloseTo(0.05, 5)
    expect(r!.costAvailable).toBe(true)
  })

  it('extracts cost from nested usage.total_cost when not at top level', () => {
    const stream = [
      JSON.stringify({
        type: 'task_complete',
        usage: { total_cost: 0.02 },
      }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.costUsd).toBeCloseTo(0.02, 5)
    expect(r!.costAvailable).toBe(true)
  })

  it('approximates turn count from turn_complete events when no field provided', () => {
    const stream = [
      JSON.stringify({ type: 'turn_complete' }),
      JSON.stringify({ type: 'turn_complete' }),
      JSON.stringify({ type: 'task_complete' }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.numTurns).toBe(2)
  })

  it('uses an explicit num_turns field when present', () => {
    const stream = [
      JSON.stringify({ type: 'task_complete', num_turns: 5 }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.numTurns).toBe(5)
  })

  it('captures the agent message text', () => {
    const stream = [
      JSON.stringify({ type: 'agent_message', message: 'hello there' }),
      JSON.stringify({ type: 'task_complete' }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.finalMessage).toBe('hello there')
  })

  it('tolerates non-JSON noise interleaved with events', () => {
    const stream = [
      'Codex starting up...',
      JSON.stringify({ type: 'task_started' }),
      '',
      JSON.stringify({ type: 'task_complete' }),
    ].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.ok).toBe(true)
  })

  it('returns -1 for apiLatencyMs (codex does not report it)', () => {
    const stream = [JSON.stringify({ type: 'task_complete' })].join('\n')
    const r = parseCodexOutput(stream)
    expect(r!.apiLatencyMs).toBe(-1)
  })
})

describe('parseOpencodeOutput', () => {
  it('returns null on empty stdout', () => {
    expect(parseOpencodeOutput('')).toBeNull()
  })

  it('returns a minimal-ok result with the trimmed stdout as message', () => {
    const r = parseOpencodeOutput('  hello world  \n')
    expect(r).not.toBeNull()
    expect(r!.ok).toBe(true)
    expect(r!.finalMessage).toBe('hello world')
    expect(r!.costAvailable).toBe(false)
    expect(r!.numTurns).toBe(-1)
  })
})

describe('parseToolOutput dispatcher', () => {
  it('routes void to the claude/void parser', () => {
    expect(parseToolOutput('void', CLAUDE_RESULT_JSON)?.ok).toBe(true)
  })

  it('routes claude to the claude/void parser', () => {
    expect(parseToolOutput('claude', CLAUDE_RESULT_JSON)?.ok).toBe(true)
  })

  it('routes codex to its own parser', () => {
    const stream = JSON.stringify({ type: 'task_complete' })
    expect(parseToolOutput('codex', stream)?.ok).toBe(true)
  })

  it('routes opencode to the stub', () => {
    expect(parseToolOutput('opencode', 'anything')?.ok).toBe(true)
  })
})
