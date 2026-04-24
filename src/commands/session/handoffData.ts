import { getChangedFiles, getFileStatus } from '../../utils/git.js'
import { logForDebugging } from '../../utils/debug.js'
import type { Message } from '../../types/message.js'

export type HandoffFile = {
  path: string
  /** Short status label: 'M' (modified), 'A' (added), 'D' (deleted), '??' (untracked), 'edited' */
  status: string
}

export type HandoffSummary = {
  changedFiles: HandoffFile[]
  /** Where the file list came from - 'session' means derived from tool results, 'git-status' is the fallback. */
  filesSource: 'session' | 'git-status' | 'merged'
  validationCommands: string[]
  unresolvedRisks: string[]
  suggestedNextActions: string[]
}

/**
 * Regex patterns that indicate a bash command is a test, lint, typecheck,
 * build, or other validation step worth surfacing in the handoff.
 *
 * Matching is intentionally broad — false positives (e.g. a package named
 * 'build-stuff') are harmless since the handoff is advisory. Intent is to
 * catch common validation invocations across ecosystems.
 */
const VALIDATION_COMMAND_PATTERNS: readonly RegExp[] = [
  // Node/JS package runners (test, lint, typecheck, check, build, format)
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|type-check|check|build|format|ci)\b/i,
  /\bnpx\s+(?:vitest|jest|mocha|tsc|eslint|prettier|biome|oxlint)\b/i,
  // Direct runners
  /\b(?:vitest|jest|mocha|playwright|cypress)\b/i,
  /\btsc(?:\s|$|\s+--)/,
  /\b(?:eslint|prettier|biome|oxlint|ruff|mypy|pylint|flake8)\b/i,
  // Python
  /\bpytest\b/i,
  /\bpython\s+-m\s+(?:pytest|unittest|mypy|ruff)\b/i,
  // Go / Rust / Make
  /\bgo\s+(?:test|build|vet)\b/i,
  /\bcargo\s+(?:test|build|check|clippy|fmt)\b/i,
  /\bmake\s+(?:test|check|lint|build|ci)\b/i,
]

/**
 * Risk markers to surface in the handoff. We look for these as whole words to
 * avoid matching random substrings (e.g. 'tod' inside 'today').
 */
const RISK_MARKERS: readonly string[] = ['TODO', 'FIXME', 'XXX', 'HACK']

const RISK_LINE_REGEX = new RegExp(
  `\\b(?:${RISK_MARKERS.join('|')})\\b[^\\n]*`,
  'g',
)

const MAX_RISK_LINES = 20
const MAX_VALIDATION_COMMANDS = 20
/** Truncation limit for any single surfaced snippet (risks, commands). */
const MAX_SNIPPET_LENGTH = 140

function truncate(text: string, limit = MAX_SNIPPET_LENGTH): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 1)}…`
}

function dedupe<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items))
}

type ToolUseBlock = {
  type: 'tool_use'
  name?: string
  input?: unknown
}

type TextBlock = {
  type: 'text'
  text?: string
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use'
  )
}

function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text'
  )
}

/**
 * Scan assistant tool-use blocks for Bash invocations and return the command
 * strings (deduped, preserving first-seen order).
 */
function extractBashCommands(messages: readonly Message[]): string[] {
  const commands: string[] = []
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isToolUseBlock(block)) continue
      if (block.name !== 'Bash') continue
      const input = block.input
      if (
        typeof input === 'object' &&
        input !== null &&
        typeof (input as { command?: unknown }).command === 'string'
      ) {
        commands.push((input as { command: string }).command)
      }
    }
  }
  return commands
}

/**
 * Filter the observed bash commands to those matching validation patterns
 * (tests, lint, typecheck, build, etc.). Each command is trimmed to its first
 * line so multi-line scripts still produce a readable entry.
 */
function filterValidationCommands(commands: readonly string[]): string[] {
  const validation: string[] = []
  for (const raw of commands) {
    const firstLine = raw.split('\n').find(l => l.trim().length > 0) ?? raw
    if (VALIDATION_COMMAND_PATTERNS.some(re => re.test(firstLine))) {
      validation.push(truncate(firstLine))
    }
  }
  return dedupe(validation).slice(0, MAX_VALIDATION_COMMANDS)
}

/**
 * Scan assistant text blocks for TODO/FIXME/XXX/HACK markers and surface the
 * surrounding line. We deliberately ignore user messages so user-quoted
 * markers don't appear as the assistant's own risks.
 */
function extractRisks(messages: readonly Message[]): string[] {
  const risks: string[] = []
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isTextBlock(block)) continue
      const text = block.text
      if (typeof text !== 'string') continue
      const matches = text.match(RISK_LINE_REGEX)
      if (!matches) continue
      for (const match of matches) {
        risks.push(truncate(match))
        if (risks.length >= MAX_RISK_LINES * 2) break
      }
    }
  }
  return dedupe(risks).slice(0, MAX_RISK_LINES)
}

/**
 * Extract file paths edited by the assistant via Edit / Write / MultiEdit /
 * NotebookEdit tool calls. Returns paths in first-seen order.
 */
function extractEditedFiles(messages: readonly Message[]): string[] {
  const paths: string[] = []
  const editTools = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isToolUseBlock(block)) continue
      if (!block.name || !editTools.has(block.name)) continue
      const input = block.input
      if (
        typeof input === 'object' &&
        input !== null &&
        typeof (input as { file_path?: unknown }).file_path === 'string'
      ) {
        paths.push((input as { file_path: string }).file_path)
      } else if (
        typeof input === 'object' &&
        input !== null &&
        typeof (input as { notebook_path?: unknown }).notebook_path === 'string'
      ) {
        paths.push((input as { notebook_path: string }).notebook_path)
      }
    }
  }
  return dedupe(paths)
}

function buildSuggestedActions(params: {
  changedFiles: HandoffFile[]
  validationCommands: readonly string[]
  unresolvedRisks: readonly string[]
  hasMessages: boolean
}): string[] {
  const actions: string[] = []
  const { changedFiles, validationCommands, unresolvedRisks, hasMessages } =
    params

  if (changedFiles.length > 0) {
    actions.push(
      `Review the ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'} and commit once verified.`,
    )
  }

  if (changedFiles.length > 0 && validationCommands.length === 0) {
    actions.push(
      'Run your project typecheck/test commands - none were observed this session.',
    )
  } else if (validationCommands.length > 0) {
    actions.push(
      'Re-run the observed validation commands to confirm a clean slate before handing off.',
    )
  }

  if (unresolvedRisks.length > 0) {
    actions.push(
      `Resolve the ${unresolvedRisks.length} TODO/FIXME marker${unresolvedRisks.length === 1 ? '' : 's'} or document them for the next session.`,
    )
  }

  const untrackedCount = changedFiles.filter(f => f.status === '??').length
  if (untrackedCount > 0) {
    actions.push(
      `Decide whether to track the ${untrackedCount} untracked file${untrackedCount === 1 ? '' : 's'} (git add) or add them to .gitignore.`,
    )
  }

  if (!hasMessages) {
    actions.push(
      'This handoff view has no conversation context - run it at the end of an interactive session for richer results.',
    )
  }

  if (actions.length === 0) {
    actions.push(
      'No explicit follow-ups - confirm with the next session owner and close out.',
    )
  }

  return actions
}

/**
 * Build the end-of-session handoff summary. Reads tool-call data from
 * `messages` for rich signal and falls back to `git status` for the changed
 * files list when the session produced no Edit/Write tool results.
 *
 * Safe to call outside a git repo - the fallback just returns an empty list.
 */
export async function buildHandoff(
  messages: readonly Message[],
): Promise<HandoffSummary> {
  const bashCommands = extractBashCommands(messages)
  const validationCommands = filterValidationCommands(bashCommands)
  const unresolvedRisks = extractRisks(messages)
  const editedPaths = extractEditedFiles(messages)

  let changedFiles: HandoffFile[] = []
  let filesSource: HandoffSummary['filesSource'] = 'session'

  let gitTracked: string[] = []
  let gitUntracked: string[] = []
  try {
    const status = await getFileStatus()
    gitTracked = status.tracked
    gitUntracked = status.untracked
  } catch (err) {
    logForDebugging('handoff: getFileStatus failed', err)
    try {
      // Last-ditch fallback: getChangedFiles doesn't distinguish tracked
      // vs untracked but still gives us a flat list.
      gitTracked = await getChangedFiles()
    } catch (err2) {
      logForDebugging('handoff: getChangedFiles also failed', err2)
    }
  }

  if (editedPaths.length > 0) {
    const gitSet = new Set<string>([...gitTracked, ...gitUntracked])
    const seen = new Set<string>()
    for (const p of editedPaths) {
      if (seen.has(p)) continue
      seen.add(p)
      changedFiles.push({ path: p, status: 'edited' })
    }
    // Add git-only entries (files changed outside tool calls) to avoid
    // losing real uncommitted work from the handoff.
    for (const t of gitTracked) {
      if (!seen.has(t)) {
        changedFiles.push({ path: t, status: 'M' })
        seen.add(t)
      }
    }
    for (const u of gitUntracked) {
      if (!seen.has(u)) {
        changedFiles.push({ path: u, status: '??' })
        seen.add(u)
      }
    }
    filesSource = gitSet.size > 0 ? 'merged' : 'session'
  } else {
    changedFiles = [
      ...gitTracked.map(p => ({ path: p, status: 'M' })),
      ...gitUntracked.map(p => ({ path: p, status: '??' })),
    ]
    filesSource = 'git-status'
  }

  const suggestedNextActions = buildSuggestedActions({
    changedFiles,
    validationCommands,
    unresolvedRisks,
    hasMessages: messages.length > 0,
  })

  return {
    changedFiles,
    filesSource,
    validationCommands,
    unresolvedRisks,
    suggestedNextActions,
  }
}
