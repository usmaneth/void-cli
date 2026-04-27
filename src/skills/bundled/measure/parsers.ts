/**
 * Per-tool stdout parsers for /measure replays.
 *
 * Each parser tries to extract:
 *  - whether the tool considered the run successful
 *  - cost (USD) — when the tool reports it
 *  - API/wall latency — wall-clock is added by the caller; this is the
 *    tool's own reported API latency where available
 *  - turn count
 *  - the final assistant message
 *
 * Anything the parser can't extract is left at a sentinel:
 *  - cost: 0 with `costAvailable: false`
 *  - apiLatencyMs / numTurns: -1
 *  - finalMessage: ''
 *
 * The downstream report renderer reads those flags and shows "—" instead
 * of a misleading 0. This means partial parsers (e.g. codex) are still
 * useful — we get latency + success rate even when cost isn't extractable.
 */

import type { ToolName } from './types.js'

/**
 * Parser output. Use this shape for every tool so downstream code can stay
 * uniform regardless of which CLI emitted the data.
 */
export type PartialResult = {
  ok: boolean
  costUsd: number
  costAvailable: boolean
  apiLatencyMs: number // -1 when not reported by the tool
  numTurns: number // -1 when not reported by the tool
  finalMessage: string
  sessionId: string
}

const EMPTY_RESULT: PartialResult = {
  ok: false,
  costUsd: 0,
  costAvailable: false,
  apiLatencyMs: -1,
  numTurns: -1,
  finalMessage: '',
  sessionId: '',
}

/**
 * Parse claude/void's `--output-format json` output.
 *
 * Both tools emit a single JSON object with `type: "result"` containing
 * `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `result`,
 * `is_error`, `session_id`. Void inherits this schema from claude code; the
 * fields are byte-identical so this parser handles both.
 */
export function parseClaudeOrVoidOutput(stdout: string): PartialResult | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null

  const direct = tryParseClaudeResult(trimmed)
  if (direct !== null) return direct

  // Fallback: scan for the last `{"type":"result"` object — useful when
  // hooks or banners prepend text before the JSON.
  const marker = '{"type":"result"'
  const lastIdx = trimmed.lastIndexOf(marker)
  if (lastIdx === -1) return null
  const candidate = extractBalancedObject(trimmed, lastIdx)
  return candidate ? tryParseClaudeResult(candidate) : null
}

function tryParseClaudeResult(text: string): PartialResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (obj['type'] !== 'result') return null
  const required = [
    'duration_ms',
    'duration_api_ms',
    'num_turns',
    'total_cost_usd',
    'session_id',
  ] as const
  for (const f of required) if (!(f in obj)) return null

  const cost = Number(obj['total_cost_usd'])
  return {
    ok: !obj['is_error'],
    costUsd: Number.isFinite(cost) ? cost : 0,
    costAvailable: Number.isFinite(cost),
    apiLatencyMs: Number(obj['duration_api_ms']) || -1,
    numTurns: Number(obj['num_turns']) || -1,
    finalMessage: typeof obj['result'] === 'string' ? obj['result'] : '',
    sessionId: String(obj['session_id'] ?? ''),
  }
}

/**
 * Parse codex's `--json` JSONL output. Every line is a JSON event; we scan
 * for known event shapes.
 *
 * Codex's exact event schema isn't pinned in any public docs we control —
 * the parser is intentionally tolerant: it walks every line, picks up
 * cost/turn/message fields wherever they appear, and returns whatever it
 * managed to extract. Unknown fields are ignored. If we can't even count
 * a successful task-complete event, we still return a partial result so
 * the caller knows the run finished (or didn't).
 */
export function parseCodexOutput(stdout: string): PartialResult | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null

  let cost = 0
  let costAvailable = false
  let turns = 0
  let turnsSeen = false
  let finalMessage = ''
  let sessionId = ''
  let sawComplete = false
  let sawError = false

  for (const line of trimmed.split('\n')) {
    const cleaned = line.trim()
    if (cleaned.length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(cleaned)
    } catch {
      continue // ignore non-JSON noise
    }
    if (typeof event !== 'object' || event === null) continue
    const obj = event as Record<string, unknown>

    // Heuristic: look for any of these keys at any depth-1 location.
    const t = typeof obj['type'] === 'string' ? (obj['type'] as string) : ''

    if (t.includes('error') || t === 'task_failed') {
      sawError = true
    }
    if (t === 'task_complete' || t === 'turn_complete' || t === 'session_complete') {
      sawComplete = true
    }
    if (t === 'agent_message' || t === 'message' || t === 'final_message') {
      const m = obj['message'] ?? obj['content'] ?? obj['text']
      if (typeof m === 'string') finalMessage = m
      else if (m && typeof m === 'object') {
        // Sometimes the message is { content: string } or [{ text: string }]
        if (Array.isArray(m)) {
          for (const part of m) {
            if (
              part &&
              typeof part === 'object' &&
              typeof (part as Record<string, unknown>)['text'] === 'string'
            ) {
              finalMessage = (part as Record<string, unknown>)['text'] as string
            }
          }
        } else if (typeof (m as Record<string, unknown>)['text'] === 'string') {
          finalMessage = (m as Record<string, unknown>)['text'] as string
        }
      }
    }

    // Cost may appear as `total_cost_usd`, `cost`, or `usage.total_cost`.
    const costRaw =
      obj['total_cost_usd'] ??
      obj['cost_usd'] ??
      obj['cost'] ??
      ((obj['usage'] as Record<string, unknown> | undefined)?.['total_cost'] ??
        undefined)
    if (typeof costRaw === 'number' && Number.isFinite(costRaw)) {
      cost = costRaw
      costAvailable = true
    }

    // Turn count may appear as `num_turns`, `turns`, or be derivable from
    // counting `turn_complete` events.
    const turnRaw = obj['num_turns'] ?? obj['turns'] ?? obj['turn_count']
    if (typeof turnRaw === 'number' && Number.isFinite(turnRaw)) {
      turns = turnRaw
      turnsSeen = true
    }
    if (t === 'turn_complete' && !turnsSeen) {
      turns += 1 // approximate count when no field is reported
    }

    if (typeof obj['session_id'] === 'string') {
      sessionId = obj['session_id']
    }
  }

  return {
    ok: sawComplete && !sawError,
    costUsd: cost,
    costAvailable,
    apiLatencyMs: -1, // codex doesn't report API latency separately
    numTurns: turnsSeen ? turns : turns > 0 ? turns : -1,
    finalMessage,
    sessionId,
  }
}

/**
 * Parse opencode output. Stub — opencode isn't currently installed on the
 * dev machine and its output format hasn't been pinned. Returns a minimal
 * PartialResult that signals success only when the binary exited cleanly.
 *
 * When real opencode usage starts, replace this with a tested parser. The
 * caller will still get wall-clock latency + exit code in the meantime.
 */
export function parseOpencodeOutput(stdout: string): PartialResult | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null
  // No structured parsing yet — return the trimmed stdout as the final
  // message and let the caller flag everything else as unavailable.
  return {
    ...EMPTY_RESULT,
    ok: true,
    finalMessage: trimmed,
  }
}

/**
 * Extract a balanced JSON object starting at `start` in `text`. Returns the
 * substring (including braces) or null if no balanced object found.
 */
function extractBalancedObject(text: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (esc) {
      esc = false
      continue
    }
    if (ch === '\\' && inStr) {
      esc = true
      continue
    }
    if (ch === '"') inStr = !inStr
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Dispatch to the correct parser based on tool name. */
export function parseToolOutput(
  tool: ToolName,
  stdout: string,
): PartialResult | null {
  switch (tool) {
    case 'void':
    case 'claude':
      return parseClaudeOrVoidOutput(stdout)
    case 'codex':
      return parseCodexOutput(stdout)
    case 'opencode':
      return parseOpencodeOutput(stdout)
  }
}
