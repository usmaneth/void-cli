/**
 * Auto session compaction + auto-generated summaries.
 *
 * Lightweight manager that sits on top of the PR #58 SessionManager:
 *   - counts tokens per session (chars/4, unless gpt-tokenizer is available)
 *   - triggers summarisation when tokens > threshold at assistant-turn end
 *   - re-summarises every N new messages after the first compaction
 *   - preserves the last K messages verbatim
 *   - persists the summary via SessionManager.applyCompaction()
 *   - supports rollback (stash is owned by SessionStore)
 *
 * The provider call is injected so the entry point can plug in the active
 * provider (Anthropic / OpenAI shim / Gemini) without this module taking a
 * dependency on any specific SDK. Tests inject a mock.
 */

import type { SessionManager, SessionMessage } from './index.js'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AutoCompactionSettings {
  /** Master switch. */
  auto: boolean
  /** Token threshold above which auto-compaction runs. */
  threshold: number
  /** Number of recent messages to preserve verbatim (not summarised). */
  preserveRecent: number
  /** Re-summarise every N new messages once a summary already exists. */
  resummarizeEvery: number
}

export const DEFAULT_SETTINGS: AutoCompactionSettings = {
  auto: true,
  threshold: 32_000,
  preserveRecent: 8,
  resummarizeEvery: 20,
}

/**
 * Resolve settings from a raw config bag. Honours the
 * `compaction.{auto,threshold,preserveRecent,resummarizeEvery}` keys, as
 * specified in the task. Env/flag overrides are applied on top:
 *   - VOID_AUTO_COMPACT=1  → force auto=true
 *   - VOID_AUTO_COMPACT=0  → force auto=false
 */
export function resolveSettings(
  raw?: Partial<AutoCompactionSettings> | Record<string, unknown> | null,
  env: NodeJS.ProcessEnv = process.env,
): AutoCompactionSettings {
  const s = { ...DEFAULT_SETTINGS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    // Flat keys
    if (typeof r.auto === 'boolean') s.auto = r.auto
    if (typeof r.threshold === 'number' && r.threshold > 0) s.threshold = r.threshold
    if (typeof r.preserveRecent === 'number' && r.preserveRecent >= 0) {
      s.preserveRecent = Math.floor(r.preserveRecent)
    }
    if (typeof r.resummarizeEvery === 'number' && r.resummarizeEvery > 0) {
      s.resummarizeEvery = Math.floor(r.resummarizeEvery)
    }
    // Dotted keys (compaction.auto etc.) — also tolerated.
    const dotted = r as Record<string, unknown>
    if (typeof dotted['compaction.auto'] === 'boolean')
      s.auto = dotted['compaction.auto'] as boolean
    if (typeof dotted['compaction.threshold'] === 'number')
      s.threshold = dotted['compaction.threshold'] as number
    if (typeof dotted['compaction.preserveRecent'] === 'number')
      s.preserveRecent = dotted['compaction.preserveRecent'] as number
    if (typeof dotted['compaction.resummarizeEvery'] === 'number')
      s.resummarizeEvery = dotted['compaction.resummarizeEvery'] as number
    // Nested { compaction: { ... } }
    if (r.compaction && typeof r.compaction === 'object') {
      const c = r.compaction as Record<string, unknown>
      if (typeof c.auto === 'boolean') s.auto = c.auto
      if (typeof c.threshold === 'number' && c.threshold > 0) s.threshold = c.threshold
      if (typeof c.preserveRecent === 'number' && c.preserveRecent >= 0)
        s.preserveRecent = Math.floor(c.preserveRecent)
      if (typeof c.resummarizeEvery === 'number' && c.resummarizeEvery > 0)
        s.resummarizeEvery = Math.floor(c.resummarizeEvery)
    }
  }

  const flag = env.VOID_AUTO_COMPACT
  if (flag === '1' || flag === 'true') s.auto = true
  if (flag === '0' || flag === 'false') s.auto = false
  return s
}

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

type TokenizerFn = (text: string) => number

/** Cached tokenizer; resolved lazily the first time `countTokens` runs. */
let cachedTokenizer: TokenizerFn | null = null

/** Reset the cached tokenizer — used by tests to force re-resolution. */
export function __resetTokenizerForTests(): void {
  cachedTokenizer = null
}

/**
 * Resolve the cheapest available tokenizer:
 *   1. `gpt-tokenizer` (cheap, pure-JS)
 *   2. chars/4 fallback (very cheap, always available)
 *
 * `gpt-tokenizer` is an optional dependency; if not installed we silently
 * fall back. The chars/4 estimate is good enough for threshold-based
 * triggers — we're comparing against 32k, not billing.
 */
function getTokenizer(): TokenizerFn {
  if (cachedTokenizer) return cachedTokenizer
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('gpt-tokenizer')
    const encode = mod?.encode ?? mod?.default?.encode
    if (typeof encode === 'function') {
      cachedTokenizer = (text: string) => encode(text).length
      return cachedTokenizer
    }
  } catch {
    // gpt-tokenizer not installed — fall through to chars/4.
  }
  cachedTokenizer = (text: string) => Math.ceil(text.length / 4)
  return cachedTokenizer
}

/** Token count for a single string. */
export function countTokens(text: string): number {
  if (!text) return 0
  return getTokenizer()(text)
}

/** Token count for an array of session messages. */
export function countMessageTokens(messages: readonly SessionMessage[]): number {
  let total = 0
  const tok = getTokenizer()
  for (const m of messages) {
    total += tok(m.content)
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += tok(tc.name) + tok(tc.result)
      }
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

/**
 * Abstracted provider callback — returns the compaction summary text.
 *
 * Real callers pass an implementation backed by the active provider
 * (Anthropic / OpenAI shim / Gemini). Tests pass a mock.
 */
export type SummaryProvider = (params: {
  messages: SessionMessage[]
  instructions: string
  signal?: AbortSignal
}) => Promise<string>

const SUMMARY_INSTRUCTIONS = [
  'You are compacting a long coding session for Void CLI.',
  'Write a concise summary that preserves:',
  '  1. What the user was trying to accomplish.',
  '  2. Key decisions and the reasoning behind them.',
  '  3. Files/areas that were touched and their current state.',
  '  4. Open problems, blockers, and next steps.',
  'Start with a single descriptive title line (<80 chars, no markdown).',
  'Then a blank line, then the bullet summary. Keep under 500 words.',
].join('\n')

// ---------------------------------------------------------------------------
// AutoCompactionManager
// ---------------------------------------------------------------------------

export type CompactionTrigger = 'threshold' | 'periodic' | 'manual'

export interface CompactionOutcome {
  ran: boolean
  trigger?: CompactionTrigger
  tokensBefore?: number
  tokensAfter?: number
  summary?: string
  reason?: string
}

export interface AutoCompactionManagerOptions {
  settings?: Partial<AutoCompactionSettings>
  /** Used by tests to stub the summary generation. */
  provider: SummaryProvider
  /** Used by tests; pass a function that returns current env. */
  env?: NodeJS.ProcessEnv
}

/**
 * Stateful manager per session. Call `onAssistantTurnEnd(sessionManager)`
 * after each assistant turn completes to let the manager decide whether
 * to compact.
 */
export class AutoCompactionManager {
  readonly settings: AutoCompactionSettings
  private readonly provider: SummaryProvider
  /** True while a compaction is in-flight — prevents re-entry. */
  private running = false
  /** True while an assistant turn is still streaming. */
  private midTurn = false

  constructor(opts: AutoCompactionManagerOptions) {
    this.settings = resolveSettings(opts.settings ?? null, opts.env)
    this.provider = opts.provider
  }

  /** Call when the assistant begins a response (suppresses compaction). */
  beginAssistantTurn(): void {
    this.midTurn = true
  }

  /** Call when an assistant response finishes — triggers eligibility check. */
  endAssistantTurn(): void {
    this.midTurn = false
  }

  /** Whether a compaction is currently running (for UI/status). */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Evaluate the session and compact if warranted. Safe to call at any
   * time — bails if auto is off, a turn is in-flight, or tokens are below
   * the threshold and no periodic re-summarise is due.
   */
  async maybeCompact(
    manager: SessionManager,
    opts: { force?: boolean; trigger?: CompactionTrigger; signal?: AbortSignal } = {},
  ): Promise<CompactionOutcome> {
    if (this.running) return { ran: false, reason: 'already-running' }
    if (!this.settings.auto && !opts.force) return { ran: false, reason: 'auto-disabled' }
    if (this.midTurn && !opts.force) return { ran: false, reason: 'mid-turn' }

    const messages = manager.getMessages()
    if (messages.length === 0) return { ran: false, reason: 'empty' }

    const tokensBefore = countMessageTokens(messages)
    const currentSession = manager.currentSession
    const summarisedAt = currentSession?.summarizedMessageCount ?? 0
    const newMessagesSinceSummary = messages.length - summarisedAt
    const hasExistingSummary = Boolean(currentSession?.summary)

    let trigger: CompactionTrigger | null = opts.trigger ?? null
    if (!trigger) {
      if (tokensBefore > this.settings.threshold) trigger = 'threshold'
      else if (
        hasExistingSummary &&
        newMessagesSinceSummary >= this.settings.resummarizeEvery
      ) {
        trigger = 'periodic'
      }
    }

    if (!trigger && !opts.force) return { ran: false, reason: 'below-threshold', tokensBefore }

    // Idempotence guard: nothing new since last compaction → no-op.
    if (newMessagesSinceSummary <= this.settings.preserveRecent && !opts.force) {
      return { ran: false, reason: 'nothing-new', tokensBefore }
    }

    this.running = true
    try {
      const recent = messages.slice(-this.settings.preserveRecent)
      const older = messages.slice(0, Math.max(0, messages.length - this.settings.preserveRecent))
      // When re-summarising, prepend the existing summary so the model can
      // build on it instead of starting from scratch.
      const existing = currentSession?.summary
      const toSummarise: SessionMessage[] = existing
        ? [
            {
              role: 'system',
              content: `Previous summary:\n${existing}`,
              timestamp: Date.now(),
            },
            ...older,
          ]
        : older

      if (toSummarise.length === 0 && !opts.force) {
        return { ran: false, reason: 'nothing-to-summarise', tokensBefore }
      }

      const summary = await this.provider({
        messages: toSummarise,
        instructions: SUMMARY_INSTRUCTIONS,
        signal: opts.signal,
      })
      if (!summary || !summary.trim()) {
        return { ran: false, reason: 'empty-summary', tokensBefore }
      }

      manager.applyCompaction({
        summary: summary.trim(),
        preservedRecent: recent,
        summarizedMessageCount: messages.length,
      })

      const tokensAfter = countMessageTokens(manager.getMessages())
      return {
        ran: true,
        trigger: trigger ?? 'manual',
        tokensBefore,
        tokensAfter,
        summary: summary.trim(),
      }
    } finally {
      this.running = false
    }
  }
}
