/**
 * Agent Orchestrator — Task decomposition, dispatch, and collection.
 *
 * Design principles from 10x Core:
 * - Single responsibility: each subtask is self-contained
 * - Observable: every step is logged and trackable
 * - Resilient: failed subtasks can be retried independently
 * - Composable: agents are matched to subtasks by capability
 *
 * Uses only Node.js built-ins.
 */

import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubtaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed'

export type Subtask = {
  id: string
  description: string
  status: SubtaskStatus
  assignedAgent?: string
  dependencies: string[]
  result?: string
  error?: string
  retryCount: number
  maxRetries: number
  tokenUsage: number
  startedAt?: string
  completedAt?: string
}

export type OrchestrationPlan = {
  id: string
  instruction: string
  subtasks: Subtask[]
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  completedAt?: string
  totalTokens: number
}

export type AgentAssignment = {
  subtaskId: string
  agentTemplate: string
  reason: string
}

// ---------------------------------------------------------------------------
// Agent matching keywords → template
// ---------------------------------------------------------------------------

const AGENT_KEYWORDS: Record<string, string[]> = {
  'test-writer': ['test', 'spec', 'coverage', 'jest', 'vitest', 'mocha', 'assert'],
  'code-reviewer': ['review', 'audit', 'check', 'quality', 'lint'],
  'debugger': ['debug', 'fix', 'error', 'bug', 'crash', 'issue', 'broken'],
  'refactorer': ['refactor', 'clean', 'optimize', 'restructure', 'simplify', 'DRY'],
  'documentarian': ['doc', 'readme', 'comment', 'jsdoc', 'explain', 'document'],
  'security-auditor': ['security', 'vuln', 'auth', 'injection', 'XSS', 'OWASP', 'CVE'],
  'architect': ['design', 'architecture', 'plan', 'structure', 'scalab', 'system'],
  'performance': ['perf', 'speed', 'benchmark', 'slow', 'memory', 'profil', 'latency'],
}

function matchAgentTemplate(description: string): { template: string; reason: string } {
  const lower = description.toLowerCase()
  let bestMatch = 'code-reviewer'
  let bestCount = 0
  let bestReason = 'Default assignment'

  for (const [template, keywords] of Object.entries(AGENT_KEYWORDS)) {
    const matchCount = keywords.filter(k => lower.includes(k)).length
    if (matchCount > bestCount) {
      bestCount = matchCount
      bestMatch = template
      bestReason = `Matched keywords: ${keywords.filter(k => lower.includes(k)).join(', ')}`
    }
  }

  return { template: bestMatch, reason: bestReason }
}

// ---------------------------------------------------------------------------
// Task Decomposition
// ---------------------------------------------------------------------------

const ACTION_VERBS = [
  'fix', 'add', 'create', 'update', 'remove', 'delete', 'refactor',
  'test', 'review', 'document', 'optimize', 'debug', 'implement',
  'migrate', 'upgrade', 'configure', 'deploy', 'build', 'setup',
]

function decomposeInstruction(instruction: string): Subtask[] {
  const subtasks: Subtask[] = []

  // Strategy 1: Split by explicit list markers (numbered, bullets)
  const listPattern = /(?:^|\n)\s*(?:\d+[.)]\s*|-\s*|\*\s*)/
  const listItems = instruction.split(listPattern).map(s => s.trim()).filter(Boolean)

  if (listItems.length > 1) {
    for (const item of listItems) {
      subtasks.push(createSubtask(item))
    }
  } else {
    // Strategy 2: Split by "and", "then", semicolons, or action verb boundaries
    const sentences = instruction
      .split(/(?:\s+and\s+|\s+then\s+|;\s*|\.\s+)/)
      .map(s => s.trim())
      .filter(s => s.length > 5)

    if (sentences.length > 1) {
      for (const sentence of sentences) {
        subtasks.push(createSubtask(sentence))
      }
    } else {
      // Strategy 3: Single complex instruction — create analysis + implementation + verification
      subtasks.push(createSubtask(`Analyze: ${instruction}`, []))
      subtasks.push(createSubtask(`Implement: ${instruction}`, [subtasks[0].id]))
      subtasks.push(createSubtask(`Verify and test: ${instruction}`, [subtasks[1].id]))
    }
  }

  // Auto-detect dependencies: if a subtask mentions "test" and there's an "implement" subtask, add dependency
  for (let i = 0; i < subtasks.length; i++) {
    const lower = subtasks[i].description.toLowerCase()
    if ((lower.includes('test') || lower.includes('verify')) && i > 0) {
      // Depend on the previous implementation subtask
      const implIdx = subtasks.findIndex((s, j) => j < i && (s.description.toLowerCase().includes('implement') || s.description.toLowerCase().includes('add') || s.description.toLowerCase().includes('create')))
      if (implIdx >= 0 && !subtasks[i].dependencies.includes(subtasks[implIdx].id)) {
        subtasks[i].dependencies.push(subtasks[implIdx].id)
      }
    }
  }

  return subtasks
}

function createSubtask(description: string, deps: string[] = []): Subtask {
  return {
    id: randomUUID().slice(0, 8),
    description,
    status: 'pending',
    dependencies: deps,
    retryCount: 0,
    maxRetries: 2,
    tokenUsage: 0,
  }
}

// ---------------------------------------------------------------------------
// AgentOrchestrator
// ---------------------------------------------------------------------------

const STORE_DIR = join(homedir(), '.void', 'orchestrator')

export class AgentOrchestrator {
  private plans: Map<string, OrchestrationPlan> = new Map()

  constructor() {
    this.loadPlans()
  }

  // -- Core operations --

  decompose(instruction: string): OrchestrationPlan {
    const subtasks = decomposeInstruction(instruction)
    const plan: OrchestrationPlan = {
      id: randomUUID().slice(0, 8),
      instruction,
      subtasks,
      status: 'planning',
      createdAt: new Date().toISOString(),
      totalTokens: 0,
    }
    this.plans.set(plan.id, plan)
    this.savePlan(plan)
    return plan
  }

  assignAgents(planId: string): AgentAssignment[] {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)

    const assignments: AgentAssignment[] = []
    for (const st of plan.subtasks) {
      const { template, reason } = matchAgentTemplate(st.description)
      st.assignedAgent = template
      st.status = 'assigned'
      assignments.push({ subtaskId: st.id, agentTemplate: template, reason })
    }
    this.savePlan(plan)
    return assignments
  }

  execute(planId: string): OrchestrationPlan {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)

    plan.status = 'executing'

    // Find subtasks with no pending dependencies
    const ready = plan.subtasks.filter(st =>
      st.status === 'assigned' &&
      st.dependencies.every(depId => {
        const dep = plan.subtasks.find(s => s.id === depId)
        return dep?.status === 'completed'
      })
    )

    // Start ready subtasks
    for (const st of ready) {
      st.status = 'running'
      st.startedAt = new Date().toISOString()
    }

    this.savePlan(plan)
    return plan
  }

  completeSubtask(planId: string, subtaskId: string, result: string, tokens = 0): void {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)
    const st = plan.subtasks.find(s => s.id === subtaskId)
    if (!st) throw new Error(`Subtask ${subtaskId} not found`)

    st.status = 'completed'
    st.result = result
    st.tokenUsage = tokens
    st.completedAt = new Date().toISOString()
    plan.totalTokens += tokens

    // Check if all done
    if (plan.subtasks.every(s => s.status === 'completed')) {
      plan.status = 'completed'
      plan.completedAt = new Date().toISOString()
    }

    this.savePlan(plan)
  }

  failSubtask(planId: string, subtaskId: string, error: string): void {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)
    const st = plan.subtasks.find(s => s.id === subtaskId)
    if (!st) throw new Error(`Subtask ${subtaskId} not found`)

    st.status = 'failed'
    st.error = error
    st.completedAt = new Date().toISOString()

    // Check if plan should fail
    const hasFailedNonRetriable = plan.subtasks.some(s => s.status === 'failed' && s.retryCount >= s.maxRetries)
    if (hasFailedNonRetriable) plan.status = 'failed'

    this.savePlan(plan)
  }

  retryFailed(planId: string): number {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)

    let retried = 0
    for (const st of plan.subtasks) {
      if (st.status === 'failed' && st.retryCount < st.maxRetries) {
        st.status = 'assigned'
        st.error = undefined
        st.retryCount++
        retried++
      }
    }

    if (retried > 0 && plan.status === 'failed') plan.status = 'executing'
    this.savePlan(plan)
    return retried
  }

  cancel(planId: string): void {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)
    plan.status = 'cancelled'
    for (const st of plan.subtasks) {
      if (st.status === 'running' || st.status === 'assigned' || st.status === 'pending') {
        st.status = 'failed'
        st.error = 'Cancelled'
      }
    }
    this.savePlan(plan)
  }

  collectResults(planId: string): { results: string[]; errors: string[] } {
    const plan = this.getPlan(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)
    return {
      results: plan.subtasks.filter(s => s.result).map(s => `[${s.assignedAgent}] ${s.description}: ${s.result}`),
      errors: plan.subtasks.filter(s => s.error).map(s => `[${s.assignedAgent}] ${s.description}: ${s.error}`),
    }
  }

  // -- Querying --

  getPlan(planId: string): OrchestrationPlan | undefined {
    return this.plans.get(planId)
  }

  listPlans(): OrchestrationPlan[] {
    return Array.from(this.plans.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getMetrics(): { totalPlans: number; completed: number; failed: number; totalTokens: number; avgSubtasks: number } {
    const plans = this.listPlans()
    return {
      totalPlans: plans.length,
      completed: plans.filter(p => p.status === 'completed').length,
      failed: plans.filter(p => p.status === 'failed').length,
      totalTokens: plans.reduce((s, p) => s + p.totalTokens, 0),
      avgSubtasks: plans.length > 0 ? plans.reduce((s, p) => s + p.subtasks.length, 0) / plans.length : 0,
    }
  }

  formatProgress(planId: string): string {
    const plan = this.getPlan(planId)
    if (!plan) return `Plan ${planId} not found`

    const lines: string[] = []
    lines.push(`Orchestration: "${plan.instruction}"`)
    lines.push(`Status: ${plan.status} | Subtasks: ${plan.subtasks.length} | Tokens: ${plan.totalTokens.toLocaleString()}`)
    lines.push('')

    for (const st of plan.subtasks) {
      const icon = st.status === 'completed' ? '✓' : st.status === 'running' ? '→' : st.status === 'failed' ? '✗' : st.status === 'assigned' ? '◌' : '○'
      const agent = st.assignedAgent ? `[${st.assignedAgent}]` : ''
      const deps = st.dependencies.length > 0 ? ` (deps: ${st.dependencies.join(', ')})` : ''
      const retry = st.retryCount > 0 ? ` (retry ${st.retryCount})` : ''
      lines.push(`  ${icon} ${st.id} ${agent} ${st.description}${deps}${retry}`)
      if (st.result) lines.push(`      → ${st.result.slice(0, 80)}`)
      if (st.error) lines.push(`      ✗ ${st.error.slice(0, 80)}`)
    }

    return lines.join('\n')
  }

  // -- Persistence --

  private savePlan(plan: OrchestrationPlan): void {
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(join(STORE_DIR, `${plan.id}.json`), JSON.stringify(plan, null, 2))
  }

  private loadPlans(): void {
    if (!existsSync(STORE_DIR)) return
    for (const f of readdirSync(STORE_DIR)) {
      if (!f.endsWith('.json')) continue
      try {
        const plan = JSON.parse(readFileSync(join(STORE_DIR, f), 'utf8')) as OrchestrationPlan
        this.plans.set(plan.id, plan)
      } catch { /* skip corrupt */ }
    }
  }

  clearAll(): void {
    this.plans.clear()
    if (existsSync(STORE_DIR)) {
      for (const f of readdirSync(STORE_DIR)) {
        try { unlinkSync(join(STORE_DIR, f)) } catch { /* ignore */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: AgentOrchestrator | null = null
export function getAgentOrchestrator(): AgentOrchestrator {
  if (!_instance) _instance = new AgentOrchestrator()
  return _instance
}
