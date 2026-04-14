/**
 * /swarm slash command — decompose a feature into parallel workstreams,
 * dispatch workers, merge results, and optionally review.
 *
 * Usage:
 *   /swarm <feature description> [--models domain=model,...] [--no-merge] [--no-review]
 */

import type { Command, LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import type { SwarmCallbacks, SwarmState, Workstream } from '../../swarm/types.js'
import type { WorkstreamDomain } from '../../swarm/types.js'
import { decomposeTask } from '../../swarm/coordinator.js'
import { runWorker } from '../../swarm/worker.js'
import { mergeWorktrees } from '../../swarm/merger.js'

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type SwarmArgs = {
  description: string
  modelOverrides: Partial<Record<WorkstreamDomain, string>>
  noMerge: boolean
  noReview: boolean
}

function parseSwarmArgs(raw: string): SwarmArgs {
  const modelOverrides: Partial<Record<WorkstreamDomain, string>> = {}
  let noMerge = false
  let noReview = false

  const parts = raw.split(/\s+/)
  const descParts: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part === '--no-merge') {
      noMerge = true
    } else if (part === '--no-review') {
      noReview = true
    } else if (part === '--models' && parts[i + 1]) {
      i++
      const pairs = parts[i]!.split(',')
      for (const pair of pairs) {
        const [domain, model] = pair.split('=')
        if (domain && model) {
          modelOverrides[domain as WorkstreamDomain] = model
        }
      }
    } else {
      descParts.push(part)
    }
  }

  return {
    description: descParts.join(' '),
    modelOverrides,
    noMerge,
    noReview,
  }
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

export const call: LocalCommandCall = async (args, _context) => {
  const parsed = parseSwarmArgs(args)

  if (!parsed.description) {
    return {
      type: 'text',
      value: [
        'Usage: /swarm <feature description> [options]',
        '',
        'Options:',
        '  --models domain=model,...   Override model for a domain',
        '  --no-merge                  Skip auto-merge after workers complete',
        '  --no-review                 Skip review pass after merge',
        '',
        'Example:',
        '  /swarm Add user authentication with JWT tokens',
        '  /swarm Refactor API layer --models backend=openai/gpt-5.4,tests=claude-sonnet-4-6',
      ].join('\n'),
    }
  }

  const repoRoot = process.cwd()
  const coordinatorModel = 'claude-opus-4-6'
  const lines: string[] = []

  const log = (msg: string) => {
    lines.push(msg)
  }

  // Phase 1: Decompose
  log('--- Phase 1: Decomposing task ---')
  log(`Coordinator model: ${coordinatorModel}`)
  log(`Feature: ${parsed.description}`)
  log('')

  let workstreams: Workstream[]
  try {
    workstreams = await decomposeTask(
      parsed.description,
      '', // codebase context — could be enhanced later
      coordinatorModel,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'text', value: `Decomposition failed: ${msg}` }
  }

  // Apply model overrides
  for (const ws of workstreams) {
    if (parsed.modelOverrides[ws.domain]) {
      ws.model = parsed.modelOverrides[ws.domain]!
    }
  }

  log(`Decomposed into ${workstreams.length} workstreams:`)
  for (const ws of workstreams) {
    log(`  [${ws.domain}] ${ws.name} — ${ws.model}`)
    log(`    ${ws.description}`)
    log(`    Scope: ${ws.scope.join(', ') || '(unrestricted)'}`)
    log(`    Tasks: ${ws.tasks.length}`)
  }
  log('')

  // Phase 2: Dispatch workers
  log('--- Phase 2: Dispatching workers ---')

  const maxParallel = 4
  const state: SwarmState = {
    config: {
      description: parsed.description,
      workstreams,
      coordinator: coordinatorModel,
      autoMerge: !parsed.noMerge,
      reviewAfterMerge: !parsed.noReview,
      maxWorkersParallel: maxParallel,
    },
    phase: 'working',
    workstreams,
    totalCostUSD: 0,
    startTime: Date.now(),
  }

  const callbacks: SwarmCallbacks = {
    onWorkerStart: ws => log(`  [START] ${ws.name} (${ws.model})`),
    onWorkerProgress: (ws, msg) => log(`  [PROGRESS] ${ws.name}: ${msg}`),
    onWorkerComplete: ws => log(`  [DONE] ${ws.name}`),
    onWorkerFailed: (ws, err) => log(`  [FAILED] ${ws.name}: ${err.message}`),
  }

  // Run workers in parallel batches
  const batches: Workstream[][] = []
  for (let i = 0; i < workstreams.length; i += maxParallel) {
    batches.push(workstreams.slice(i, i + maxParallel))
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(ws => runWorker(ws, repoRoot, callbacks)),
    )
    for (const r of results) {
      if (r.status === 'rejected') {
        log(`  Worker error: ${r.reason}`)
      }
    }
  }

  const completed = workstreams.filter(ws => ws.status === 'done')
  const failed = workstreams.filter(ws => ws.status === 'failed')
  log('')
  log(`Workers complete: ${completed.length} done, ${failed.length} failed`)
  log('')

  // Phase 3: Merge
  if (!parsed.noMerge && completed.length > 0) {
    log('--- Phase 3: Merging worktrees ---')
    state.phase = 'merging'

    try {
      const mergeResult = await mergeWorktrees(workstreams, repoRoot)
      if (mergeResult.success) {
        log('  All branches merged cleanly.')
      } else {
        log(`  Merged with ${mergeResult.conflicts} conflict(s) (auto-resolved).`)
        log(`  Conflict files: ${mergeResult.conflictFiles.join(', ')}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`  Merge failed: ${msg}`)
    }
    log('')
  } else if (parsed.noMerge) {
    log('--- Phase 3: Merge skipped (--no-merge) ---')
    log('')
  }

  // Phase 4: Review (placeholder — just reports status)
  if (!parsed.noReview && completed.length > 0) {
    log('--- Phase 4: Review ---')
    state.phase = 'reviewing'
    log('  Review pass: run /review or /diff to inspect the merged result.')
    log('')
  }

  // Summary
  const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1)
  state.phase = 'complete'
  log('--- Swarm Complete ---')
  log(`  Duration: ${elapsed}s`)
  log(`  Workstreams: ${completed.length} done, ${failed.length} failed`)
  if (completed.length > 0 && !parsed.noMerge) {
    log('  Changes merged into current branch.')
  }

  return { type: 'text', value: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const swarmCommand = {
  type: 'local',
  name: 'swarm',
  description: 'Decompose a feature into parallel workstreams with multi-model agents',
  argumentHint: '<feature description> [--models domain=model,...] [--no-merge] [--no-review]',
  isEnabled: () => true,
  supportsNonInteractive: true,
  isHidden: false,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default swarmCommand
