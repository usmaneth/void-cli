/**
 * Plan/Act Mode Manager
 *
 * Toggles between reasoning-only (plan) and execution (act) phases.
 * In plan mode, only read-only tools are allowed. In act mode, all tools
 * are available and the AI follows the plan steps. In auto mode, the AI
 * decides when to plan vs act.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanActMode = 'plan' | 'act' | 'auto'

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export type PlanStep = {
  id: number
  description: string
  status: PlanStepStatus
  files?: string[]
  tools?: string[]
}

export type Plan = {
  title: string
  steps: PlanStep[]
  createdAt: string
  summary?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools that are safe to use in plan mode (read-only). */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'LS',
  'View',
  'Search',
  'TodoRead',
])

/**
 * Bash subcommands / prefixes that are considered read-only.
 * In plan mode, Bash is allowed only when the command starts with one of these.
 */
const READ_ONLY_BASH_PREFIXES = [
  'cat ',
  'head ',
  'tail ',
  'less ',
  'more ',
  'ls ',
  'ls\n',
  'find ',
  'grep ',
  'rg ',
  'wc ',
  'file ',
  'stat ',
  'du ',
  'df ',
  'pwd',
  'echo ',
  'git log',
  'git diff',
  'git status',
  'git show',
  'git branch',
  'git remote',
  'git rev-parse',
  'tree ',
  'which ',
  'type ',
  'env',
  'printenv',
]

const MODE_CYCLE: PlanActMode[] = ['plan', 'act', 'auto']

const STATUS_ICONS: Record<PlanStepStatus, string> = {
  pending: ' ',
  in_progress: '\u2192',
  completed: '\u2713',
  skipped: '\u2013',
}

const MODE_DESCRIPTIONS: Record<PlanActMode, string> = {
  plan: 'reasoning only, no tool execution',
  act: 'full execution, follows plan steps',
  auto: 'AI decides when to plan vs act',
}

// ---------------------------------------------------------------------------
// PlanActManager
// ---------------------------------------------------------------------------

export class PlanActManager {
  private mode: PlanActMode = 'act'
  private currentPlan: Plan | null = null
  private nextStepId = 1

  // -- Mode management ------------------------------------------------------

  getMode(): PlanActMode {
    return this.mode
  }

  setMode(mode: PlanActMode): void {
    this.mode = mode
  }

  /**
   * Cycle through modes: plan -> act -> auto -> plan
   * Returns the new mode.
   */
  toggleMode(): PlanActMode {
    const currentIndex = MODE_CYCLE.indexOf(this.mode)
    const nextIndex = (currentIndex + 1) % MODE_CYCLE.length
    this.mode = MODE_CYCLE[nextIndex]!
    return this.mode
  }

  // -- Plan CRUD ------------------------------------------------------------

  /**
   * Create a new plan, replacing any existing one.
   * @param title - Short title for the plan
   * @param steps - List of step descriptions
   */
  createPlan(title: string, steps: string[]): Plan {
    this.nextStepId = 1
    const planSteps: PlanStep[] = steps.map(description => ({
      id: this.nextStepId++,
      description,
      status: 'pending' as PlanStepStatus,
    }))

    this.currentPlan = {
      title,
      steps: planSteps,
      createdAt: new Date().toISOString(),
    }

    return this.currentPlan
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan
  }

  /**
   * Update the status of a step by id.
   * Returns true if the step was found and updated.
   */
  updateStep(id: number, status: PlanStepStatus): boolean {
    if (!this.currentPlan) return false
    const step = this.currentPlan.steps.find(s => s.id === id)
    if (!step) return false
    step.status = status
    return true
  }

  /**
   * Add a new step to the current plan.
   * If insertAfterId is provided, inserts after that step; otherwise appends.
   */
  addStep(description: string, insertAfterId?: number): PlanStep | null {
    if (!this.currentPlan) return null

    const newStep: PlanStep = {
      id: this.nextStepId++,
      description,
      status: 'pending',
    }

    if (insertAfterId !== undefined) {
      const index = this.currentPlan.steps.findIndex(
        s => s.id === insertAfterId,
      )
      if (index !== -1) {
        this.currentPlan.steps.splice(index + 1, 0, newStep)
        return newStep
      }
    }

    this.currentPlan.steps.push(newStep)
    return newStep
  }

  /**
   * Remove a step by id.
   * Returns true if the step was found and removed.
   */
  removeStep(id: number): boolean {
    if (!this.currentPlan) return false
    const index = this.currentPlan.steps.findIndex(s => s.id === id)
    if (index === -1) return false
    this.currentPlan.steps.splice(index, 1)
    return true
  }

  /**
   * Clear the current plan entirely.
   */
  clearPlan(): void {
    this.currentPlan = null
    this.nextStepId = 1
  }

  // -- Display & formatting -------------------------------------------------

  /**
   * Get a concise text summary of the plan's progress.
   */
  getPlanSummary(): string {
    if (!this.currentPlan) return 'No active plan.'

    const total = this.currentPlan.steps.length
    const completed = this.currentPlan.steps.filter(
      s => s.status === 'completed',
    ).length
    const skipped = this.currentPlan.steps.filter(
      s => s.status === 'skipped',
    ).length
    const inProgress = this.currentPlan.steps.filter(
      s => s.status === 'in_progress',
    ).length
    const pending = total - completed - skipped - inProgress

    const parts: string[] = [`"${this.currentPlan.title}"`]
    parts.push(`${completed}/${total} completed`)
    if (inProgress > 0) parts.push(`${inProgress} in progress`)
    if (skipped > 0) parts.push(`${skipped} skipped`)
    if (pending > 0) parts.push(`${pending} pending`)

    return parts.join(', ')
  }

  /**
   * Format the plan for user-facing display with status icons and step numbers.
   */
  formatPlanForDisplay(): string {
    if (!this.currentPlan) return 'No active plan.'

    const lines: string[] = [
      `Current Plan: "${this.currentPlan.title}"`,
    ]

    for (const step of this.currentPlan.steps) {
      const icon = STATUS_ICONS[step.status]
      let line = `  [${icon}] ${step.id}. ${step.description}`
      if (step.files && step.files.length > 0) {
        line += ` (files: ${step.files.join(', ')})`
      }
      if (step.tools && step.tools.length > 0) {
        line += ` (tools: ${step.tools.join(', ')})`
      }
      lines.push(line)
    }

    if (this.currentPlan.summary) {
      lines.push('')
      lines.push(`Summary: ${this.currentPlan.summary}`)
    }

    return lines.join('\n')
  }

  /**
   * Format the full status display including mode and plan.
   */
  formatFullStatus(): string {
    const modeLabel = this.mode.toUpperCase()
    const modeDesc = MODE_DESCRIPTIONS[this.mode]
    const lines: string[] = [`Mode: ${modeLabel} (${modeDesc})`]

    if (this.currentPlan) {
      lines.push('')
      lines.push(this.formatPlanForDisplay())
    } else {
      lines.push('')
      lines.push('No active plan. The AI will create one in plan mode.')
    }

    return lines.join('\n')
  }

  // -- Plan parsing ---------------------------------------------------------

  /**
   * Parse a plan from AI response text.
   * Looks for numbered lists, markdown task lists, or bullet points.
   */
  parsePlanFromText(text: string): Plan | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

    // Try to extract a title from the first line or a heading
    let title = 'Untitled Plan'
    const titleMatch = lines[0]?.match(/^#+\s+(.+)$/) ??
      lines[0]?.match(/^(?:Plan|plan):\s*(.+)$/i)
    if (titleMatch) {
      title = titleMatch[1]!
      lines.shift()
    }

    // Extract steps from numbered lists, task lists, or bullet points
    const stepDescriptions: string[] = []

    for (const line of lines) {
      // Numbered list: "1. Do something" or "1) Do something"
      const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/)
      if (numberedMatch) {
        stepDescriptions.push(numberedMatch[1]!)
        continue
      }

      // Markdown task list: "- [ ] Do something" or "- [x] Do something"
      const taskMatch = line.match(/^-\s+\[[ xX]\]\s+(.+)$/)
      if (taskMatch) {
        stepDescriptions.push(taskMatch[1]!)
        continue
      }

      // Bullet list: "- Do something" or "* Do something"
      const bulletMatch = line.match(/^[-*]\s+(.+)$/)
      if (bulletMatch) {
        stepDescriptions.push(bulletMatch[1]!)
        continue
      }
    }

    if (stepDescriptions.length === 0) return null

    return this.createPlan(title, stepDescriptions)
  }

  // -- Tool gating ----------------------------------------------------------

  /**
   * Check if a tool is allowed in the current mode.
   * In plan mode, only read-only tools are permitted.
   * In act and auto modes, all tools are allowed.
   */
  isToolAllowed(toolName: string, bashCommand?: string): boolean {
    if (this.mode !== 'plan') return true

    // In plan mode, check against the read-only allowlist
    if (!READ_ONLY_TOOLS.has(toolName)) return false

    // For Bash tool, additionally check that the command is read-only
    if (toolName === 'Bash' && bashCommand) {
      return isReadOnlyBashCommand(bashCommand)
    }

    return true
  }

  /**
   * Get the list of tools that are allowed in the current mode.
   * Returns null if all tools are allowed (act/auto mode).
   */
  getAllowedTools(): Set<string> | null {
    if (this.mode !== 'plan') return null
    return new Set(READ_ONLY_TOOLS)
  }

  // -- Prompt integration ---------------------------------------------------

  /**
   * Get a system prompt prefix that informs the AI about the current mode.
   */
  getPlanPromptPrefix(): string {
    const parts: string[] = []

    switch (this.mode) {
      case 'plan':
        parts.push(
          'You are currently in PLAN mode. In this mode you should:',
          '- Analyze the codebase and understand the problem',
          '- Create a clear, step-by-step plan',
          '- Only use read-only tools (Read, Glob, Grep, read-only Bash commands)',
          '- Do NOT make any changes to files or run destructive commands',
          '- Present your plan as a numbered list',
          '',
          'When you have a complete plan, the user can switch to act mode with /planact act.',
        )
        break

      case 'act':
        parts.push(
          'You are currently in ACT mode. In this mode you should:',
          '- Execute the plan step by step',
          '- Use all available tools to implement changes',
          '- Mark steps as completed as you finish them',
          '- If you encounter issues, note them and adapt',
        )
        if (this.currentPlan) {
          parts.push('')
          parts.push(this.formatPlanForDisplay())
        }
        break

      case 'auto':
        parts.push(
          'You are in AUTO mode. You can decide when to plan and when to act.',
          '- Plan first for complex or multi-step tasks',
          '- Act immediately for simple, well-defined tasks',
          '- Use your judgment on tool usage',
        )
        if (this.currentPlan) {
          parts.push('')
          parts.push(this.formatPlanForDisplay())
        }
        break
    }

    return parts.join('\n')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a bash command is read-only based on known safe prefixes.
 */
function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim()

  // Empty commands are safe
  if (!trimmed) return true

  // Check against known read-only prefixes
  for (const prefix of READ_ONLY_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix) || trimmed === prefix.trim()) {
      return true
    }
  }

  // Piped commands: check that every segment is read-only
  if (trimmed.includes('|')) {
    const segments = trimmed.split('|').map(s => s.trim())
    return segments.every(seg => isReadOnlyBashCommand(seg))
  }

  return false
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: PlanActManager | null = null

/**
 * Get the singleton PlanActManager instance.
 */
export function getPlanActManager(): PlanActManager {
  if (!instance) {
    instance = new PlanActManager()
  }
  return instance
}

/**
 * Reset the singleton (useful for testing).
 */
export function resetPlanActManager(): void {
  instance = null
}
