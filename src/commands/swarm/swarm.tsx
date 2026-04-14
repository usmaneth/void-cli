/**
 * /swarm slash command — decompose a feature into parallel workstreams,
 * dispatch workers, merge results, and optionally review.
 *
 * Usage:
 *   /swarm <feature description> [--models domain=model,...] [--no-merge] [--no-review]
 */
import * as React from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import type {
  Command,
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type {
  MergeResult,
  SwarmCallbacks,
  SwarmState,
  Workstream,
  WorkstreamTask,
} from '../../swarm/types.js'
import type { WorkstreamDomain } from '../../swarm/types.js'
import { decomposeTask } from '../../swarm/coordinator.js'
import { SwarmRenderer } from '../../swarm/renderer.js'
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

function cloneTasks(tasks: WorkstreamTask[]): WorkstreamTask[] {
  return tasks.map(task => ({ ...task }))
}

function cloneWorkstreams(workstreams: Workstream[]): Workstream[] {
  return workstreams.map(workstream => ({
    ...workstream,
    tasks: cloneTasks(workstream.tasks),
  }))
}

function updateWorkstreamTaskProgress(
  tasks: WorkstreamTask[],
  progressStep: number,
): WorkstreamTask[] {
  if (tasks.length === 0) return tasks
  const clampedIndex = Math.min(progressStep, tasks.length - 1)

  return tasks.map((task, index) => {
    if (index < clampedIndex) return { ...task, status: 'done' }
    if (index === clampedIndex) {
      return {
        ...task,
        status: task.status === 'done' ? 'done' : 'in-progress',
      }
    }
    return { ...task, status: 'pending' }
  })
}

function createUsageMessage(): string {
  return [
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
  ].join('\n')
}

function SwarmRunner({
  args,
  onDone,
}: {
  args: string
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const repoRoot = process.cwd()
  const coordinatorModel = 'claude-opus-4-6'
  const parsedRef = useRef(parseSwarmArgs(args))
  const progressTicksRef = useRef<Map<string, number>>(new Map())
  const [state, setState] = useState<SwarmState | null>(null)
  const [workerMessages, setWorkerMessages] = useState<Map<string, string>>(
    () => new Map(),
  )

  useEffect(() => {
    let cancelled = false

    const setInitialState = () => {
      if (cancelled) return
      const parsed = parsedRef.current
      setState({
        config: {
          description: parsed.description,
          workstreams: [],
          coordinator: coordinatorModel,
          autoMerge: !parsed.noMerge,
          reviewAfterMerge: !parsed.noReview,
          maxWorkersParallel: 4,
        },
        phase: 'decomposing',
        workstreams: [],
        totalCostUSD: 0,
        startTime: Date.now(),
      })
    }

    const updateOneWorkstream = (
      workstreamId: string,
      updater: (workstream: Workstream) => Workstream,
    ) => {
      setState(prev => {
        if (!prev) return prev
        return {
          ...prev,
          workstreams: prev.workstreams.map(workstream =>
            workstream.id === workstreamId ? updater(workstream) : workstream,
          ),
        }
      })
    }

    const run = async () => {
      const parsed = parsedRef.current
      setInitialState()

      let workstreams: Workstream[]
      try {
        workstreams = await decomposeTask(parsed.description, '', coordinatorModel)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err)
          onDone(`Decomposition failed: ${message}`, { display: 'system' })
        }
        return
      }

      for (const workstream of workstreams) {
        if (parsed.modelOverrides[workstream.domain]) {
          workstream.model = parsed.modelOverrides[workstream.domain]!
        }
      }

      const cloned = cloneWorkstreams(workstreams)
      if (!cancelled) {
        setState(prev => {
          if (!prev) return prev
          return {
            ...prev,
            config: {
              ...prev.config,
              workstreams: cloned,
            },
            phase: 'working',
            workstreams: cloned,
          }
        })
      }

      const callbacks: SwarmCallbacks = {
        onWorkerStart: workstream => {
          if (cancelled) return
          setWorkerMessages(prev => {
            const next = new Map(prev)
            next.set(workstream.id, `Starting ${workstream.model}`)
            return next
          })
          updateOneWorkstream(workstream.id, current => ({
            ...current,
            status: 'running',
            worktreeBranch: workstream.worktreeBranch,
            worktreePath: workstream.worktreePath,
            tasks: updateWorkstreamTaskProgress(current.tasks, 0),
          }))
        },
        onWorkerProgress: (workstream, message) => {
          if (cancelled) return
          setWorkerMessages(prev => {
            const next = new Map(prev)
            next.set(workstream.id, message)
            return next
          })
          const nextStep = progressTicksRef.current.get(workstream.id) ?? 0
          progressTicksRef.current.set(workstream.id, nextStep + 1)
          updateOneWorkstream(workstream.id, current => ({
            ...current,
            worktreeBranch: workstream.worktreeBranch,
            worktreePath: workstream.worktreePath,
            tasks: updateWorkstreamTaskProgress(current.tasks, nextStep),
          }))
        },
        onWorkerComplete: workstream => {
          if (cancelled) return
          setWorkerMessages(prev => {
            const next = new Map(prev)
            next.set(workstream.id, 'Worker finished and changes are ready for merge')
            return next
          })
          updateOneWorkstream(workstream.id, current => ({
            ...current,
            status: 'done',
            worktreeBranch: workstream.worktreeBranch,
            worktreePath: workstream.worktreePath,
            tasks: current.tasks.map(task => ({ ...task, status: 'done' })),
          }))
        },
        onWorkerFailed: (workstream, error) => {
          if (cancelled) return
          setWorkerMessages(prev => {
            const next = new Map(prev)
            next.set(workstream.id, error.message)
            return next
          })
          updateOneWorkstream(workstream.id, current => ({
            ...current,
            status: 'failed',
            tasks: current.tasks.map(task =>
              task.status === 'done' ? task : { ...task, status: 'failed' },
            ),
          }))
        },
      }

      const maxParallel = 4
      const batches: Workstream[][] = []
      for (let index = 0; index < workstreams.length; index += maxParallel) {
        batches.push(workstreams.slice(index, index + maxParallel))
      }

      for (const batch of batches) {
        const results = await Promise.allSettled(
          batch.map(workstream => runWorker(workstream, repoRoot, callbacks)),
        )
        if (cancelled) return
        for (const result of results) {
          if (result.status === 'rejected') {
            setState(prev =>
              prev
                ? {
                    ...prev,
                    totalCostUSD: prev.totalCostUSD,
                  }
                : prev,
            )
          }
        }
      }

      const completed = workstreams.filter(workstream => workstream.status === 'done')
      const failed = workstreams.filter(workstream => workstream.status === 'failed')
      let mergeResult: MergeResult | null = null

      if (!parsed.noMerge && completed.length > 0) {
        if (!cancelled) {
          setState(prev => (prev ? { ...prev, phase: 'merging' } : prev))
        }
        try {
          mergeResult = await mergeWorktrees(workstreams, repoRoot)
          if (!cancelled) {
            const message = mergeResult.success
              ? 'Merged all workstreams cleanly'
              : `Merged with ${mergeResult.conflicts} conflict(s)`
            setWorkerMessages(prev => {
              const next = new Map(prev)
              next.set('__merge__', message)
              return next
            })
          }
        } catch (err) {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : String(err)
            setWorkerMessages(prev => {
              const next = new Map(prev)
              next.set('__merge__', `Merge failed: ${message}`)
              return next
            })
          }
        }
      }

      if (!parsed.noReview && completed.length > 0 && !cancelled) {
        setState(prev => (prev ? { ...prev, phase: 'reviewing' } : prev))
        setWorkerMessages(prev => {
          const next = new Map(prev)
          next.set('__review__', 'Reviewing merged result')
          return next
        })
      }

      if (!cancelled) {
        setState(prev => (prev ? { ...prev, phase: 'complete' } : prev))
        const mergeSummary =
          parsed.noMerge || completed.length === 0
            ? 'merge skipped'
            : mergeResult?.success === false
              ? `merged with ${mergeResult.conflicts} conflict(s)`
              : 'merged cleanly'
        onDone(
          `Swarm complete: ${completed.length} workstream(s) done, ${failed.length} failed, ${mergeSummary}`,
          { display: 'system' },
        )
      }
    }

    void run().catch(err => {
      if (!cancelled) {
        setState(prev => (prev ? { ...prev, phase: 'failed' } : prev))
        onDone(`Swarm failed: ${err.message ?? String(err)}`, {
          display: 'system',
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [onDone, repoRoot])

  return <SwarmRenderer state={state} workerMessages={workerMessages} />
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const parsed = parseSwarmArgs(args)
  if (!parsed.description) {
    onDone(createUsageMessage(), { display: 'system' })
    return null
  }

  return <SwarmRunner args={args} onDone={onDone} />
}
