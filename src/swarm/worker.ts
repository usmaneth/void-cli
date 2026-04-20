/**
 * Swarm Worker — runs a single workstream in an isolated git worktree.
 *
 * 1. Creates a git worktree + branch for the workstream
 * 2. Builds a prompt from the workstream description, tasks, and scope
 * 3. Launches Void CLI as a subprocess to do the actual work
 * 4. Reports progress via callbacks
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa, execaSync } from 'execa'
import type { SwarmCallbacks, Workstream } from './types.js'

// Void CLI project root (two levels up from src/swarm/)
const __dirname = dirname(fileURLToPath(import.meta.url))
const VOID_ROOT = resolve(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// Runtime detection — match bin/void launcher logic
// ---------------------------------------------------------------------------

let _useBun: boolean | undefined

function useBun(): boolean {
  if (_useBun === undefined) {
    try {
      execaSync('bun', ['--version'])
      _useBun = true
    } catch {
      _useBun = false
    }
  }
  return _useBun
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single workstream inside its own git worktree.
 * Mutates the workstream's status and worktree fields in place.
 */
export async function runWorker(
  workstream: Workstream,
  repoRoot: string,
  callbacks: SwarmCallbacks,
): Promise<void> {
  const branch = `swarm/${workstream.id}`
  const worktreePath = resolve(repoRoot, '..', `.void-swarm-${workstream.id}`)

  workstream.worktreeBranch = branch
  workstream.worktreePath = worktreePath
  workstream.status = 'running'
  callbacks.onWorkerStart?.(workstream)

  try {
    // Create a new branch and worktree
    await execa('git', ['worktree', 'add', '-b', branch, worktreePath], {
      cwd: repoRoot,
    })

    callbacks.onWorkerProgress?.(workstream, `Worktree created at ${worktreePath}`)

    // Build the worker prompt
    const prompt = buildWorkerPrompt(workstream)

    callbacks.onWorkerProgress?.(workstream, `Starting worker model: ${workstream.model}`)

    // Launch Void CLI matching bin/void logic: prefer bun on TS source, fall back to node on compiled dist
    const command = useBun() ? 'bun' : 'node'
    const cliArgs = useBun()
      ? [
          resolve(VOID_ROOT, 'src', 'entrypoints', 'cli.tsx'),
          '--print',
          '--model',
          workstream.model,
          '--dangerously-skip-permissions',
          '-p',
          prompt,
        ]
      : [
          '--import',
          resolve(VOID_ROOT, 'scripts', 'register-loader.js'),
          resolve(VOID_ROOT, 'dist', 'entrypoints', 'cli.js'),
          '--print',
          '--model',
          workstream.model,
          '--dangerously-skip-permissions',
          '-p',
          prompt,
        ]

    // Run Void CLI as a subprocess in the worktree
    const result = await execa(command, cliArgs, {
      cwd: worktreePath,
      timeout: 600_000, // 10 minutes max per worker
      reject: false,
      env: { ...process.env, VOID_LAUNCH_CWD: worktreePath },
    })

    if (result.exitCode !== 0) {
      const errorMsg = result.stderr || result.stdout || `Exit code ${result.exitCode}`
      throw new Error(`Worker process failed: ${errorMsg}`)
    }

    // Mark tasks as done
    for (const task of workstream.tasks) {
      task.status = 'done'
    }

    workstream.status = 'done'
    callbacks.onWorkerComplete?.(workstream)
  } catch (err) {
    workstream.status = 'failed'
    const error = err instanceof Error ? err : new Error(String(err))
    callbacks.onWorkerFailed?.(workstream, error)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildWorkerPrompt(workstream: Workstream): string {
  const lines: string[] = [
    `You are a specialist ${workstream.domain} engineer working on a focused workstream.`,
    '',
    `## Workstream: ${workstream.name}`,
    '',
    workstream.description,
    '',
  ]

  if (workstream.scope.length > 0) {
    lines.push('## File scope (only touch these files/directories)')
    for (const s of workstream.scope) {
      lines.push(`- ${s}`)
    }
    lines.push('')
  }

  if (workstream.tasks.length > 0) {
    lines.push('## Tasks (complete in order)')
    for (let i = 0; i < workstream.tasks.length; i++) {
      const task = workstream.tasks[i]!
      const fileHint = task.file ? ` (${task.file})` : ''
      lines.push(`${i + 1}. ${task.description}${fileHint}`)
    }
    lines.push('')
  }

  lines.push(
    'Complete all tasks. Write clean, production-quality code.',
    'Commit your changes when done with a descriptive commit message.',
  )

  return lines.join('\n')
}
