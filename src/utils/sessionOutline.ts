/**
 * Session outline — compact milestone extraction for the current transcript.
 *
 * Produces an ordered list of "milestones" summarizing what happened in the
 * session: user prompts, tool activity (with emphasis on file edits, shell
 * commands, and validation-like commands), failures, and approval/permission
 * events.
 *
 * Designed to be fed from the SAME normalized message pipeline that
 * Messages.tsx consumes — we do not re-parse raw transcripts. Collapsed
 * pseudo-messages (grouped tool uses, collapsed read/search, etc.) are
 * expanded into their constituent tool uses so the outline reflects the real
 * timeline of operations, not the compressed UI rendering.
 *
 * Shape is deliberately loose (all optional, typed narrowly only where
 * necessary) to match the project's loose message types.
 */

import { getPalette } from '../theme/index.js'

export type MilestoneKind =
  | 'user_prompt'
  | 'user_command' // slash-command
  | 'assistant_text'
  | 'tool_use'
  | 'file_edit'
  | 'file_write'
  | 'file_read'
  | 'shell_command'
  | 'validation'
  | 'search'
  | 'failure'
  | 'approval'
  | 'compact_boundary'

export type Milestone = {
  /** Index into the normalized messages array the milestone originated from.
   *  Used by the UI to jump/scroll back into the transcript. */
  messageIndex: number
  /** Stable uuid of the source message (same as messages[messageIndex].uuid)
   *  — lets consumers resolve to a DOM anchor even if indices shift. */
  uuid?: string
  kind: MilestoneKind
  /** Single-line human summary. Already trimmed/clipped. */
  label: string
  /** Optional secondary label (e.g. file path for edits). */
  detail?: string
  /** Timestamp when available (ISO or epoch ms; unparsed — display-only). */
  timestamp?: string | number
  /** Tool name for tool-derived milestones. */
  toolName?: string
  /** True if this milestone represents a failure / error / rejection. */
  isError?: boolean
  /** True if this milestone represents an approval/permission decision. */
  isApproval?: boolean
}

/** Crude heuristic: command looks like a validation/build/test invocation
 *  (tsc, vitest, npm test, pnpm check, cargo check, go test, ruff, eslint…).
 *  Matches the start of the command line OR a word after common prefixes
 *  (npm run, pnpm, yarn, bun run, npx, python -m, etc.). */
const VALIDATION_PATTERNS: RegExp[] = [
  /\b(?:tsc|typecheck|ts-node)\b/i,
  /\b(?:vitest|jest|mocha|pytest|unittest|rspec|phpunit|go test|cargo test)\b/i,
  /\b(?:eslint|oxlint|biome|ruff|flake8|pylint|mypy|pyright)\b/i,
  /\b(?:prettier|black|rustfmt|gofmt)\b/i,
  /\b(?:cargo (?:check|build|clippy)|go (?:build|vet))\b/i,
  /\b(?:make(?:\s+\S+)?|ninja|cmake --build)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|build|typecheck|ci)\b/i,
  /\bplaywright\b/i,
]

const TRUNCATE_LEN = 80

function truncate(s: string, n: number = TRUNCATE_LEN): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= n) return trimmed
  return trimmed.slice(0, n - 1).trimEnd() + '…'
}

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

function isValidationCommand(cmd: string): boolean {
  return VALIDATION_PATTERNS.some(re => re.test(cmd))
}

/** Extract plain text from an assistant/user content block array, joining
 *  only text blocks. Tool uses/results are handled separately. */
function extractText(
  content: unknown,
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && (block as any).type === 'text') {
      const t = (block as any).text
      if (typeof t === 'string') parts.push(t)
    }
  }
  return parts.join('\n')
}

/** Short human label for a tool_use block, based on the primary input field. */
function describeToolUse(name: string, input: unknown): {
  kind: MilestoneKind
  label: string
  detail?: string
} {
  const o = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {}
  const lower = name.toLowerCase()

  // File edit / write / read
  if (
    lower.includes('edit') ||
    lower === 'multiedit' ||
    lower === 'fileedittool' ||
    lower === 'multiedittool'
  ) {
    const file = typeof o.file_path === 'string' ? o.file_path : typeof o.path === 'string' ? o.path : ''
    return {
      kind: 'file_edit',
      label: `Edit ${truncate(basename(file), 50)}`,
      detail: file || undefined,
    }
  }
  if (lower.includes('write') || lower === 'filewritetool') {
    const file = typeof o.file_path === 'string' ? o.file_path : ''
    return {
      kind: 'file_write',
      label: `Write ${truncate(basename(file), 50)}`,
      detail: file || undefined,
    }
  }
  if (lower.includes('read') || lower === 'filereadtool' || lower === 'notebookread') {
    const file = typeof o.file_path === 'string' ? o.file_path : ''
    return {
      kind: 'file_read',
      label: `Read ${truncate(basename(file), 50)}`,
      detail: file || undefined,
    }
  }

  // Shell
  if (lower === 'bash' || lower === 'bashtool' || lower === 'powershell' || lower === 'shell') {
    const cmd = typeof o.command === 'string' ? firstLine(o.command) : ''
    const desc = typeof o.description === 'string' ? o.description : ''
    if (cmd && isValidationCommand(cmd)) {
      return {
        kind: 'validation',
        label: `Validate: ${truncate(desc || cmd, 64)}`,
        detail: cmd ? truncate(cmd, 120) : undefined,
      }
    }
    return {
      kind: 'shell_command',
      label: desc ? truncate(desc, 60) : truncate(cmd || 'shell', 60),
      detail: cmd ? truncate(cmd, 120) : undefined,
    }
  }

  // Search-like
  if (lower === 'grep' || lower === 'greptool' || lower === 'glob' || lower === 'globtool') {
    const pattern = typeof o.pattern === 'string' ? o.pattern : ''
    return {
      kind: 'search',
      label: `${lower === 'grep' || lower === 'greptool' ? 'Grep' : 'Glob'} ${truncate(pattern, 50)}`,
    }
  }

  // Agent / MCP / generic
  const primary =
    (typeof o.prompt === 'string' && o.prompt) ||
    (typeof o.description === 'string' && o.description) ||
    (typeof o.query === 'string' && o.query) ||
    (typeof o.url === 'string' && o.url) ||
    ''
  return {
    kind: 'tool_use',
    label: primary ? `${name}: ${truncate(String(primary), 60)}` : name,
  }
}

function basename(p: string): string {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i === -1 ? p : p.slice(i + 1)
}

/** Shallow inspection of a tool result for common error signals. Mirrors the
 *  duck-typing used in transcriptSearch.ts — known fields only, no blind walk. */
function toolResultIsError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  if (r.is_error === true || r.isError === true || r.error === true) return true
  if (typeof r.error === 'string' && r.error.length > 0) return true
  if (typeof r.stderr === 'string' && r.stderr.length > 0 && r.stdout == null) {
    return true
  }
  if (typeof r.exitCode === 'number' && r.exitCode !== 0) return true
  return false
}

function resultErrorSnippet(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const r = result as Record<string, unknown>
  if (typeof r.error === 'string' && r.error) return firstLine(r.error)
  if (typeof r.stderr === 'string' && r.stderr) return firstLine(r.stderr)
  if (typeof r.message === 'string' && r.message) return firstLine(r.message)
  return undefined
}

/** Detect the user-command slash wrapper (e.g. <command-name>/commit</command-name>
 *  <command-args>foo bar</command-args>). Mirrors messages.ts::textForResubmit. */
function extractSlashCommand(raw: string): { cmd: string; args: string } | null {
  const nameMatch = raw.match(/<command-name>([\s\S]*?)<\/command-name>/)
  if (!nameMatch) return null
  const argsMatch = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)
  return {
    cmd: nameMatch[1]?.trim() ?? '',
    args: argsMatch?.[1]?.trim() ?? '',
  }
}

/** Internal: Does this user message carry a real prompt (vs. tool_result only /
 *  interruption / hook content / system-reminder)? */
function userMessageIsPrompt(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const t = (block as any).type
    if (t === 'text') {
      const text = (block as any).text
      if (typeof text === 'string' && text.trim().length > 0) return true
    }
  }
  return false
}

/**
 * Build a milestone list from a flat messages[] array. Order is preserved.
 *
 * The input can be either raw `Message[]` or `NormalizedMessage[]` — the
 * function duck-types on `message.type` and `message.content` shapes, so it
 * tolerates both. Collapsed pseudo-types ('collapsed_read_search',
 * 'grouped_tool_use') are optionally expanded via the callback.
 */
export function buildSessionOutline(
  messages: readonly unknown[],
  options: {
    /** Optional hook to pull original tool uses out of collapsed groups.
     *  If not supplied, collapsed groups contribute one summary milestone
     *  each. */
    expandCollapsed?: (msg: unknown) => unknown[] | undefined
    /** Max number of milestones in the output. Newest kept. Default 200. */
    limit?: number
  } = {},
): Milestone[] {
  const limit = options.limit ?? 200
  const out: Milestone[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as any
    if (!msg || typeof msg !== 'object') continue

    const type: string | undefined = msg.type
    const uuid: string | undefined = msg.uuid
    const timestamp: string | number | undefined = msg.timestamp

    // Compact / summary boundaries
    if (
      type === 'system' &&
      (msg.subtype === 'compact_boundary' || msg.subtype === 'microcompact_boundary')
    ) {
      out.push({
        messageIndex: i,
        uuid,
        kind: 'compact_boundary',
        label: msg.subtype === 'microcompact_boundary' ? 'Micro-compact' : 'Compacted',
        timestamp,
      })
      continue
    }

    if (type === 'user') {
      const content = msg.message?.content
      const rawText = extractText(content)

      // tool_result inside a user message
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && (block as any).type === 'tool_result') {
            const isError = toolResultIsError(msg.toolUseResult) || (block as any).is_error === true
            if (isError) {
              const snippet =
                resultErrorSnippet(msg.toolUseResult) ??
                firstLine(extractText((block as any).content))
              out.push({
                messageIndex: i,
                uuid,
                kind: 'failure',
                label: `Tool error${snippet ? `: ${truncate(snippet, 70)}` : ''}`,
                timestamp,
                isError: true,
              })
            }
          }
        }
      }

      // User prompt / slash command
      if (userMessageIsPrompt(content) && !msg.isMeta && !msg.isVirtual) {
        const slash = extractSlashCommand(rawText)
        if (slash) {
          out.push({
            messageIndex: i,
            uuid,
            kind: 'user_command',
            label: `/${slash.cmd}${slash.args ? ' ' + truncate(slash.args, 60) : ''}`,
            timestamp,
          })
        } else {
          // Strip IDE tags and system reminders before previewing.
          const stripped = rawText
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
            .replace(/<ide-[a-z-]+>[\s\S]*?<\/ide-[a-z-]+>/g, '')
            .trim()
          if (stripped) {
            out.push({
              messageIndex: i,
              uuid,
              kind: 'user_prompt',
              label: truncate(firstLine(stripped), TRUNCATE_LEN),
              timestamp,
            })
          }
        }
      }

      // Permission decisions surface as user messages carrying an origin or
      // a specific content tag — stay duck-typed.
      if (msg.origin && typeof msg.origin === 'object') {
        const origin = msg.origin as Record<string, unknown>
        if (origin.type === 'permission_decision' || origin.type === 'approval') {
          out.push({
            messageIndex: i,
            uuid,
            kind: 'approval',
            label: `Approval: ${truncate(String((origin as any).decision ?? 'recorded'), 40)}`,
            timestamp,
            isApproval: true,
          })
        }
      }
      continue
    }

    if (type === 'assistant') {
      const content = msg.message?.content
      if (!Array.isArray(content)) {
        if (msg.isApiErrorMessage || msg.apiError || msg.error) {
          out.push({
            messageIndex: i,
            uuid,
            kind: 'failure',
            label: 'API error',
            detail: typeof msg.errorDetails === 'string' ? msg.errorDetails : undefined,
            timestamp,
            isError: true,
          })
        }
        continue
      }
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const bt = (block as any).type
        if (bt === 'tool_use') {
          const { kind, label, detail } = describeToolUse(
            String((block as any).name ?? 'tool'),
            (block as any).input,
          )
          out.push({
            messageIndex: i,
            uuid,
            kind,
            label,
            detail,
            toolName: String((block as any).name ?? ''),
            timestamp,
          })
        }
      }
      // API error flag on the assistant envelope
      if (msg.isApiErrorMessage || msg.apiError) {
        out.push({
          messageIndex: i,
          uuid,
          kind: 'failure',
          label: 'API error',
          detail: typeof msg.errorDetails === 'string' ? msg.errorDetails : undefined,
          timestamp,
          isError: true,
        })
      }
      continue
    }

    // Grouped/collapsed wrappers: expand via caller-provided hook so we see
    // the underlying tool uses. Without a hook, emit a single summary.
    if (type === 'grouped_tool_use' || type === 'collapsed_read_search') {
      const expanded = options.expandCollapsed?.(msg)
      if (expanded && expanded.length > 0) {
        const nested = buildSessionOutline(expanded, options)
        for (const n of nested) out.push({ ...n, messageIndex: i, uuid })
      } else {
        out.push({
          messageIndex: i,
          uuid,
          kind: type === 'collapsed_read_search' ? 'file_read' : 'tool_use',
          label:
            type === 'collapsed_read_search'
              ? `Read/search group (${Array.isArray(msg.children) ? msg.children.length : '?'})`
              : `Grouped tools (${Array.isArray(msg.children) ? msg.children.length : '?'})`,
          timestamp,
        })
      }
      continue
    }

    // System messages: surface errors + API-errors as failures.
    if (type === 'system' && (msg.level === 'error' || msg.subtype === 'api_error')) {
      const snippet =
        typeof msg.text === 'string'
          ? msg.text
          : typeof msg.message === 'string'
            ? msg.message
            : ''
      out.push({
        messageIndex: i,
        uuid,
        kind: 'failure',
        label: snippet ? truncate(firstLine(snippet), 70) : 'System error',
        timestamp,
        isError: true,
      })
      continue
    }
  }

  if (out.length > limit) {
    // Prefer newest — UI scrolls to end anyway.
    return out.slice(out.length - limit)
  }
  return out
}

/** Lightweight marker/glyph for UI rendering. Plain ASCII so it stays legible
 *  under all terminal themes and fonts. */
export function milestoneMarker(kind: MilestoneKind): string {
  switch (kind) {
    case 'user_prompt':
      return '>'
    case 'user_command':
      return '/'
    case 'assistant_text':
      return '*'
    case 'file_edit':
      return 'E'
    case 'file_write':
      return 'W'
    case 'file_read':
      return 'R'
    case 'shell_command':
      return '$'
    case 'validation':
      return 'V'
    case 'search':
      return '?'
    case 'failure':
      return '!'
    case 'approval':
      return '+'
    case 'compact_boundary':
      return '-'
    case 'tool_use':
    default:
      return '.'
  }
}

/**
 * Return a palette-sourced hex color for a milestone kind, suitable for
 * passing to `<Text color={...}>` in Ink. Returns `undefined` for kinds
 * that should render in the default text color.
 *
 * The mapping is theme-aware: it pulls hex values from the active palette
 * via `getPalette()` so the outline follows the user's theme. Previous
 * behavior used hardcoded Ink-named colors (e.g. 'red', 'cyan'); the named
 * tokens are recorded inline as legacy reference.
 */
export function milestoneColor(kind: MilestoneKind): string | undefined {
  const p = getPalette()
  switch (kind) {
    case 'failure':
      // legacy: 'red'
      return p.state.failure
    case 'validation':
      // legacy: 'yellow'
      return p.state.warning
    case 'approval':
      // legacy: 'green'
      return p.state.success
    case 'user_prompt':
    case 'user_command':
      // legacy: 'cyan' — user role accent
      return p.role.you
    case 'file_edit':
    case 'file_write':
      // legacy: 'magenta' — write-action accent
      return p.role.voidWrite
    case 'search':
    case 'file_read':
      // legacy: 'blue' — read/prose accent
      return p.role.voidProse
    case 'compact_boundary':
      // legacy: 'gray'
      return p.text.dim
    default:
      return undefined
  }
}
