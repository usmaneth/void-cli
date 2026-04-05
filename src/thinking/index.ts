/**
 * Thinking mode toggle inspired by Kimi Code's Tab-to-think feature.
 * Allows users to enable extended thinking for complex tasks, with
 * automatic complexity detection and configurable token budgets.
 */

export interface ThinkingConfig {
  enabled: boolean
  budgetTokens: number
  showThinking: boolean
  autoThink: boolean
  complexityThreshold: number
}

export interface ComplexityAnalysis {
  score: number
  reasons: string[]
}

const DEFAULT_CONFIG: ThinkingConfig = {
  enabled: false,
  budgetTokens: 10000,
  showThinking: true,
  autoThink: false,
  complexityThreshold: 50,
}

const TECHNICAL_KEYWORDS = [
  'architect',
  'architecture',
  'refactor',
  'refactoring',
  'design',
  'plan',
  'complex',
  'debug',
  'trace',
  'analyze',
  'analysis',
  'migrate',
  'migration',
  'optimize',
  'optimization',
  'performance',
  'scalability',
  'concurrency',
  'distributed',
  'security',
  'vulnerability',
]

const QUESTION_PATTERNS = [
  'why',
  'how should',
  'what if',
  'how do',
  'how can',
  'what would',
  'what are the',
  'how would',
  'should i',
  'is it better',
]

const MULTI_REQUIREMENT_MARKERS = [
  'and also',
  'as well as',
  'in addition',
  'furthermore',
  'moreover',
  'additionally',
  'on top of that',
  'plus',
]

/**
 * Analyzes the complexity of a user message and returns a score (0-100)
 * along with reasons explaining the score.
 */
export function analyzeComplexity(message: string): ComplexityAnalysis {
  const reasons: string[] = []
  let score = 0

  const words = message.trim().split(/\s+/)
  const wordCount = words.length
  const lowerMessage = message.toLowerCase()

  // Message length scoring (0-25 points)
  if (wordCount > 200) {
    score += 25
    reasons.push(`Very long message (${wordCount} words)`)
  } else if (wordCount > 100) {
    score += 18
    reasons.push(`Long message (${wordCount} words)`)
  } else if (wordCount > 50) {
    score += 10
    reasons.push(`Moderate length message (${wordCount} words)`)
  }

  // Technical keywords scoring (0-25 points)
  const foundKeywords: string[] = []
  for (const keyword of TECHNICAL_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      foundKeywords.push(keyword)
    }
  }
  if (foundKeywords.length > 0) {
    const keywordScore = Math.min(25, foundKeywords.length * 5)
    score += keywordScore
    reasons.push(
      `Technical keywords found: ${foundKeywords.join(', ')}`,
    )
  }

  // Question words scoring (0-20 points)
  const foundQuestions: string[] = []
  for (const pattern of QUESTION_PATTERNS) {
    if (lowerMessage.includes(pattern)) {
      foundQuestions.push(pattern)
    }
  }
  if (foundQuestions.length > 0) {
    const questionScore = Math.min(20, foundQuestions.length * 7)
    score += questionScore
    reasons.push(
      `Analytical question patterns: ${foundQuestions.join(', ')}`,
    )
  }

  // Multiple requirements scoring (0-15 points)
  const foundMarkers: string[] = []
  for (const marker of MULTI_REQUIREMENT_MARKERS) {
    if (lowerMessage.includes(marker)) {
      foundMarkers.push(marker)
    }
  }
  // Check for numbered lists (e.g., "1.", "2.", "3.")
  const numberedListMatches = message.match(/^\s*\d+[.)]/gm)
  if (numberedListMatches && numberedListMatches.length >= 2) {
    foundMarkers.push(`numbered list (${numberedListMatches.length} items)`)
  }
  if (foundMarkers.length > 0) {
    const markerScore = Math.min(15, foundMarkers.length * 5)
    score += markerScore
    reasons.push(
      `Multiple requirements detected: ${foundMarkers.join(', ')}`,
    )
  }

  // Code references scoring (0-15 points)
  const backtickCount = (message.match(/`[^`]+`/g) || []).length
  const filePathCount = (
    message.match(/[\w./\\-]+\.(ts|js|py|go|rs|java|tsx|jsx|css|html|json|yaml|yml|toml|md)/g) || []
  ).length
  const codeRefCount = backtickCount + filePathCount
  if (codeRefCount > 0) {
    const codeScore = Math.min(15, codeRefCount * 3)
    score += codeScore
    reasons.push(
      `Code references found (${codeRefCount} reference${codeRefCount !== 1 ? 's' : ''})`,
    )
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score))

  if (reasons.length === 0) {
    reasons.push('Simple message with low complexity')
  }

  return { score, reasons }
}

export class ThinkingMode {
  private _config: ThinkingConfig
  private _lastAnalysis: ComplexityAnalysis | null = null

  constructor(config?: Partial<ThinkingConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config }
  }

  get config(): ThinkingConfig {
    return { ...this._config }
  }

  get lastAnalysis(): ComplexityAnalysis | null {
    return this._lastAnalysis ? { ...this._lastAnalysis } : null
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

  isEnabled(): boolean {
    return this._config.enabled
  }

  shouldAutoThink(userMessage: string): boolean {
    if (!this._config.autoThink) {
      return false
    }

    const words = userMessage.trim().split(/\s+/)
    if (words.length > this._config.complexityThreshold) {
      return true
    }

    const lowerMessage = userMessage.toLowerCase()

    for (const keyword of TECHNICAL_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        return true
      }
    }

    for (const pattern of QUESTION_PATTERNS) {
      if (lowerMessage.includes(pattern)) {
        return true
      }
    }

    return false
  }

  buildThinkingPrompt(task: string): string {
    return [
      'Before responding, think step by step about this task.',
      'Consider:',
      '1) What is being asked',
      '2) What are the key constraints',
      '3) What could go wrong',
      "4) What's the best approach",
      '',
      'Then provide your response.',
      '',
      '---',
      '',
      task,
    ].join('\n')
  }

  setBudget(tokens: number): void {
    if (tokens < 1) {
      throw new Error('Token budget must be at least 1')
    }
    if (tokens > 128000) {
      throw new Error('Token budget cannot exceed 128000')
    }
    this._config.budgetTokens = tokens
  }

  getConfig(): ThinkingConfig {
    return { ...this._config }
  }

  setConfig(partial: Partial<ThinkingConfig>): void {
    this._config = { ...this._config, ...partial }
  }

  formatThinkingOutput(thinking: string): string {
    const lines = [
      '\u001b[2m--- thinking ---\u001b[0m',
      '',
      '\u001b[2m' + thinking + '\u001b[0m',
      '',
      '\u001b[2m--- end thinking ---\u001b[0m',
    ]
    return lines.join('\n')
  }

  /**
   * Analyze a message and cache the result. Returns the analysis.
   */
  analyze(message: string): ComplexityAnalysis {
    this._lastAnalysis = analyzeComplexity(message)
    return { ...this._lastAnalysis }
  }
}

// Singleton instance for global use
let _instance: ThinkingMode | null = null

export function getThinkingMode(): ThinkingMode {
  if (!_instance) {
    _instance = new ThinkingMode()
  }
  return _instance
}

export function resetThinkingMode(): void {
  _instance = null
}
