/**
 * Swarm Worker — runs a single workstream in an isolated git worktree.
 *
 * 1. Creates a git worktree + branch for the workstream
 * 2. Builds a prompt from the workstream description, tasks, and scope
 * 3. Launches Void CLI as a subprocess to do the actual work
 * 4. Reports progress via callbacks
 */

import { resolve } from 'node:path'
import { execa } from 'execa'
import type { SwarmCallbacks, Workstream } from './types.js'

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

    // Find the CLI entrypoint
    const cliPath = resolve(repoRoot, 'dist', 'entrypoints', 'cli.js')

    callbacks.onWorkerProgress?.(workstream, `Starting worker model: ${workstream.model}`)

    // Run Void CLI as a subprocess in the worktree
    const result = await execa(
      'node',
      [
        cliPath,
        '--print',
        '--model',
        workstream.model,
        '--dangerously-skip-permissions',
        '-p',
        prompt,
      ],
      {
        cwd: worktreePath,
        timeout: 600_000, // 10 minutes max per worker
        reject: false,
      },
    )

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
