/**
 * Replay a single prompt against a tool subprocess and capture metrics.
 *
 * Each tool gets its own argv builder (via `buildArgv` below) and its own
 * stdout parser (via parsers.ts). Wall-clock latency is always measured
 * here; tool-reported metrics (cost, API latency, turns) come from the
 * parser when the tool emits them.
 *
 * Never throws — failures become `ok: false` entries so the caller can
 * continue processing the batch.
 */

import { spawn } from 'child_process'
import { parseToolOutput } from './parsers.js'
import {
  type ReplayResult,
  type Variant,
  DEFAULT_TIMEOUT_MS,
} from './types.js'

export type ReplayOptions = {
  prompt: string
  variant: Variant
  timeoutMs?: number
  /** Injected for tests; defaults to Node's `spawn`. */
  spawnFn?: typeof spawn
}

/**
 * Build the argv for a given tool + prompt + optional model override.
 * Each tool's headless flag set is different — claude/void share, codex
 * uses subcommand `exec`, opencode is a placeholder.
 */
export function buildArgv(variant: Variant, prompt: string): string[] {
  switch (variant.tool) {
    case 'void':
    case 'claude': {
      const argv = [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--no-session-persistence',
      ]
      if (variant.model && variant.model.length > 0 && variant.model !== 'default') {
        argv.push('--model', variant.model)
      }
      return argv
    }
    case 'codex': {
      // `codex exec` is the non-interactive entrypoint. --json emits
      // JSONL events to stdout; --full-auto skips approvals and runs
      // sandboxed; --skip-git-repo-check + --ephemeral keep the run from
      // mutating user state.
      const argv = [
        'exec',
        '--json',
        '--full-auto',
        '--skip-git-repo-check',
        '--ephemeral',
      ]
      if (variant.model && variant.model.length > 0 && variant.model !== 'default') {
        argv.push('-m', variant.model)
      }
      argv.push(prompt)
      return argv
    }
    case 'opencode': {
      // Best-guess minimal invocation. opencode's headless surface isn't
      // pinned in this repo — treat the prompt as a positional arg and let
      // the user override via $OPENCODE_BIN if needed.
      return [prompt]
    }
  }
}

/** Build a ReplayResult with sentinel values, ready to fill in from a parser. */
function emptyResultFor(
  variant: Variant,
  prompt: string,
  startedAt: number,
): ReplayResult {
  return {
    prompt,
    variantId: variant.id,
    tool: variant.tool,
    version: variant.version,
    ok: false,
    costUsd: 0,
    costAvailable: false,
    latencyMs: Date.now() - startedAt,
    apiLatencyMs: -1,
    numTurns: -1,
    finalMessageChars: 0,
    sessionId: '',
    rawExitCode: -1,
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
  const argv = buildArgv(opts.variant, opts.prompt)

  return await new Promise<ReplayResult>(resolve => {
    const controller = new AbortController()
    const child = spawnFn(opts.variant.binary, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
    })

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
      // Cap stdout at 1MB to avoid pathological output blowing memory.
      if (stdout.length < 1024 * 1024) stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < 64 * 1024) stderr += chunk
    })

    child.on('error', err => {
      finish({
        ...emptyResultFor(opts.variant, opts.prompt, startedAt),
        latencyMs: Date.now() - startedAt,
        error: err.message,
      })
    })

    child.on('close', code => {
      const latencyMs = Date.now() - startedAt
      const partial = parseToolOutput(opts.variant.tool, stdout)
      const exitCode = code ?? -1

      if (partial !== null) {
        finish({
          prompt: opts.prompt,
          variantId: opts.variant.id,
          tool: opts.variant.tool,
          version: opts.variant.version,
          ok: partial.ok && exitCode === 0,
          costUsd: partial.costUsd,
          costAvailable: partial.costAvailable,
          latencyMs,
          apiLatencyMs: partial.apiLatencyMs,
          numTurns: partial.numTurns,
          finalMessageChars: partial.finalMessage.length,
          sessionId: partial.sessionId,
          rawExitCode: exitCode,
        })
        return
      }

      // Parser couldn't find anything structured. Fall back to wall-clock-
      // only metrics: success determined by exit code, error message from
      // stderr.
      const errMsg =
        code === null
          ? `timeout after ${timeoutMs}ms`
          : stderr.trim() ||
            `exit ${exitCode} (no parseable output from ${opts.variant.tool})`
      finish({
        ...emptyResultFor(opts.variant, opts.prompt, startedAt),
        latencyMs,
        ok: exitCode === 0,
        error: exitCode === 0 ? undefined : errMsg,
        rawExitCode: exitCode,
      })
    })
  })
}

/**
 * Replay an array of (prompt, variant) pairs with bounded concurrency.
 * Never throws — any per-pair failure becomes an `ok: false` result.
 */
export async function replayBatch(
  pairs: Array<{ prompt: string; variant: Variant }>,
  opts: {
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
        variant: pair.variant,
        timeoutMs: opts.timeoutMs,
        ...(opts.spawnFn ? { spawnFn: opts.spawnFn } : {}),
      })
    }
  }

  const workers = Array.from({ length: parallel }, () => worker())
  await Promise.all(workers)
  return results
}

// Backward-compat: re-export the parser so the original module surface is
// preserved for any external callers. New code should import from parsers.ts.
export { parseClaudeOrVoidOutput as parseSdkResultFromStdout } from './parsers.js'
