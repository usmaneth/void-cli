/**
 * Pre-generation Clarification System — inspired by GPT Engineer.
 *
 * Analyzes user messages for ambiguity and generates clarifying questions
 * before the model begins work. This reduces wasted generations from
 * underspecified prompts.
 *
 * Usage:
 *   /clarify           — Toggle clarification mode on/off
 *   /clarify on|off    — Explicit enable/disable
 *   /clarify analyze   — Show ambiguity analysis for a message
 *   /clarify threshold — Set ambiguity threshold
 *   /clarify status    — Show current config
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClarifyConfig {
  /** Whether to ask clarifying questions before generation (default: false). */
  enabled: boolean
  /** Maximum number of clarification questions to ask (default: 3). */
  maxQuestions: number
  /** Ambiguity score threshold — questions are asked when score > this (default: 60). */
  triggerThreshold: number
  /** Patterns in the user message that skip clarification entirely. */
  skipPatterns: string[]
}

export interface AmbiguityResult {
  /** 0-100, higher = more ambiguous. */
  score: number
  /** Human-readable reasons explaining why the message is ambiguous. */
  reasons: string[]
  /** Suggested clarification questions to ask the user. */
  suggestedQuestions: string[]
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ClarifyConfig = {
  enabled: false,
  maxQuestions: 3,
  triggerThreshold: 60,
  skipPatterns: [
    'just do it',
    'no questions',
    'skip clarif',
    'go ahead',
    'do it now',
  ],
}

// ---------------------------------------------------------------------------
// Heuristic helpers (pure functions, no external deps)
// ---------------------------------------------------------------------------

/** Words that signal a vague scope when used without specifics. */
const VAGUE_ACTION_WORDS = [
  'improve',
  'make better',
  'fix issues',
  'clean up',
  'cleanup',
  'optimize',
  'refactor',
  'update',
  'enhance',
  'rework',
  'tidy',
  'polish',
]

/** Words that have multiple common interpretations. */
const MULTI_INTERPRET_PHRASES: Array<{ phrase: string; options: string[] }> = [
  {
    phrase: 'change the style',
    options: ['CSS styling', 'code style / formatting', 'UI design'],
  },
  {
    phrase: 'add logging',
    options: [
      'structured logging library',
      'console.log statements',
      'log file output',
    ],
  },
  {
    phrase: 'add tests',
    options: ['unit tests', 'integration tests', 'end-to-end tests'],
  },
  {
    phrase: 'handle errors',
    options: [
      'try/catch blocks',
      'error boundary components',
      'global error handler',
    ],
  },
  {
    phrase: 'add error handling',
    options: [
      'try/catch blocks',
      'error boundary components',
      'global error handler',
    ],
  },
  {
    phrase: 'add auth',
    options: [
      'session-based authentication',
      'JWT token auth',
      'OAuth / SSO integration',
    ],
  },
  {
    phrase: 'add caching',
    options: [
      'in-memory cache',
      'Redis / external cache',
      'HTTP cache headers',
    ],
  },
  {
    phrase: 'make it faster',
    options: [
      'algorithmic optimization',
      'caching / memoization',
      'lazy loading / code splitting',
    ],
  },
]

/** Rough check for whether the message references a file path. */
function containsFilePath(message: string): boolean {
  // Matches patterns like ./foo, src/bar.ts, /absolute/path, foo.ext
  return /(?:\.\/|\/|[a-zA-Z0-9_-]+\/)[a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10}/.test(
    message,
  )
}

/** Rough check for whether the message mentions a specific function or class. */
function containsCodeIdentifier(message: string): boolean {
  // Matches patterns like functionName(), ClassName, or backtick-quoted identifiers
  return /`[a-zA-Z_]\w+`/.test(message) || /\b[a-zA-Z_]\w+\(\)/.test(message)
}

/** Count how many words are in the message (whitespace-split). */
function wordCount(message: string): number {
  return message.trim().split(/\s+/).filter(Boolean).length
}

// ---------------------------------------------------------------------------
// AmbiguityAnalyzer
// ---------------------------------------------------------------------------

export class AmbiguityAnalyzer {
  /**
   * Analyze a user message for ambiguity and produce a scored result
   * with reasons and suggested questions.
   */
  analyze(message: string): AmbiguityResult {
    const lower = message.toLowerCase().trim()
    let score = 0
    const reasons: string[] = []
    const suggestedQuestions: string[] = []

    // --- Heuristic 1: Vague scope ---
    for (const vague of VAGUE_ACTION_WORDS) {
      if (lower.includes(vague)) {
        // Only flag if there is no file path or code identifier to anchor it
        if (!containsFilePath(message) && !containsCodeIdentifier(message)) {
          score += 25
          reasons.push(
            `Vague action "${vague}" without specific files or identifiers`,
          )
          suggestedQuestions.push(
            'What specific changes do you have in mind for this action?',
          )
          break // only count once
        }
      }
    }

    // --- Heuristic 2: Missing target ---
    if (!containsFilePath(message) && !containsCodeIdentifier(message)) {
      score += 20
      reasons.push('No file paths or specific code identifiers mentioned')
      suggestedQuestions.push('Which files or functions should I focus on?')
    }

    // --- Heuristic 3: Multiple interpretations ---
    for (const { phrase, options } of MULTI_INTERPRET_PHRASES) {
      if (lower.includes(phrase)) {
        score += 25
        reasons.push(
          `"${phrase}" can mean multiple things: ${options.join(', ')}`,
        )
        suggestedQuestions.push(
          `Did you mean ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}?`,
        )
        break // only count first match
      }
    }

    // --- Heuristic 4: Underspecified behavior ---
    const underspecPatterns: Array<{
      pattern: RegExp
      reason: string
      question: string
    }> = [
      {
        pattern: /\berror handling\b/i,
        reason:
          'Error handling request without specifying which errors or desired behavior',
        question:
          'What types of errors should be handled, and what should happen when they occur?',
      },
      {
        pattern: /\bvalidat(?:e|ion)\b/i,
        reason: 'Validation request without specifying rules or constraints',
        question: 'What validation rules or constraints should be applied?',
      },
      {
        pattern: /\bpermissions?\b/i,
        reason: 'Permission changes without specifying the access model',
        question: 'What permission model or access levels do you need?',
      },
      {
        pattern: /\bmigrat(?:e|ion)\b/i,
        reason:
          'Migration request without specifying source/target or data handling',
        question:
          'What is the source and target, and how should existing data be handled?',
      },
    ]

    for (const { pattern, reason, question } of underspecPatterns) {
      if (pattern.test(lower)) {
        score += 15
        reasons.push(reason)
        suggestedQuestions.push(question)
        break
      }
    }

    // --- Heuristic 5: Short messages with action verbs ---
    const words = wordCount(message)
    if (words <= 4 && words >= 1) {
      const startsWithAction =
        /^(refactor|fix|add|change|update|remove|delete|move|rename|create|implement|build|write)\b/i.test(
          lower,
        )
      if (startsWithAction) {
        score += 20
        reasons.push(
          `Short message (${words} word${words === 1 ? '' : 's'}) with an action verb — likely underspecified`,
        )
        suggestedQuestions.push(
          'Could you provide more detail about what you want done and where?',
        )
      }
    }

    // Clamp score to 0-100
    score = Math.min(100, Math.max(0, score))

    // Deduplicate questions
    const uniqueQuestions = [...new Set(suggestedQuestions)]

    return {
      score,
      reasons,
      suggestedQuestions: uniqueQuestions,
    }
  }
}

// ---------------------------------------------------------------------------
// ClarificationManager
// ---------------------------------------------------------------------------

export class ClarificationManager {
  private _config: ClarifyConfig
  private readonly analyzer: AmbiguityAnalyzer

  constructor(config?: Partial<ClarifyConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config }
    this.analyzer = new AmbiguityAnalyzer()
  }

  // -- Config accessors -----------------------------------------------------

  getConfig(): Readonly<ClarifyConfig> {
    return { ...this._config }
  }

  setConfig(partial: Partial<ClarifyConfig>): void {
    this._config = { ...this._config, ...partial }
  }

  toggle(): boolean {
    this._config.enabled = !this._config.enabled
    return this._config.enabled
  }

  enable(): void {
    this._config.enabled = true
  }

  disable(): void {
    this._config.enabled = false
  }

  // -- Core API -------------------------------------------------------------

  /**
   * Determine whether the given message should trigger clarification.
   * Returns false if clarification is disabled, the message matches a skip
   * pattern, or the ambiguity score is below the threshold.
   */
  shouldClarify(message: string): boolean {
    if (!this._config.enabled) {
      return false
    }

    const lower = message.toLowerCase().trim()

    // Check skip patterns
    for (const pattern of this._config.skipPatterns) {
      if (lower.includes(pattern.toLowerCase())) {
        return false
      }
    }

    // If the message already contains file paths AND specific actions, skip
    if (containsFilePath(message) && containsCodeIdentifier(message)) {
      return false
    }

    const result = this.analyzer.analyze(message)
    return result.score > this._config.triggerThreshold
  }

  /**
   * Generate clarification questions for a message, capped at maxQuestions.
   */
  generateQuestions(message: string): string[] {
    const result = this.analyzer.analyze(message)
    return result.suggestedQuestions.slice(0, this._config.maxQuestions)
  }

  /**
   * Format clarification questions into a readable prompt string.
   */
  formatClarificationPrompt(questions: string[]): string {
    if (questions.length === 0) {
      return 'No clarification needed.'
    }

    const header =
      'Before I proceed, I have a few clarifying questions:\n'
    const body = questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')
    return `${header}\n${body}\n`
  }

  /**
   * Combine the original message with clarification answers into an
   * enriched prompt that gives the model more context.
   */
  applyAnswers(
    originalMessage: string,
    answers: Record<string, string>,
  ): string {
    const entries = Object.entries(answers)
    if (entries.length === 0) {
      return originalMessage
    }

    const clarifications = entries
      .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
      .join('\n\n')

    return [
      originalMessage,
      '',
      '--- Clarifications ---',
      clarifications,
      '--- End Clarifications ---',
    ].join('\n')
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (lazily accessible)
// ---------------------------------------------------------------------------

let _instance: ClarificationManager | null = null

export function getClarificationManager(): ClarificationManager {
  if (!_instance) {
    _instance = new ClarificationManager()
  }
  return _instance
}

export function resetClarificationManager(): void {
  _instance = null
}
