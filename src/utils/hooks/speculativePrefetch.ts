/**
 * Speculative prefetch: run a fixed set of read-only shell commands on every
 * UserPromptSubmit when enabled in settings, and surface their stdout as
 * additional context for the model. The intent is to eliminate the first
 * handful of `git status` / `git log` / lint tool calls that almost every
 * session starts with — the data is usually needed, so pre-load it.
 *
 * Opt-in via `speculativePrefetch.enabled` in settings. Defaults are git-only
 * and cheap; the command list is fully user-overridable.
 *
 * Contract:
 * - No-op unless `enabled: true`.
 * - No-op when cwd is not a git worktree (most defaults are git-shaped).
 * - Each command has a hard per-command timeout (default 5s). A timeout
 *   skips that command but does not fail the batch.
 * - stderr is dropped entirely — too risky for accidental secret leakage
 *   (e.g., remote URLs with embedded tokens).
 * - Commands run in parallel. The output block is deterministic in command
 *   order (not completion order), so identical git state → identical text.
 * - Returns null when there's nothing to inject (disabled, non-git cwd,
 *   all commands empty/failed). Callers should skip context injection on null.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_PREFETCH_COMMANDS: readonly string[] = [
  'git status --short',
  'git log --oneline -5',
  'git diff --stat HEAD',
]

export const DEFAULT_PREFETCH_TIMEOUT_MS = 5000

export type SpeculativePrefetchSettings = {
  enabled?: boolean
  commands?: string[]
  timeoutMs?: number
}

type CommandResult = {
  command: string
  stdout: string
  ok: boolean
}

/**
 * Detect whether `cwd` is inside a git worktree. Uses a filesystem check
 * rather than shelling out to `git rev-parse`, both for speed and to avoid
 * one extra process spawn on every single prompt submit.
 *
 * Covers:
 *  - Standard repo:   .git is a directory
 *  - Submodules/worktrees: .git is a file pointing to the gitdir
 */
export function isGitRepo(cwd: string): boolean {
  const dotGit = join(cwd, '.git')
  try {
    if (!existsSync(dotGit)) return false
    const s = statSync(dotGit)
    return s.isDirectory() || s.isFile()
  } catch {
    return false
  }
}

/**
 * Run a single shell command with a hard timeout. stderr is discarded.
 * Returns {ok:false, stdout:''} on timeout, non-zero exit, or spawn error —
 * the batch caller treats all failures the same way (just skip the command).
 */
async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise(resolve => {
    let settled = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!settled) {
        controller.abort()
      }
    }, timeoutMs)

    let child: ReturnType<typeof spawn>
    try {
      child = spawn('sh', ['-c', command], {
        cwd,
        signal: controller.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
    } catch {
      clearTimeout(timer)
      settled = true
      resolve({ command, stdout: '', ok: false })
      return
    }

    let stdout = ''
    child.stdout?.on('data', chunk => {
      // Cap per-command stdout at 32KB to avoid pathological repos (e.g.
      // `git status --short` in a 10k-file mess) blowing the context window.
      if (stdout.length < 32 * 1024) {
        stdout += chunk.toString('utf8')
      }
    })

    // Explicitly drain stderr so the child doesn't block on a full pipe.
    // We never read it — see module docstring for rationale.
    child.stderr?.on('data', () => {})

    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ command, stdout: '', ok: false })
    })

    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command,
        stdout: stdout.trimEnd(),
        ok: code === 0,
      })
    })
  })
}

/**
 * Format the prefetch block for injection as additionalContext. Commands
 * appear in the user's configured order regardless of completion order.
 * Empty stdout for a command is rendered as "(no output)" rather than
 * dropping the command, so the model can tell the difference between
 * "not run" and "ran, nothing to report" (e.g. clean `git status`).
 */
export function formatPrefetchBlock(results: CommandResult[]): string | null {
  const usable = results.filter(r => r.ok)
  if (usable.length === 0) return null

  const lines: string[] = ['<speculative-prefetch>']
  for (const { command, stdout } of usable) {
    lines.push(`$ ${command}`)
    lines.push(stdout.length > 0 ? stdout : '(no output)')
    lines.push('')
  }
  // Drop the trailing blank line before the closing tag.
  if (lines[lines.length - 1] === '') lines.pop()
  lines.push('</speculative-prefetch>')
  return lines.join('\n')
}

/**
 * Entry point. Returns the formatted context block for injection, or null
 * when there's nothing to inject (disabled, non-git cwd, or all commands
 * failed). Always safe to call.
 */
export async function runSpeculativePrefetch(
  cwd: string,
  settings: SpeculativePrefetchSettings | undefined,
): Promise<string | null> {
  if (!settings?.enabled) return null
  if (!isGitRepo(cwd)) return null

  const commands =
    settings.commands && settings.commands.length > 0
      ? settings.commands
      : [...DEFAULT_PREFETCH_COMMANDS]

  const timeoutMs = settings.timeoutMs ?? DEFAULT_PREFETCH_TIMEOUT_MS

  const results = await Promise.all(
    commands.map(cmd => runCommand(cmd, cwd, timeoutMs)),
  )

  return formatPrefetchBlock(results)
}
