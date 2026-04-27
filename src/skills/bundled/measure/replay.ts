/**
 * Replay a single prompt against a void subprocess and capture metrics.
 *
 * Spawns `voidBin -p "<prompt>" --model <model> --output-format json`, parses
 * the SDK result JSON from stdout, and returns a ReplayResult. Honors a hard
 * timeout via AbortController. Never throws — failures become `ok: false`
 * entries so the caller can continue processing the batch.
 */

import { spawn } from 'child_process'
import {
  type ReplayResult,
  type SDKResultJson,
  DEFAULT_TIMEOUT_MS,
} from './types.js'

export type ReplayOptions = {
  prompt: string
  model: string
  timeoutMs?: number
  voidBin: string
  /** Injected for tests; defaults to Node's `spawn`. */
  spawnFn?: typeof spawn
}

/** Extract the last SDK-result JSON object from mixed stdout. */
export function parseSdkResultFromStdout(
  stdout: string,
): SDKResultJson | null {
  // --output-format json emits a single JSON object when verbose=false.
  // Try parsing the full stdout first — happy path.
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null
  const direct = tryParseAsSdkResult(trimmed)
  if (direct !== null) return direct

  // Fallback: scan for the last `{"type":"result"` object. Useful if the
  // user has a hook that prepends banner text before the JSON.
  const marker = '{"type":"result"'
  const lastIdx = trimmed.lastIndexOf(marker)
  if (lastIdx === -1) return null
  // Heuristic: balance braces from that position to find the object end.
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = lastIdx; i < trimmed.length; i++) {
    const ch = trimmed[i]!
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
      if (depth === 0) {
        const candidate = trimmed.slice(lastIdx, i + 1)
        return tryParseAsSdkResult(candidate)
      }
    }
  }
  return null
}

function tryParseAsSdkResult(text: string): SDKResultJson | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (obj['type'] !== 'result') return null
  const fields = [
    'subtype',
    'duration_ms',
    'duration_api_ms',
    'num_turns',
    'total_cost_usd',
    'session_id',
  ] as const
  for (const f of fields) {
    if (!(f in obj)) return null
  }
  return {
    type: 'result',
    subtype: String(obj['subtype']),
    duration_ms: Number(obj['duration_ms']),
    duration_api_ms: Number(obj['duration_api_ms']),
    is_error: Boolean(obj['is_error']),
    num_turns: Number(obj['num_turns']),
    result: typeof obj['result'] === 'string' ? obj['result'] : undefined,
    total_cost_usd: Number(obj['total_cost_usd']),
    session_id: String(obj['session_id']),
  }
}

/** Convert a parsed SDK result + wall-clock time into a ReplayResult. */
export function buildReplayResultFromSdk(
  prompt: string,
  model: string,
  sdk: SDKResultJson,
  exitCode: number,
): ReplayResult {
  return {
    prompt,
    model,
    ok: !sdk.is_error,
    costUsd: sdk.total_cost_usd,
    latencyMs: sdk.duration_ms,
    apiLatencyMs: sdk.duration_api_ms,
    numTurns: sdk.num_turns,
    finalMessageChars: sdk.result ? sdk.result.length : 0,
    sessionId: sdk.session_id,
    rawExitCode: exitCode,
  }
}

/**
 * Replay a single prompt. Never throws; errors are captured in the result.
 * Writes no data outside the subprocess and its captured stdout/stderr.
 */
export async function replayPrompt(
  opts: ReplayOptions,
): Promise<ReplayResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spawnFn = opts.spawnFn ?? spawn
  const startedAt = Date.now()

  return await new Promise<ReplayResult>(resolve => {
    const controller = new AbortController()
    const child = spawnFn(
      opts.voidBin,
      [
        '-p',
        opts.prompt,
        '--model',
        opts.model,
        '--output-format',
        'json',
        '--no-session-persistence',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: controller.signal,
      },
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      controller.abort()
    }, timeoutMs)

    const finish = (result: ReplayResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', err => {
      finish({
        prompt: opts.prompt,
        model: opts.model,
        ok: false,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        apiLatencyMs: 0,
        numTurns: 0,
        finalMessageChars: 0,
        sessionId: '',
        error: err.message,
        rawExitCode: -1,
      })
    })
    child.on('close', code => {
      const sdk = parseSdkResultFromStdout(stdout)
      if (sdk !== null) {
        finish(buildReplayResultFromSdk(opts.prompt, opts.model, sdk, code ?? -1))
        return
      }
      const errMsg =
        code === null
          ? `timeout after ${timeoutMs}ms`
          : stderr.trim() || `exit ${code} (no JSON result in stdout)`
      finish({
        prompt: opts.prompt,
        model: opts.model,
        ok: false,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        apiLatencyMs: 0,
        numTurns: 0,
        finalMessageChars: 0,
        sessionId: '',
        error: errMsg,
        rawExitCode: code ?? -1,
      })
    })
  })
}

/**
 * Replay an array of (prompt, model) pairs with bounded concurrency.
 * Never throws — any per-pair failure becomes an `ok: false` result.
 */
export async function replayBatch(
  pairs: Array<{ prompt: string; model: string }>,
  opts: {
    voidBin: string
    timeoutMs: number
    parallel: number
    spawnFn?: typeof spawn
  },
): Promise<ReplayResult[]> {
  const results: ReplayResult[] = new Array(pairs.length)
  let cursor = 0
  const parallel = Math.max(1, opts.parallel)

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= pairs.length) return
      const pair = pairs[i]!
      results[i] = await replayPrompt({
        prompt: pair.prompt,
        model: pair.model,
        voidBin: opts.voidBin,
        timeoutMs: opts.timeoutMs,
        ...(opts.spawnFn ? { spawnFn: opts.spawnFn } : {}),
      })
    }
  }

  const workers = Array.from({ length: parallel }, () => worker())
  await Promise.all(workers)
  return results
}
