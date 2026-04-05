/**
 * LM-optimized output compression system.
 *
 * Inspired by SWE-agent's summarized output approach, this module compresses
 * large command outputs to reduce token usage while preserving the information
 * most useful for language model reasoning: errors, warnings, file paths,
 * structural markers, and deduplication of repetitive content.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  /** Master toggle (default: true). */
  enabled: boolean
  /** Max lines before compression kicks in (default: 200). */
  maxOutputLines: number
  /** Max estimated tokens before compression (default: 4000). */
  maxOutputTokens: number
  /** Compression strategy (default: 'smart'). */
  strategy: 'truncate' | 'smart' | 'summary'
  /** Always keep error lines (default: true). */
  preserveErrors: boolean
  /** Keep headings/structure (default: true). */
  preserveStructure: boolean
}

export interface CompressedOutput {
  /** Compressed content. */
  content: string
  /** Lines before compression. */
  originalLines: number
  /** Lines after compression. */
  compressedLines: number
  /** Which strategy was used. */
  strategy: string
  /** Estimated token count. */
  tokensEstimate: number
  /** Whether any compression was applied. */
  wasCompressed: boolean
}

export type LineClass =
  | 'error'
  | 'warning'
  | 'info'
  | 'path'
  | 'heading'
  | 'blank'
  | 'content'

export type OutputType = 'test' | 'lint' | 'build' | 'git' | 'general'

export interface CompressionStats {
  totalCalls: number
  totalLinesIn: number
  totalLinesOut: number
  totalTokensSaved: number
  byStrategy: Record<string, number>
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CompressionConfig = {
  enabled: true,
  maxOutputLines: 200,
  maxOutputTokens: 4000,
  strategy: 'smart',
  preserveErrors: true,
  preserveStructure: true,
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bError:/,
  /\bFAIL\b/,
  /\u2717/, // ✗
  /\u2718/, // ✘
  /\bpanic\b/i,
  /\bexception\b/i,
]

const WARNING_PATTERNS = [/\bwarn\b/i, /\bWarning:/, /\u26A0/]

// Match file paths: things like ./foo/bar.ts, /home/user/file.js, src/index.ts:42
const PATH_PATTERN =
  /(?:^|[\s(["'])(?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\.\w{1,10}(?::\d+(?::\d+)?)?/

const HEADING_PATTERNS = [
  /^={3,}/, // ===
  /^-{3,}/, // ---
  /^#{1,6}\s/, // ## Markdown
  /^[A-Z][A-Z0-9 _-]{4,}$/, // ALL-CAPS lines (min 5 chars)
]

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

export function classifyLine(line: string): LineClass {
  const trimmed = line.trim()

  if (trimmed.length === 0) return 'blank'

  for (const pat of ERROR_PATTERNS) {
    if (pat.test(trimmed)) return 'error'
  }
  for (const pat of WARNING_PATTERNS) {
    if (pat.test(trimmed)) return 'warning'
  }
  for (const pat of HEADING_PATTERNS) {
    if (pat.test(trimmed)) return 'heading'
  }
  if (PATH_PATTERN.test(trimmed)) return 'path'

  return 'content'
}

// ---------------------------------------------------------------------------
// Output type detection
// ---------------------------------------------------------------------------

export function detectOutputType(output: string): OutputType {
  const sample = output.slice(0, 4000)

  // Test output indicators
  if (
    /\b(PASS|FAIL|Tests?|test suites?|passing|failing|✓|✗|✘|assertions?|specs?)\b/i.test(
      sample,
    )
  ) {
    return 'test'
  }

  // Lint output indicators
  if (
    /\b(eslint|biome|prettier|lint|tslint|stylelint|warning\s+\S+\/\S+)\b/i.test(
      sample,
    )
  ) {
    return 'lint'
  }

  // Git output indicators
  if (
    /\b(commit [0-9a-f]{7,40}|diff --git|@@\s.*@@|insertions?\(\+\)|deletions?\(-\))\b/.test(
      sample,
    )
  ) {
    return 'git'
  }

  // Build output indicators
  if (
    /\b(compil|bundl|build|webpack|rollup|esbuild|vite|tsc)\b/i.test(sample)
  ) {
    return 'build'
  }

  return 'general'
}

// ---------------------------------------------------------------------------
// OutputCompressor
// ---------------------------------------------------------------------------

export class OutputCompressor {
  config: CompressionConfig
  private stats: CompressionStats = {
    totalCalls: 0,
    totalLinesIn: 0,
    totalLinesOut: 0,
    totalTokensSaved: 0,
    byStrategy: {},
  }

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Estimate token count for a string (chars / 4 approximation).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Check whether the output exceeds configured limits.
   */
  shouldCompress(output: string): boolean {
    if (!this.config.enabled) return false
    const lines = output.split('\n')
    if (lines.length > this.config.maxOutputLines) return true
    if (this.estimateTokens(output) > this.config.maxOutputTokens) return true
    return false
  }

  /**
   * Compress output according to the configured strategy.
   */
  compress(output: string, _context?: string): CompressedOutput {
    const lines = output.split('\n')
    const originalLines = lines.length
    const originalTokens = this.estimateTokens(output)

    if (!this.shouldCompress(output)) {
      return {
        content: output,
        originalLines,
        compressedLines: originalLines,
        strategy: 'none',
        tokensEstimate: originalTokens,
        wasCompressed: false,
      }
    }

    let compressed: string
    let strategyUsed: string = this.config.strategy

    switch (this.config.strategy) {
      case 'truncate':
        compressed = this.truncateStrategy(output)
        break
      case 'summary':
        compressed = this.summaryStrategy(output)
        break
      case 'smart':
      default: {
        // Smart mode: try specialized compressor first, fall back to general.
        const outputType = detectOutputType(output)
        switch (outputType) {
          case 'test':
            compressed = compressTestOutput(output)
            strategyUsed = 'smart:test'
            break
          case 'lint':
            compressed = compressLintOutput(output)
            strategyUsed = 'smart:lint'
            break
          case 'build':
            compressed = compressBuildOutput(output)
            strategyUsed = 'smart:build'
            break
          case 'git':
            compressed = compressGitOutput(output)
            strategyUsed = 'smart:git'
            break
          default:
            compressed = this.smartStrategy(output)
            break
        }
        break
      }
    }

    const compressedLines = compressed.split('\n').length
    const tokensEstimate = this.estimateTokens(compressed)

    // Update stats
    this.stats.totalCalls++
    this.stats.totalLinesIn += originalLines
    this.stats.totalLinesOut += compressedLines
    this.stats.totalTokensSaved += originalTokens - tokensEstimate
    this.stats.byStrategy[strategyUsed] =
      (this.stats.byStrategy[strategyUsed] ?? 0) + 1

    return {
      content: compressed,
      originalLines,
      compressedLines,
      strategy: strategyUsed,
      tokensEstimate,
      wasCompressed: true,
    }
  }

  /**
   * Return compression statistics for the current session.
   */
  getStats(): CompressionStats {
    return { ...this.stats }
  }

  /**
   * Reset session statistics.
   */
  resetStats(): void {
    this.stats = {
      totalCalls: 0,
      totalLinesIn: 0,
      totalLinesOut: 0,
      totalTokensSaved: 0,
      byStrategy: {},
    }
  }

  // -----------------------------------------------------------------------
  // Strategies (private)
  // -----------------------------------------------------------------------

  /**
   * Truncate: keep first N and last N lines with a marker in between.
   */
  private truncateStrategy(output: string): string {
    const lines = output.split('\n')
    const keep = Math.floor(this.config.maxOutputLines / 2)
    const head = lines.slice(0, keep)
    const tail = lines.slice(-keep)
    const dropped = lines.length - keep * 2
    return [
      ...head,
      `\n[... ${dropped} lines truncated ...]\n`,
      ...tail,
    ].join('\n')
  }

  /**
   * Smart: intelligent compression that preserves important content.
   */
  private smartStrategy(output: string): string {
    const lines = output.split('\n')
    const kept: string[] = []
    const seenPatterns = new Set<string>()
    let consecutiveSimilar = 0
    let lastClassification: LineClass | null = null
    let collapsedCount = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const cls = classifyLine(line)

      // Always keep errors if configured
      if (this.config.preserveErrors && cls === 'error') {
        flushCollapsed()
        kept.push(line)
        lastClassification = cls
        consecutiveSimilar = 0
        continue
      }

      // Always keep warnings if configured
      if (this.config.preserveErrors && cls === 'warning') {
        flushCollapsed()
        kept.push(line)
        lastClassification = cls
        consecutiveSimilar = 0
        continue
      }

      // Keep headings if configured
      if (this.config.preserveStructure && cls === 'heading') {
        flushCollapsed()
        kept.push(line)
        lastClassification = cls
        consecutiveSimilar = 0
        continue
      }

      // Keep paths (file references are valuable context)
      if (cls === 'path') {
        flushCollapsed()
        kept.push(line)
        lastClassification = cls
        consecutiveSimilar = 0
        continue
      }

      // Deduplicate: normalize the line and skip if we have already seen it.
      const normalized = line.trim().replace(/\d+/g, 'N')
      if (seenPatterns.has(normalized)) {
        collapsedCount++
        continue
      }
      seenPatterns.add(normalized)

      // Collapse consecutive lines of the same class
      if (cls === lastClassification && cls === 'content') {
        consecutiveSimilar++
        if (consecutiveSimilar > 3) {
          collapsedCount++
          continue
        }
      } else {
        consecutiveSimilar = 0
      }

      // Skip blank lines in runs of more than one
      if (cls === 'blank' && lastClassification === 'blank') {
        continue
      }

      flushCollapsed()
      kept.push(line)
      lastClassification = cls
    }

    flushCollapsed()
    return kept.join('\n')

    function flushCollapsed() {
      if (collapsedCount > 0) {
        kept.push(`[... ${collapsedCount} similar lines collapsed ...]`)
        collapsedCount = 0
      }
    }
  }

  /**
   * Summary: produce a compact structured summary of the output.
   */
  private summaryStrategy(output: string): string {
    const lines = output.split('\n')
    let errorCount = 0
    let warningCount = 0
    const uniqueErrors: string[] = []
    const filePaths = new Set<string>()
    const seenErrors = new Set<string>()

    for (const line of lines) {
      const cls = classifyLine(line)

      if (cls === 'error') {
        errorCount++
        const trimmed = line.trim()
        if (!seenErrors.has(trimmed) && uniqueErrors.length < 20) {
          seenErrors.add(trimmed)
          uniqueErrors.push(trimmed)
        }
      }
      if (cls === 'warning') {
        warningCount++
      }
      if (cls === 'path') {
        const match = line.match(
          /(?:\.{0,2}\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w{1,10}(?::\d+)?/,
        )
        if (match) filePaths.add(match[0])
      }
    }

    const parts: string[] = [
      '=== Output Summary ===',
      `Total lines: ${lines.length}`,
      `Errors: ${errorCount}`,
      `Warnings: ${warningCount}`,
      `Files referenced: ${filePaths.size}`,
    ]

    if (uniqueErrors.length > 0) {
      parts.push('', '--- Errors ---')
      for (const err of uniqueErrors) {
        parts.push(`  ${err}`)
      }
    }

    if (filePaths.size > 0) {
      parts.push('', '--- Files ---')
      for (const fp of filePaths) {
        parts.push(`  ${fp}`)
      }
    }

    parts.push('=== End Summary ===')
    return parts.join('\n')
  }
}

// ---------------------------------------------------------------------------
// Specialized compressors (exported as standalone functions)
// ---------------------------------------------------------------------------

/**
 * Compress test output: collapse passing tests, expand failures.
 */
export function compressTestOutput(output: string): string {
  const lines = output.split('\n')
  const kept: string[] = []
  let passingCount = 0
  let inPassingRun = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect passing test lines
    const isPass = /^\s*[✓✔]\s/.test(trimmed) || /\bpass(ed|ing)?\b/i.test(trimmed)
    const isFail =
      /^\s*[✗✘]\s/.test(trimmed) ||
      /\b(FAIL|fail(ed|ing)?)\b/.test(trimmed) ||
      classifyLine(line) === 'error'

    if (isFail) {
      // Flush any passing run, then keep the failure
      if (inPassingRun && passingCount > 0) {
        kept.push(`  [... ${passingCount} passing tests collapsed ...]`)
        passingCount = 0
        inPassingRun = false
      }
      kept.push(line)
      continue
    }

    if (isPass) {
      inPassingRun = true
      passingCount++
      continue
    }

    // Non-test line: flush passing run, keep line
    if (inPassingRun && passingCount > 0) {
      kept.push(`  [... ${passingCount} passing tests collapsed ...]`)
      passingCount = 0
      inPassingRun = false
    }

    // Keep headings, errors, and non-trivial content
    const cls = classifyLine(line)
    if (
      cls === 'error' ||
      cls === 'warning' ||
      cls === 'heading' ||
      cls === 'path' ||
      trimmed.length > 0
    ) {
      kept.push(line)
    }
  }

  // Final flush
  if (passingCount > 0) {
    kept.push(`  [... ${passingCount} passing tests collapsed ...]`)
  }

  return kept.join('\n')
}

/**
 * Compress lint output: group by severity, deduplicate same-rule violations.
 */
export function compressLintOutput(output: string): string {
  const lines = output.split('\n')
  const errors: string[] = []
  const warnings: string[] = []
  const other: string[] = []
  const seenRules = new Map<string, number>()

  for (const line of lines) {
    const cls = classifyLine(line)

    // Try to extract a rule id like (no-unused-vars) or [rule-name]
    const ruleMatch = line.match(/[[(]([\w-]+\/[\w-]+|[\w-]+)[)\]]/)
    const ruleId = ruleMatch?.[1] ?? null

    if (ruleId) {
      const count = seenRules.get(ruleId) ?? 0
      seenRules.set(ruleId, count + 1)
      // Only keep first two occurrences of each rule
      if (count >= 2) continue
    }

    if (cls === 'error') {
      errors.push(line)
    } else if (cls === 'warning') {
      warnings.push(line)
    } else if (cls === 'heading' || cls === 'blank') {
      other.push(line)
    } else {
      other.push(line)
    }
  }

  const parts: string[] = []

  if (errors.length > 0) {
    parts.push('--- Errors ---')
    parts.push(...errors)
  }
  if (warnings.length > 0) {
    parts.push('--- Warnings ---')
    parts.push(...warnings)
  }

  // Append rule summary for deduplicated rules
  const deduped = [...seenRules.entries()].filter(([, count]) => count > 2)
  if (deduped.length > 0) {
    parts.push('')
    parts.push('--- Rule Summary ---')
    for (const [rule, count] of deduped) {
      parts.push(`  ${rule}: ${count} violations (showing first 2)`)
    }
  }

  if (other.length > 0) {
    parts.push(...other)
  }

  return parts.join('\n')
}

/**
 * Compress build output: keep errors and warnings, drop info lines.
 */
export function compressBuildOutput(output: string): string {
  const lines = output.split('\n')
  const kept: string[] = []
  let droppedInfo = 0

  for (const line of lines) {
    const cls = classifyLine(line)

    if (cls === 'error' || cls === 'warning' || cls === 'heading') {
      if (droppedInfo > 0) {
        kept.push(`[... ${droppedInfo} info lines dropped ...]`)
        droppedInfo = 0
      }
      kept.push(line)
      continue
    }

    if (cls === 'path') {
      kept.push(line)
      continue
    }

    // Keep the very first and last few lines (preamble/summary)
    if (kept.length < 5) {
      kept.push(line)
      continue
    }

    droppedInfo++
  }

  if (droppedInfo > 0) {
    kept.push(`[... ${droppedInfo} info lines dropped ...]`)
  }

  return kept.join('\n')
}

/**
 * Compress git output: keep diff stats, collapse unchanged file listings.
 */
export function compressGitOutput(output: string): string {
  const lines = output.split('\n')
  const kept: string[] = []
  let unchangedFiles = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Always keep diff stat summary lines
    if (/\d+\s+files?\s+changed/.test(trimmed)) {
      if (unchangedFiles > 0) {
        kept.push(`[... ${unchangedFiles} unchanged files collapsed ...]`)
        unchangedFiles = 0
      }
      kept.push(line)
      continue
    }

    // Keep diff headers and hunks
    if (/^(diff --git|---|\+\+\+|@@)/.test(trimmed)) {
      if (unchangedFiles > 0) {
        kept.push(`[... ${unchangedFiles} unchanged files collapsed ...]`)
        unchangedFiles = 0
      }
      kept.push(line)
      continue
    }

    // Keep added/removed lines
    if (/^[+-]/.test(line) && !/^[+-]{3}/.test(line)) {
      kept.push(line)
      continue
    }

    // Keep error/warning lines
    const cls = classifyLine(line)
    if (cls === 'error' || cls === 'warning' || cls === 'heading') {
      if (unchangedFiles > 0) {
        kept.push(`[... ${unchangedFiles} unchanged files collapsed ...]`)
        unchangedFiles = 0
      }
      kept.push(line)
      continue
    }

    // Context lines in diff (no prefix) or blank lines: collapse
    if (trimmed.length === 0 || /^\s/.test(line)) {
      unchangedFiles++
      continue
    }

    // Keep anything else (commit messages, branch info, etc.)
    kept.push(line)
  }

  if (unchangedFiles > 0) {
    kept.push(`[... ${unchangedFiles} unchanged lines collapsed ...]`)
  }

  return kept.join('\n')
}

// ---------------------------------------------------------------------------
// Singleton for session-wide use
// ---------------------------------------------------------------------------

let _defaultCompressor: OutputCompressor | null = null

export function getDefaultCompressor(): OutputCompressor {
  if (!_defaultCompressor) {
    _defaultCompressor = new OutputCompressor()
  }
  return _defaultCompressor
}

export function setDefaultCompressor(compressor: OutputCompressor): void {
  _defaultCompressor = compressor
}
