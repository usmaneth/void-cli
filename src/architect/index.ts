/**
 * Architect Mode - Two-model pipeline for planning and implementation.
 *
 * Splits complex tasks into a planning phase (architect model) and an
 * implementation phase (coder model) so each model can focus on what it
 * does best.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ArchitectConfig {
  enabled: boolean
  architectModel: string
  coderModel: string
  planPrompt?: string
  autoApply: boolean
}

export interface ArchitectStep {
  order: number
  description: string
  file?: string
  type: 'create' | 'modify' | 'delete' | 'analyze' | 'test'
}

export interface ArchitectPlan {
  summary: string
  approach: string
  steps: ArchitectStep[]
  filesAffected: string[]
  risks: string[]
}

// ---------------------------------------------------------------------------
// Default system prompts
// ---------------------------------------------------------------------------

export const ARCHITECT_SYSTEM_PROMPT = `You are an architect. Analyze this task and create a detailed implementation plan. Do NOT write code.

Your job:
1. Understand the task and its requirements thoroughly.
2. Identify every file that will need to be created, modified, or deleted.
3. Break the work into small, ordered steps that a coder can follow precisely.
4. Assess risks, edge cases, and potential issues.
5. Consider existing code patterns and conventions.

Output a structured plan in the following JSON format (no markdown fences, just raw JSON):
{
  "summary": "One-line summary of what this task accomplishes",
  "approach": "Detailed description of the overall approach and key design decisions",
  "steps": [
    {
      "order": 1,
      "description": "What to do in this step",
      "file": "path/to/file (optional)",
      "type": "create | modify | delete | analyze | test"
    }
  ],
  "filesAffected": ["list", "of", "all", "files"],
  "risks": ["potential risk or concern"]
}

Be thorough in your analysis. Think about dependencies between steps, potential breaking changes, and test coverage. Do NOT include any code in your response - only the plan.`

export const CODER_SYSTEM_PROMPT = `You are a coder. Implement the following plan exactly. Write the code.

Guidelines:
1. Follow the plan step by step in the specified order.
2. Write clean, well-structured code that matches existing project conventions.
3. Include appropriate error handling.
4. Do not deviate from the plan unless you identify a critical issue, in which case note the deviation clearly.
5. For each file change, show the complete file content or a clear diff.

You will receive a plan and the original task. Implement accordingly.`

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ArchitectConfig = {
  enabled: false,
  architectModel: 'claude-sonnet-4-20250514',
  coderModel: 'claude-sonnet-4-20250514',
  autoApply: false,
}

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

function parsePlan(raw: string): ArchitectPlan {
  // Try to extract JSON from the response.  The model might wrap it in
  // markdown fences or include preamble text -- handle that gracefully.
  let jsonStr = raw.trim()

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!.trim()
  }

  // If the response starts with non-JSON text, try to find the first `{`
  const firstBrace = jsonStr.indexOf('{')
  const lastBrace = jsonStr.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1)
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>

    const steps: ArchitectStep[] = Array.isArray(parsed.steps)
      ? (parsed.steps as Record<string, unknown>[]).map((s, i) => ({
          order: typeof s.order === 'number' ? s.order : i + 1,
          description: String(s.description ?? ''),
          file: typeof s.file === 'string' ? s.file : undefined,
          type: validateStepType(s.type),
        }))
      : []

    return {
      summary: String(parsed.summary ?? ''),
      approach: String(parsed.approach ?? ''),
      steps,
      filesAffected: Array.isArray(parsed.filesAffected)
        ? (parsed.filesAffected as unknown[]).map(String)
        : [],
      risks: Array.isArray(parsed.risks)
        ? (parsed.risks as unknown[]).map(String)
        : [],
    }
  } catch {
    // If JSON parsing fails, construct a best-effort plan from the raw text
    return {
      summary: 'Plan could not be parsed as structured JSON',
      approach: raw,
      steps: [],
      filesAffected: [],
      risks: ['Plan response was not valid JSON and could not be parsed.'],
    }
  }
}

const VALID_STEP_TYPES = new Set([
  'create',
  'modify',
  'delete',
  'analyze',
  'test',
] as const)

function validateStepType(
  value: unknown,
): 'create' | 'modify' | 'delete' | 'analyze' | 'test' {
  if (typeof value === 'string' && VALID_STEP_TYPES.has(value as never)) {
    return value as ArchitectStep['type']
  }
  return 'modify'
}

// ---------------------------------------------------------------------------
// ArchitectMode class
// ---------------------------------------------------------------------------

export class ArchitectMode {
  private _config: ArchitectConfig

  constructor(config?: Partial<ArchitectConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config }
  }

  // -- Config accessors -----------------------------------------------------

  getConfig(): Readonly<ArchitectConfig> {
    return { ...this._config }
  }

  setConfig(partial: Partial<ArchitectConfig>): void {
    this._config = { ...this._config, ...partial }
  }

  // -- Planning phase -------------------------------------------------------

  /**
   * Send the task to the architect model and return a structured plan.
   *
   * The actual model call is abstracted behind a simple message-in /
   * message-out signature so that callers can supply their own transport
   * (direct API call, sub-agent, etc.).  When no `sendMessage` override is
   * provided the method builds the prompt and returns it for the caller to
   * dispatch.
   */
  async planTask(
    task: string,
    context: string,
    sendMessage?: (
      systemPrompt: string,
      userMessage: string,
      model: string,
    ) => Promise<string>,
  ): Promise<ArchitectPlan> {
    const systemPrompt = this._config.planPrompt ?? ARCHITECT_SYSTEM_PROMPT

    const userMessage = [
      '## Task',
      task,
      '',
      '## Context',
      context,
    ].join('\n')

    if (sendMessage) {
      const raw = await sendMessage(
        systemPrompt,
        userMessage,
        this._config.architectModel,
      )
      return parsePlan(raw)
    }

    // Without a transport we cannot call the model, so return an empty plan
    // with the prompts embedded for the caller to use.
    return {
      summary: '(plan not executed - no message transport provided)',
      approach: userMessage,
      steps: [],
      filesAffected: [],
      risks: [],
    }
  }

  // -- Implementation phase -------------------------------------------------

  /**
   * Send the plan and original task to the coder model.
   */
  async executePlan(
    plan: ArchitectPlan,
    task: string,
    sendMessage?: (
      systemPrompt: string,
      userMessage: string,
      model: string,
    ) => Promise<string>,
  ): Promise<string> {
    const userMessage = [
      '## Original Task',
      task,
      '',
      '## Implementation Plan',
      this.formatPlan(plan),
    ].join('\n')

    if (sendMessage) {
      return sendMessage(
        CODER_SYSTEM_PROMPT,
        userMessage,
        this._config.coderModel,
      )
    }

    return '(execution not performed - no message transport provided)'
  }

  // -- Full pipeline --------------------------------------------------------

  /**
   * Run the full architect pipeline: plan then execute.
   */
  async run(
    task: string,
    context: string,
    sendMessage?: (
      systemPrompt: string,
      userMessage: string,
      model: string,
    ) => Promise<string>,
  ): Promise<{ plan: ArchitectPlan; result: string }> {
    const plan = await this.planTask(task, context, sendMessage)
    const result = await this.executePlan(plan, task, sendMessage)
    return { plan, result }
  }

  // -- Formatting -----------------------------------------------------------

  /**
   * Format an ArchitectPlan as a human-readable markdown string.
   */
  formatPlan(plan: ArchitectPlan): string {
    const lines: string[] = []

    lines.push(`# ${plan.summary}`)
    lines.push('')
    lines.push('## Approach')
    lines.push(plan.approach)
    lines.push('')

    if (plan.steps.length > 0) {
      lines.push('## Steps')
      for (const step of plan.steps) {
        const fileNote = step.file ? ` (\`${step.file}\`)` : ''
        lines.push(
          `${step.order}. **[${step.type}]** ${step.description}${fileNote}`,
        )
      }
      lines.push('')
    }

    if (plan.filesAffected.length > 0) {
      lines.push('## Files Affected')
      for (const f of plan.filesAffected) {
        lines.push(`- \`${f}\``)
      }
      lines.push('')
    }

    if (plan.risks.length > 0) {
      lines.push('## Risks')
      for (const r of plan.risks) {
        lines.push(`- ${r}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }
}

// ---------------------------------------------------------------------------
// Singleton convenience
// ---------------------------------------------------------------------------

let _instance: ArchitectMode | undefined

export function getArchitectMode(): ArchitectMode {
  if (!_instance) {
    _instance = new ArchitectMode()
  }
  return _instance
}

export function resetArchitectMode(): void {
  _instance = undefined
}
