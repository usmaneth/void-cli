/**
 * validationStatus — pure derivation of the latest validation command and its
 * result from the conversation transcript.
 *
 * We classify Bash tool_use commands into four validation buckets (lint,
 * typecheck, test, build) via command-pattern heuristics, then walk forward
 * to find a matching tool_result user message. The result's exit status (when
 * available via toolUseResult.stdout/stderr/exitCode) and text content are
 * used to decide pass / fail / running.
 *
 * This is a pure function over messages — no global state, no side effects.
 * The sticky ValidationStatus component re-computes on each render (messages
 * change rarely relative to our O(n) scan which tail-walks the last ~200
 * entries, cheap in practice).
 */
import type { Message } from '../../types/message.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'

/** Validation categories we detect. */
export type ValidationKind = 'lint' | 'typecheck' | 'test' | 'build'

/** pass/fail/running — mirrors how the HUD paints the status dot. */
export type ValidationState = 'pass' | 'fail' | 'running'

export type ValidationRecord = {
  kind: ValidationKind
  state: ValidationState
  /** Truncated command line the user ran (for display). */
  command: string
  /** UUID of the assistant tool_use message — transcript reference. */
  toolUseUuid: string | undefined
  /** UUID of the matching user tool_result, if the call has completed. */
  toolResultUuid: string | undefined
  /** Unix ms timestamp from the originating assistant message, if available. */
  timestamp: number | undefined
  /** Short summary of the tool output for the tooltip/expand line. */
  summary: string | undefined
}

/**
 * How many trailing messages to inspect. Validation commands are recent by
 * nature; scanning the whole transcript would be wasteful on long sessions.
 * 200 covers >10 back-and-forth turns comfortably.
 */
const SCAN_WINDOW = 200

/**
 * Command-prefix patterns that classify a bash command into a bucket. Order
 * matters — more specific patterns (e.g. `tsc`) come before generic runners
 * that could match them (e.g. `npm run` which needs subscript inspection).
 *
 * These run against the *executable chain* — we concat the bash command with
 * any subcommand tokens so `npm run lint` matches the lint bucket via the
 * generic `\blint\b` word-match, not just `npm run`.
 */
const CLASSIFIERS: ReadonlyArray<{
  kind: ValidationKind
  re: RegExp
}> = [
  // Typecheck — must come before `test` because `bun test` vs `tsc` overlap.
  {
    kind: 'typecheck',
    re: /\b(tsc|tsgo|pyright|mypy|flow\s+check|deno\s+check|cargo\s+check|go\s+vet|tsd)\b|\btypecheck\b|\btype-check\b/,
  },
  // Lint — eslint/biome/ruff/golangci/clippy and common script names.
  {
    kind: 'lint',
    re: /\b(eslint|oxlint|biome(?:\s+(?:check|lint|ci))?|prettier(?:\s+--check)?|ruff(?:\s+check)?|flake8|pylint|golangci-lint|clippy|shellcheck|stylelint)\b|\blint\b/,
  },
  // Test — common runners plus a `test` script name.
  {
    kind: 'test',
    re: /\b(vitest(?:\s+run)?|jest|mocha|ava|playwright(?:\s+test)?|pytest|phpunit|go\s+test|cargo\s+test|bun\s+test|deno\s+test|rspec|tap|tape|node\s+--test)\b|\btest\b/,
  },
  // Build — compile/bundle/deploy adjacent commands.
  {
    kind: 'build',
    re: /\b(webpack|rollup|vite\s+build|esbuild|tsup|turbo\s+build|nx\s+build|bazel\s+build|cargo\s+build|go\s+build|make(?:\s+build)?|ninja|gradle(?:w)?\s+build|mvn\s+(?:compile|install|package))\b|\bbuild\b/,
  },
]

/**
 * Classify a bash command string into a validation kind, or null if none.
 * Exported for tests.
 */
export function classifyCommand(command: string): ValidationKind | null {
  // Normalize shell meta — we only care about the first executable chain, but
  // `&&`-chains can stack (e.g. `pnpm i && pnpm typecheck`). Split on &&/;/||
  // and classify the LAST segment, which is usually the meaningful action.
  const segments = command
    .split(/&&|\|\||;/)
    .map(s => s.trim())
    .filter(Boolean)
  const target = segments[segments.length - 1] ?? command
  for (const { kind, re } of CLASSIFIERS) {
    if (re.test(target)) return kind
  }
  return null
}

/**
 * Heuristic: did the tool_result indicate failure? We inspect:
 *   • toolUseResult.exitCode !== 0 / is_error=true
 *   • common error markers in the text content
 *
 * Returns 'pass' when we have a result but no failure signal.
 */
function classifyResultState(msg: Message): 'pass' | 'fail' {
  const tur = msg.toolUseResult
  if (tur && typeof tur === 'object') {
    if (typeof tur.exitCode === 'number' && tur.exitCode !== 0) return 'fail'
    if (tur.is_error === true) return 'fail'
    if (typeof tur.interrupted === 'boolean' && tur.interrupted) return 'fail'
  }
  const content = msg.message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_result' &&
        block.is_error === true
      ) {
        return 'fail'
      }
    }
  }
  return 'pass'
}

/**
 * Extract a short summary line from a tool_result for display, capped to ~80
 * chars. Prefers stderr (failures usually write there) then stdout.
 */
function extractSummary(msg: Message): string | undefined {
  const tur = msg.toolUseResult
  let raw: string | undefined
  if (tur && typeof tur === 'object') {
    if (typeof tur.stderr === 'string' && tur.stderr.trim()) raw = tur.stderr
    else if (typeof tur.stdout === 'string' && tur.stdout.trim())
      raw = tur.stdout
  }
  if (!raw) {
    const content = msg.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          block.type === 'tool_result'
        ) {
          if (typeof block.content === 'string') {
            raw = block.content
            break
          }
          if (Array.isArray(block.content)) {
            const first = block.content.find(
              (c: { type?: string; text?: string }) =>
                c?.type === 'text' && typeof c.text === 'string',
            )
            if (first?.text) {
              raw = first.text
              break
            }
          }
        }
      }
    }
  }
  if (!raw) return undefined
  const firstLine = raw.split('\n').find(l => l.trim().length > 0) ?? ''
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine
}

/**
 * Find the tool_use blocks inside an assistant message's content array,
 * returning tuples of (block, name, id, input.command?).
 */
function* iterToolUses(
  msg: Message,
): Generator<{ id: string; name: string; command: string | undefined }> {
  if (msg.type !== 'assistant') return
  const content = msg.message?.content
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      block.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      const input = block.input as Record<string, unknown> | undefined
      const command =
        typeof input?.command === 'string' ? input.command : undefined
      yield { id: block.id, name: block.name, command }
    }
  }
}

/**
 * Find the tool_use_ids handled by a tool_result user message.
 */
function toolResultIdsOf(msg: Message): ReadonlySet<string> {
  if (msg.type !== 'user') return EMPTY_SET
  const content = msg.message?.content
  if (!Array.isArray(content)) return EMPTY_SET
  const out = new Set<string>()
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      block.type === 'tool_result' &&
      typeof block.tool_use_id === 'string'
    ) {
      out.add(block.tool_use_id)
    }
  }
  return out
}
const EMPTY_SET: ReadonlySet<string> = new Set()

/**
 * Truncate a command for display in the HUD. We want to preserve the tail
 * (where the meaningful subcommand lives, e.g. `npm run lint`) over the head.
 */
export function truncateCommand(cmd: string, max = 48): string {
  const collapsed = cmd.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `...${collapsed.slice(collapsed.length - (max - 3))}`
}

/**
 * Derive the latest ValidationRecord from a transcript.
 *
 * Algorithm:
 *   1. Walk backward from the end of messages (limited by SCAN_WINDOW) looking
 *      for assistant messages with a Bash tool_use whose command classifies
 *      into one of our buckets.
 *   2. Once found, walk FORWARD from that index looking for the tool_result
 *      user message carrying the matching tool_use_id.
 *   3. If no result found, the state is 'running'.
 *
 * We return only the most-recent validation; stale runs aren't interesting
 * for a sticky dashboard (user can scroll for history).
 */
export function getLatestValidation(
  messages: readonly Message[],
): ValidationRecord | null {
  const [latest] = getAllValidations(messages, { limit: 1 })
  return latest ?? null
}

/**
 * Derive ALL validation runs from the transcript, most-recent first.
 *
 * Same classification as {@link getLatestValidation}; each assistant
 * tool_use whose Bash command matches a validation pattern yields one
 * ValidationRecord. Records are emitted in reverse chronological order so
 * the first element is the most recent run (matching HUD expectations).
 */
export function getAllValidations(
  messages: readonly Message[],
  { limit = 20 }: { limit?: number } = {},
): ValidationRecord[] {
  if (messages.length === 0) return []
  const end = messages.length
  const start = Math.max(0, end - SCAN_WINDOW)
  const out: ValidationRecord[] = []
  for (let i = end - 1; i >= start; i--) {
    const msg = messages[i]
    if (!msg || msg.type !== 'assistant') continue
    for (const tu of iterToolUses(msg)) {
      if (tu.name !== BASH_TOOL_NAME || !tu.command) continue
      const kind = classifyCommand(tu.command)
      if (!kind) continue
      let resultMsg: Message | undefined
      for (let j = i + 1; j < end; j++) {
        const candidate = messages[j]
        if (!candidate) continue
        if (toolResultIdsOf(candidate).has(tu.id)) {
          resultMsg = candidate
          break
        }
      }
      out.push({
        kind,
        state: resultMsg ? classifyResultState(resultMsg) : 'running',
        command: truncateCommand(tu.command),
        toolUseUuid: msg.uuid,
        toolResultUuid: resultMsg?.uuid,
        timestamp:
          typeof msg.timestamp === 'number'
            ? msg.timestamp
            : typeof msg.timestamp === 'string'
              ? Date.parse(msg.timestamp) || undefined
              : undefined,
        summary: resultMsg ? extractSummary(resultMsg) : undefined,
      })
      if (out.length >= limit) return out
    }
  }
  return out
}
