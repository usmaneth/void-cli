/**
 * /swarm slash command — decompose a feature into parallel workstreams,
 * dispatch workers, merge results, and optionally review.
 *
 * Usage:
 *   /swarm <feature description> [--models domain=model,...] [--coordinator model] [--no-merge] [--no-review]
 */
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import TextInput from '../../components/TextInput.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
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
import {
  DEFAULT_MODEL_ASSIGNMENTS,
  type WorkstreamDomain,
} from '../../swarm/types.js'
import { decomposeTask } from '../../swarm/coordinator.js'
import { SwarmRenderer } from '../../swarm/renderer.js'
import { runWorker } from '../../swarm/worker.js'
import { mergeWorktrees } from '../../swarm/merger.js'
import { launchVoidex } from '../../utils/voidexLauncher.js'
import {
  extractFriendlyModelsFromText,
  resolveFriendlyModelInput,
} from '../../utils/model/friendlyModelResolver.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type SwarmArgs = {
  coordinatorModel?: string
  description: string
  modelOverrides: Partial<Record<WorkstreamDomain, string>>
  noMerge: boolean
  noReview: boolean
  promptForModels: boolean
}

type ResolvedSwarmSettings = {
  autoMerge: boolean
  coordinatorModel: string
  reviewAfterMerge: boolean
  maxWorkersParallel: number
  modelAssignments: Record<WorkstreamDomain, string>
}

const SWARM_DOMAINS: WorkstreamDomain[] = [
  'frontend',
  'backend',
  'wiring',
  'tests',
  'debugging',
  'custom',
]

const COORDINATOR_MODEL_FALLBACK = 'claude-opus-4-6'

const SWARM_PROMPT_FOR_MODELS_PATTERN =
  /\b(?:ask me|prompt me|let me choose|choose(?: the)? models?|pick(?: the)? models?|which model|what model|configure models?)\b/i

const SWARM_ASSIGNMENT_CONNECTOR_PATTERN =
  /\b(?:use|uses|using|with|via|for|on|as|assign|assigned|run(?:ning)?|should|should use|prefer|preferred|default to)\b|[:=]/i

const SWARM_COORDINATOR_PATTERN =
  /\b(?:coordinator|lead|planner|planning|reviewer|decomposer)\b/i

const DOMAIN_PATTERN_SOURCE =
  '(?:frontend|backend|wiring|tests|debugging|custom)'
const DOMAIN_LIST_PATTERN_SOURCE = `${DOMAIN_PATTERN_SOURCE}(?:\\s*(?:,|&|and)\\s*${DOMAIN_PATTERN_SOURCE})*`
const COORDINATOR_PATTERN_SOURCE =
  '(?:coordinator|lead|planner|planning|reviewer|decomposer)'

const SWARM_INLINE_MODEL_FOR_DOMAIN_PATTERN = new RegExp(
  `(?<model>[^,;]+?)\\bfor\\b\\s+(?<domain>${DOMAIN_PATTERN_SOURCE})\\b`,
  'gi',
)

const SWARM_INLINE_DOMAINS_TO_MODEL_PATTERN = new RegExp(
  `(?<domains>${DOMAIN_LIST_PATTERN_SOURCE})\\s+(?:should\\s+use|use|with|via|on|as|=|:)\\s+(?<model>[^,;]+?)(?=$|\\s+and\\s+[^,;]+?\\bfor\\b\\s+${DOMAIN_PATTERN_SOURCE}\\b|,|;)`,
  'gi',
)

const SWARM_INLINE_MODEL_FOR_COORDINATOR_PATTERN = new RegExp(
  `(?<model>[^,;]+?)\\bfor\\b\\s+(?<role>${COORDINATOR_PATTERN_SOURCE})\\b`,
  'gi',
)

const SWARM_INLINE_COORDINATOR_TO_MODEL_PATTERN = new RegExp(
  `(?<role>${COORDINATOR_PATTERN_SOURCE})\\s+(?:should\\s+use|use|with|via|on|as|=|:)\\s+(?<model>[^,;]+)`,
  'gi',
)

function normalizeModelOverride(model: string): string {
  return resolveFriendlyModelInput(model.trim()) ?? model.trim()
}

function resolveInlineAssignedModel(model: string): string | null {
  return resolveFriendlyModelInput(
    model.trim().replace(/^(?:and|then)\s+/i, ''),
  )
}

function isWorkstreamDomain(value: string): value is WorkstreamDomain {
  return SWARM_DOMAINS.includes(value as WorkstreamDomain)
}

function extractDomainsFromText(text: string): WorkstreamDomain[] {
  const matches = text.match(
    /\b(?:frontend|backend|wiring|tests|debugging|custom)\b/gi,
  )
  if (!matches) {
    return []
  }

  const seen = new Set<WorkstreamDomain>()
  const domains: WorkstreamDomain[] = []
  for (const match of matches) {
    const domain = match.toLowerCase() as WorkstreamDomain
    if (!seen.has(domain)) {
      seen.add(domain)
      domains.push(domain)
    }
  }
  return domains
}

function cleanupSwarmDescription(text: string): string {
  return text
    .replace(SWARM_PROMPT_FOR_MODELS_PATTERN, ' ')
    .replace(/\b(?:and|then)\b(?=\s*(?:,|$))/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ', ')
    .replace(/^,\s*/g, '')
    .replace(/,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripModelHintFromClause(clause: string): string {
  const extracted = extractFriendlyModelsFromText(clause)
  return extracted.remainingText
    .replace(
      /\b(?:frontend|backend|wiring|tests|debugging|custom|coordinator|lead|planner|planning|reviewer|decomposer)\b/gi,
      ' ',
    )
    .replace(
      /\b(?:use|uses|using|with|via|for|on|as|assign|assigned|run(?:ning)?|should|prefer|preferred|default|models?)\b|[:=]/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function parseInlineSwarmAssignments(clause: string): {
  coordinatorModel?: string
  matched: boolean
  modelOverrides: Partial<Record<WorkstreamDomain, string>>
} {
  const modelOverrides: Partial<Record<WorkstreamDomain, string>> = {}
  let coordinatorModel: string | undefined
  let matched = false

  for (const match of clause.matchAll(SWARM_INLINE_MODEL_FOR_DOMAIN_PATTERN)) {
    const domain = match.groups?.domain?.toLowerCase()
    const model = match.groups?.model
      ? resolveInlineAssignedModel(match.groups.model)
      : null
    if (domain && model && isWorkstreamDomain(domain)) {
      modelOverrides[domain] = model
      matched = true
    }
  }

  for (const match of clause.matchAll(SWARM_INLINE_DOMAINS_TO_MODEL_PATTERN)) {
    const domains = extractDomainsFromText(match.groups?.domains ?? '')
    const model = match.groups?.model
      ? resolveInlineAssignedModel(match.groups.model)
      : null
    if (!model || domains.length === 0) {
      continue
    }
    for (const domain of domains) {
      modelOverrides[domain] = model
    }
    matched = true
  }

  for (const match of clause.matchAll(SWARM_INLINE_MODEL_FOR_COORDINATOR_PATTERN)) {
    const model = match.groups?.model
      ? resolveInlineAssignedModel(match.groups.model)
      : null
    if (model) {
      coordinatorModel = model
      matched = true
    }
  }

  for (const match of clause.matchAll(
    SWARM_INLINE_COORDINATOR_TO_MODEL_PATTERN,
  )) {
    const model = match.groups?.model
      ? resolveInlineAssignedModel(match.groups.model)
      : null
    if (model) {
      coordinatorModel = model
      matched = true
    }
  }

  return {
    coordinatorModel,
    matched,
    modelOverrides,
  }
}

function parseSwarmModelAssignmentsFromText(raw: string): {
  coordinatorModel?: string
  description: string
  modelOverrides: Partial<Record<WorkstreamDomain, string>>
  promptForModels: boolean
} {
  const modelOverrides: Partial<Record<WorkstreamDomain, string>> = {}
  let coordinatorModel: string | undefined
  const promptForModels = SWARM_PROMPT_FOR_MODELS_PATTERN.test(raw)

  const clauses = raw
    .split(/[,;\n]+/)
    .map(clause => clause.trim())
    .filter(Boolean)

  const descriptionParts: string[] = []

  for (const clause of clauses) {
    if (
      SWARM_PROMPT_FOR_MODELS_PATTERN.test(clause) &&
      extractFriendlyModelsFromText(clause).models.length === 0
    ) {
      continue
    }

    const inlineAssignments = parseInlineSwarmAssignments(clause)
    if (
      inlineAssignments.matched &&
      (Object.keys(inlineAssignments.modelOverrides).length > 0 ||
        inlineAssignments.coordinatorModel)
    ) {
      Object.assign(modelOverrides, inlineAssignments.modelOverrides)
      coordinatorModel =
        inlineAssignments.coordinatorModel ?? coordinatorModel
      const stripped = stripModelHintFromClause(clause)
      if (stripped) {
        descriptionParts.push(stripped)
      }
      continue
    }

    const extractedModels = extractFriendlyModelsFromText(clause)
    const domains = extractDomainsFromText(clause)
    const hasCoordinatorHint = SWARM_COORDINATOR_PATTERN.test(clause)
    const looksLikeAssignment =
      extractedModels.models.length === 1 &&
      SWARM_ASSIGNMENT_CONNECTOR_PATTERN.test(clause)

    let consumed = false

    if (looksLikeAssignment && domains.length > 0) {
      const model = extractedModels.models[0]!
      for (const domain of domains) {
        modelOverrides[domain] = model
      }
      consumed = true
    }

    if (looksLikeAssignment && hasCoordinatorHint) {
      coordinatorModel = extractedModels.models[0]!
      consumed = true
    }

    if (consumed) {
      const stripped = stripModelHintFromClause(clause)
      if (stripped) {
        descriptionParts.push(stripped)
      }
      continue
    }

    descriptionParts.push(clause)
  }

  return {
    coordinatorModel,
    description: cleanupSwarmDescription(descriptionParts.join(', ')),
    modelOverrides,
    promptForModels,
  }
}

function parseDomainModelPairs(
  raw: string,
): Partial<Record<WorkstreamDomain, string>> {
  const overrides: Partial<Record<WorkstreamDomain, string>> = {}
  for (const pair of raw.split(',')) {
    const [domainRaw, modelRaw] = pair.split('=')
    const domain = domainRaw?.trim().toLowerCase()
    const model = modelRaw?.trim()
    if (!domain || !model || !isWorkstreamDomain(domain)) {
      continue
    }
    overrides[domain] = normalizeModelOverride(model)
  }
  return overrides
}

function parseSwarmArgs(raw: string): SwarmArgs {
  const flaggedModelOverrides: Partial<Record<WorkstreamDomain, string>> = {}
  let coordinatorModel: string | undefined
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
    } else if (part === '--coordinator' && parts[i + 1]) {
      coordinatorModel = normalizeModelOverride(parts[i + 1]!)
      i++
    } else if (part === '--models' && parts[i + 1]) {
      i++
      Object.assign(flaggedModelOverrides, parseDomainModelPairs(parts[i]!))
    } else {
      descParts.push(part)
    }
  }

  const naturalLanguageHints = parseSwarmModelAssignmentsFromText(
    descParts.join(' '),
  )

  return {
    coordinatorModel:
      coordinatorModel ?? naturalLanguageHints.coordinatorModel,
    description: naturalLanguageHints.description,
    modelOverrides: {
      ...naturalLanguageHints.modelOverrides,
      ...flaggedModelOverrides,
    },
    noMerge,
    noReview,
    promptForModels:
      naturalLanguageHints.promptForModels &&
      Object.keys(flaggedModelOverrides).length === 0,
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
    '  --coordinator model        Override the coordinator model',
    '  --no-merge                  Skip auto-merge after workers complete',
    '  --no-review                 Skip review pass after merge',
    '',
    'Example:',
    '  /swarm Add user authentication with JWT tokens',
    '  /swarm Refactor API layer --models backend=openai/gpt-5.4,tests=claude-sonnet-4-6',
    '  /swarm Build the dashboard, use gemini for frontend and gpt 5.4 for backend',
  ].join('\n')
}

function SwarmRunner({
  parsed,
  settings,
  onDone,
}: {
  parsed: SwarmArgs
  settings: ResolvedSwarmSettings
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const repoRoot = process.cwd()
  const parsedRef = useRef(parsed)
  const settingsRef = useRef(settings)
  const progressTicksRef = useRef<Map<string, number>>(new Map())
  const workstreamsRef = useRef<Workstream[]>([])
  const [state, setState] = useState<SwarmState | null>(null)
  const [workerMessages, setWorkerMessages] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [awaitingApproval, setAwaitingApproval] = useState(false)
  const [configuringModels, setConfiguringModels] = useState(
    parsed.promptForModels,
  )
  const [modelConfigInput, setModelConfigInput] = useState('')
  const [modelConfigCursorOffset, setModelConfigCursorOffset] = useState(0)
  const [modelConfigMessage, setModelConfigMessage] = useState<string | null>(
    null,
  )
  const approvalResolveRef = useRef<(() => void) | null>(null)

  function getCoordinatorModel(): string {
    return (
      parsedRef.current.coordinatorModel ??
      settingsRef.current.coordinatorModel ??
      COORDINATOR_MODEL_FALLBACK
    )
  }

  function applyPendingModelOverrides(
    overrides: Partial<Record<WorkstreamDomain, string>>,
  ): void {
    for (const workstream of workstreamsRef.current) {
      workstream.model = overrides[workstream.domain] ?? workstream.model
    }

    parsedRef.current = {
      ...parsedRef.current,
      modelOverrides: {
        ...parsedRef.current.modelOverrides,
        ...overrides,
      },
    }

    setState(prev => {
      if (!prev) return prev
      const updatedWorkstreams = prev.workstreams.map(workstream => ({
        ...workstream,
        model: overrides[workstream.domain] ?? workstream.model,
      }))
      return {
        ...prev,
        workstreams: updatedWorkstreams,
        config: {
          ...prev.config,
          workstreams: updatedWorkstreams,
        },
      }
    })
  }

  function handleModelConfigSubmit(value: string): void {
    const trimmed = value.trim()
    setModelConfigInput('')
    setModelConfigCursorOffset(0)

    if (!trimmed) {
      setConfiguringModels(false)
      setModelConfigMessage('Keeping current model assignments')
      return
    }

    const overrides = {
      ...parseDomainModelPairs(trimmed),
      ...parseSwarmModelAssignmentsFromText(trimmed).modelOverrides,
    }

    if (Object.keys(overrides).length === 0) {
      setModelConfigMessage(
        'No valid model overrides found. Try frontend=gemini,backend=gpt-5.4',
      )
      return
    }

    applyPendingModelOverrides(overrides)
    setConfiguringModels(false)
    setModelConfigMessage(
      `Updated ${Object.keys(overrides).length} swarm model assignment(s)`,
    )
  }

  useEffect(() => {
    let cancelled = false

    const setInitialState = () => {
      if (cancelled) return
      const parsed = parsedRef.current
      const resolvedSettings = settingsRef.current
      const coordinatorModel = getCoordinatorModel()
      setState({
        config: {
          description: parsed.description,
          workstreams: [],
          coordinator: coordinatorModel,
          autoMerge: resolvedSettings.autoMerge,
          reviewAfterMerge: resolvedSettings.reviewAfterMerge,
          maxWorkersParallel: resolvedSettings.maxWorkersParallel,
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
      const resolvedSettings = settingsRef.current
      const coordinatorModel = getCoordinatorModel()
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
        workstream.model =
          parsed.modelOverrides[workstream.domain] ??
          resolvedSettings.modelAssignments[workstream.domain] ??
          workstream.model
      }
      workstreamsRef.current = workstreams

      const cloned = cloneWorkstreams(workstreams)
      if (!cancelled) {
        // Show decomposition plan and wait for user approval
        setState(prev => {
          if (!prev) return prev
          return {
            ...prev,
            config: { ...prev.config, workstreams: cloned },
            phase: 'awaiting_approval',
            workstreams: cloned,
          }
        })
        setAwaitingApproval(true)
        await new Promise<void>(resolve => {
          approvalResolveRef.current = resolve
        })
        setAwaitingApproval(false)
        if (cancelled) return

        // Approved — start building
        setState(prev => {
          if (!prev) return prev
          return { ...prev, phase: 'working' }
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

      const maxParallel = resolvedSettings.maxWorkersParallel
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

      if (resolvedSettings.autoMerge && completed.length > 0) {
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

      if (resolvedSettings.reviewAfterMerge && completed.length > 0 && !cancelled) {
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
          !resolvedSettings.autoMerge || completed.length === 0
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

  // Handle Enter key for approval
  useInput((input, key) => {
    if (!awaitingApproval) {
      return
    }

    if ((input === 'm' || input === 'M') && !configuringModels) {
      setConfiguringModels(true)
      setModelConfigMessage(
        'Set worker models with frontend=gemini,wiring=opus or natural language',
      )
      return
    }

    if (key.escape && configuringModels) {
      setConfiguringModels(false)
      setModelConfigMessage('Keeping current model assignments')
      return
    }

    if (configuringModels) {
      return
    }

    if (key.return && approvalResolveRef.current) {
      approvalResolveRef.current()
      approvalResolveRef.current = null
    }
  })

  return (
    <Box flexDirection="column">
      <SwarmRenderer
        state={state}
        workerMessages={workerMessages}
        isConfiguringModels={configuringModels}
      />
      {awaitingApproval && configuringModels ? (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          marginTop={1}
          paddingX={1}
        >
          <Text bold color="yellow">
            Configure worker models before launch
          </Text>
          <Text dimColor>
            Current assignments:{' '}
            {state?.workstreams
              .map(workstream => `${workstream.domain}=${workstream.model}`)
              .join(' · ') || 'waiting for decomposition'}
          </Text>
          <Text dimColor>
            Enter overrides like frontend=gemini,wiring=opus or “use gpt 5.4
            for backend”.
          </Text>
          <TextInput
            value={modelConfigInput}
            onChange={value => {
              setModelConfigInput(value)
              setModelConfigCursorOffset(value.length)
              if (modelConfigMessage) {
                setModelConfigMessage(null)
              }
            }}
            onSubmit={handleModelConfigSubmit}
            focus
            showCursor
            placeholder="frontend=gemini,wiring=opus"
            columns={Math.max(40, columns - 4)}
            cursorOffset={modelConfigCursorOffset}
            onChangeCursorOffset={setModelConfigCursorOffset}
          />
          <Text dimColor>enter save overrides · esc keep current assignments</Text>
        </Box>
      ) : null}
      {awaitingApproval && modelConfigMessage ? (
        <Box marginTop={1}>
          <Text dimColor>{modelConfigMessage}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function extractGuiFlag(args: string): { args: string; gui: boolean } {
  const tokens = (args || '').split(/\s+/)
  const filtered: string[] = []
  let gui = false
  for (const t of tokens) {
    if (t === '--gui' || t === '-g') gui = true
    else filtered.push(t)
  }
  return { args: filtered.join(' ').trim(), gui }
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const stripped = extractGuiFlag(args)
  if (stripped.gui) {
    const result = launchVoidex({
      mode: 'swarm',
      prompt: stripped.args,
      cwd: process.env.VOID_LAUNCH_CWD || process.cwd(),
    })
    onDone(
      result.ok
        ? `Opened Voidex in swarm mode${stripped.args ? ' with your prompt' : ''}.`
        : `Failed to open Voidex: ${result.error}`,
      { display: 'system' },
    )
    return null
  }

  const parsed = parseSwarmArgs(stripped.args)
  const settings = getSettingsForSource('userSettings')
  const swarmSettings = settings?.swarm

  if (!parsed.description) {
    onDone(createUsageMessage(), { display: 'system' })
    return null
  }

  const modelAssignments: Record<WorkstreamDomain, string> = {
    ...DEFAULT_MODEL_ASSIGNMENTS,
  }

  const configuredAssignments = swarmSettings?.defaultAssignments as
    | Partial<Record<WorkstreamDomain, string>>
    | undefined
  if (configuredAssignments) {
    for (const domain of SWARM_DOMAINS) {
      const configured = configuredAssignments[domain]
      if (configured) {
        modelAssignments[domain] = normalizeModelOverride(configured)
      }
    }
  }

  const resolvedSettings: ResolvedSwarmSettings = {
    autoMerge: parsed.noMerge ? false : (swarmSettings?.autoMerge ?? true),
    coordinatorModel: COORDINATOR_MODEL_FALLBACK,
    reviewAfterMerge: parsed.noReview
      ? false
      : (swarmSettings?.reviewAfterMerge ?? true),
    maxWorkersParallel: swarmSettings?.maxWorkersParallel ?? 3,
    modelAssignments,
  }

  return (
    <SwarmRunner parsed={parsed} settings={resolvedSettings} onDone={onDone} />
  )
}
