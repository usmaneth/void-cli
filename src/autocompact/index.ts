/**
 * Auto-compact context window management system.
 *
 * Provides token tracking, threshold-based warnings, and automatic
 * conversation compaction to keep sessions within context limits.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextTrackerOptions {
  /** Fraction of maxContextTokens at which to emit a warning (default 0.80). */
  warnAt?: number
  /** Fraction of maxContextTokens at which to trigger compaction (default 0.90). */
  compactAt?: number
  /** Maximum context window size in tokens (default 200_000 for Claude). */
  maxContextTokens?: number
}

export interface ContextTrackerCallbacks {
  /** Fired when cumulative usage crosses the warn threshold. */
  onWarn?: (percent: number) => void
  /** Fired when cumulative usage crosses the compact threshold. */
  onCompact?: (percent: number) => void
}

export type UsageLevel = 'ok' | 'warn' | 'critical'

export interface AutoCompactStatus {
  tokensUsed: number
  maxTokens: number
  percent: number
  level: UsageLevel
}

export interface SimpleMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AutoCompactManagerOptions {
  maxTokens?: number
  warnThreshold?: number
  compactThreshold?: number
  onWarn?: (percent: number) => void
  onCompact?: (percent: number) => void
  onSummaryReady?: (summary: string) => void
}

// ---------------------------------------------------------------------------
// ContextTracker
// ---------------------------------------------------------------------------

/**
 * Tracks cumulative token usage across conversation turns and fires
 * callbacks when configurable thresholds are exceeded.
 */
export class ContextTracker {
  private inputTokens = 0
  private outputTokens = 0
  private readonly warnAt: number
  private readonly compactAt: number
  private readonly maxContextTokens: number
  private callbacks: ContextTrackerCallbacks = {}

  /** Whether the warn callback has already been fired for this cycle. */
  private warnFired = false
  /** Whether the compact callback has already been fired for this cycle. */
  private compactFired = false

  constructor(
    options: ContextTrackerOptions = {},
    callbacks: ContextTrackerCallbacks = {},
  ) {
    this.warnAt = options.warnAt ?? 0.8
    this.compactAt = options.compactAt ?? 0.9
    this.maxContextTokens = options.maxContextTokens ?? 200_000
    this.callbacks = callbacks
  }

  /** Register or replace event callbacks. */
  setCallbacks(callbacks: ContextTrackerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /** Record token usage for a single conversation turn. */
  addUsage(input: number, output: number): void {
    this.inputTokens += input
    this.outputTokens += output

    const percent = this.getUsagePercent()

    if (!this.compactFired && this.shouldCompact()) {
      this.compactFired = true
      this.callbacks.onCompact?.(percent)
    } else if (!this.warnFired && this.shouldWarn()) {
      this.warnFired = true
      this.callbacks.onWarn?.(percent)
    }
  }

  /** Current cumulative usage as a fraction in [0, 1]. */
  getUsagePercent(): number {
    if (this.maxContextTokens <= 0) {
      return 0
    }
    const total = this.inputTokens + this.outputTokens
    return Math.min(total / this.maxContextTokens, 1)
  }

  /** True when usage is at or above the warn threshold. */
  shouldWarn(): boolean {
    return this.getUsagePercent() >= this.warnAt
  }

  /** True when usage is at or above the compact threshold. */
  shouldCompact(): boolean {
    return this.getUsagePercent() >= this.compactAt
  }

  /** Total tokens consumed so far. */
  getTotalTokens(): number {
    return this.inputTokens + this.outputTokens
  }

  /** Reset all counters. Typically called after a successful compaction. */
  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
    this.warnFired = false
    this.compactFired = false
  }
}

// ---------------------------------------------------------------------------
// compactConversation
// ---------------------------------------------------------------------------

/**
 * Produce a structured markdown summary from an array of conversation
 * messages. The summary is designed to preserve the information most
 * important for continuing a long-running coding session.
 *
 * This is a *local* summarisation pass -- it does not call an LLM. It
 * extracts signal heuristically so that the result can be injected as a
 * system-level context note or passed to a model for further refinement.
 */
export function compactConversation(messages: SimpleMessage[]): string {
  const keyDecisions: string[] = []
  const filesModified: string[] = []
  const taskStateLines: string[] = []
  const importantContext: string[] = []

  for (const msg of messages) {
    const { role, content } = msg

    // --- Key decisions (look for decision-indicating language) ---
    const decisionPatterns = [
      /(?:decided|chose|going with|will use|switched to|opted for)\s+(.+)/gi,
      /(?:the (?:approach|solution|fix|plan) is)\s+(.+)/gi,
    ]
    for (const pattern of decisionPatterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        const snippet = match[0].trim()
        if (snippet.length > 0 && snippet.length < 200) {
          keyDecisions.push(`[${role}] ${snippet}`)
        }
      }
    }

    // --- Files modified (common path patterns) ---
    const filePattern =
      /(?:(?:created|modified|edited|updated|wrote|read|deleted)\s+)?(?:`([^`]+\.[a-zA-Z]{1,10})`|(\S+\/\S+\.[a-zA-Z]{1,10}))/g
    let fileMatch: RegExpExecArray | null
    while ((fileMatch = filePattern.exec(content)) !== null) {
      const filePath = (fileMatch[1] || fileMatch[2] || '').trim()
      if (filePath && !filesModified.includes(filePath)) {
        filesModified.push(filePath)
      }
    }

    // --- Current task state (assistant messages near the end carry it) ---
    if (role === 'assistant') {
      const taskPatterns = [
        /(?:next step|todo|remaining|still need to|working on)\s*[:\-]\s*(.+)/gi,
        /(?:I(?:'ll| will) (?:now|next))\s+(.+)/gi,
      ]
      for (const pattern of taskPatterns) {
        let tMatch: RegExpExecArray | null
        while ((tMatch = pattern.exec(content)) !== null) {
          const snippet = tMatch[0].trim()
          if (snippet.length > 0 && snippet.length < 300) {
            taskStateLines.push(snippet)
          }
        }
      }
    }

    // --- Important context (user instructions tend to be important) ---
    if (role === 'user' && content.length > 20 && content.length < 2000) {
      importantContext.push(content)
    }
  }

  // Build the summary markdown
  const sections: string[] = []

  sections.push('# Conversation Summary')
  sections.push('')

  // Key decisions
  sections.push('## Key Decisions')
  if (keyDecisions.length > 0) {
    for (const d of keyDecisions.slice(-20)) {
      sections.push(`- ${d}`)
    }
  } else {
    sections.push('_No explicit decisions captured._')
  }
  sections.push('')

  // Files modified
  sections.push('## Files Modified')
  if (filesModified.length > 0) {
    for (const f of filesModified) {
      sections.push(`- \`${f}\``)
    }
  } else {
    sections.push('_No file modifications detected._')
  }
  sections.push('')

  // Current task state
  sections.push('## Current Task State')
  if (taskStateLines.length > 0) {
    // Show only the most recent task-state signals
    for (const t of taskStateLines.slice(-10)) {
      sections.push(`- ${t}`)
    }
  } else {
    sections.push('_No pending task state detected._')
  }
  sections.push('')

  // Important context
  sections.push('## Important Context')
  if (importantContext.length > 0) {
    // Keep only the last few user messages to avoid bloat
    const recent = importantContext.slice(-5)
    for (const ctx of recent) {
      // Truncate very long messages
      const truncated =
        ctx.length > 500 ? ctx.slice(0, 497) + '...' : ctx
      sections.push(`- ${truncated}`)
    }
  } else {
    sections.push('_No additional context captured._')
  }

  return sections.join('\n')
}

// ---------------------------------------------------------------------------
// AutoCompactManager
// ---------------------------------------------------------------------------

/**
 * High-level manager that ties token tracking to conversation compaction.
 *
 * Usage:
 * ```ts
 * const mgr = new AutoCompactManager({
 *   maxTokens: 200_000,
 *   warnThreshold: 0.80,
 *   compactThreshold: 0.90,
 *   onWarn: (pct) => console.warn(`Context ${(pct * 100).toFixed(0)}% full`),
 *   onCompact: (pct) => console.warn(`Compacting at ${(pct * 100).toFixed(0)}%`),
 *   onSummaryReady: (summary) => { /* inject into context *\/ },
 * })
 *
 * // After each model turn:
 * mgr.recordTurn(inputTokens, outputTokens)
 * ```
 */
export class AutoCompactManager {
  private tracker: ContextTracker
  private onSummaryReady?: (summary: string) => void

  constructor(options: AutoCompactManagerOptions = {}) {
    this.onSummaryReady = options.onSummaryReady

    this.tracker = new ContextTracker(
      {
        warnAt: options.warnThreshold ?? 0.8,
        compactAt: options.compactThreshold ?? 0.9,
        maxContextTokens: options.maxTokens ?? 200_000,
      },
      {
        onWarn: options.onWarn,
        onCompact: options.onCompact,
      },
    )
  }

  /**
   * Record token usage for one conversation turn and check thresholds.
   * Returns `true` if the compact threshold was reached.
   */
  recordTurn(inputTokens: number, outputTokens: number): boolean {
    this.tracker.addUsage(inputTokens, outputTokens)
    return this.tracker.shouldCompact()
  }

  /**
   * Generate a compact summary from the given messages and fire the
   * `onSummaryReady` callback with the result. Also resets the tracker.
   */
  generateSummary(messages: SimpleMessage[]): string {
    const summary = compactConversation(messages)
    this.tracker.reset()
    this.onSummaryReady?.(summary)
    return summary
  }

  /** Snapshot of current context usage and health level. */
  getStatus(): AutoCompactStatus {
    const percent = this.tracker.getUsagePercent()
    let level: UsageLevel = 'ok'
    if (this.tracker.shouldCompact()) {
      level = 'critical'
    } else if (this.tracker.shouldWarn()) {
      level = 'warn'
    }

    return {
      tokensUsed: this.tracker.getTotalTokens(),
      maxTokens:
        // Re-derive from percent to avoid exposing internals
        percent > 0
          ? Math.round(this.tracker.getTotalTokens() / percent)
          : (this.tracker as any).maxContextTokens ?? 200_000,
      percent,
      level,
    }
  }

  /** Update the compact threshold at runtime (fraction in [0, 1]). */
  setCompactThreshold(threshold: number): void {
    // We cannot mutate the readonly field on ContextTracker directly, so we
    // rebuild. This intentionally resets counters -- callers should treat
    // threshold changes as a fresh baseline.
    const status = this.getStatus()
    const maxTokens = status.maxTokens

    this.tracker = new ContextTracker(
      {
        maxContextTokens: maxTokens,
        compactAt: threshold,
        // Keep warn threshold 10 percentage-points below compact
        warnAt: Math.max(0, threshold - 0.1),
      },
      {
        onWarn: (this.tracker as any).callbacks?.onWarn,
        onCompact: (this.tracker as any).callbacks?.onCompact,
      },
    )
  }

  /** Reset internal state (e.g. after external compaction). */
  reset(): void {
    this.tracker.reset()
  }
}
