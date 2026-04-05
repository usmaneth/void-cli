/**
 * /orchestrate slash command — auto-decompose and dispatch tasks to agents.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getAgentOrchestrator } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const orch = getAgentOrchestrator()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'status') {
    const planId = parts[1]
    if (planId) {
      return { type: 'text', value: orch.formatProgress(planId) }
    }
    // Show most recent plan
    const plans = orch.listPlans()
    if (plans.length === 0) return { type: 'text', value: 'No orchestration plans. Use /orchestrate <instruction> to create one.' }
    return { type: 'text', value: orch.formatProgress(plans[0].id) }
  }

  if (sub === 'plans') {
    const plans = orch.listPlans()
    if (plans.length === 0) return { type: 'text', value: 'No orchestration plans.' }
    const lines = ['Orchestration Plans:', '']
    for (const p of plans.slice(0, 10)) {
      const done = p.subtasks.filter(s => s.status === 'completed').length
      lines.push(`  ${p.id} [${p.status}] ${done}/${p.subtasks.length} — "${p.instruction.slice(0, 50)}"`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'collect') {
    const planId = parts[1] ?? orch.listPlans()[0]?.id
    if (!planId) return { type: 'text', value: 'No plans to collect from.' }
    const { results, errors } = orch.collectResults(planId)
    const lines = ['Collected Results:', ...results.map(r => `  ✓ ${r}`)]
    if (errors.length > 0) {
      lines.push('', 'Errors:', ...errors.map(e => `  ✗ ${e}`))
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'retry') {
    const planId = parts[1] ?? orch.listPlans()[0]?.id
    if (!planId) return { type: 'text', value: 'No plans to retry.' }
    const count = orch.retryFailed(planId)
    return { type: 'text', value: count > 0 ? `Retrying ${count} failed subtask(s).` : 'No retriable failed subtasks.' }
  }

  if (sub === 'cancel') {
    const planId = parts[1] ?? orch.listPlans()[0]?.id
    if (!planId) return { type: 'text', value: 'No plans to cancel.' }
    orch.cancel(planId)
    return { type: 'text', value: `Plan ${planId} cancelled.` }
  }

  if (sub === 'clear') {
    orch.clearAll()
    return { type: 'text', value: 'All orchestration plans cleared.' }
  }

  if (sub === 'metrics') {
    const m = orch.getMetrics()
    return { type: 'text', value: `Orchestration Metrics:\n  Plans: ${m.totalPlans} (${m.completed} completed, ${m.failed} failed)\n  Tokens: ${m.totalTokens.toLocaleString()}\n  Avg subtasks: ${m.avgSubtasks.toFixed(1)}` }
  }

  // Default: decompose and execute
  if (!args.trim()) return { type: 'text', value: 'Usage: /orchestrate <instruction>\nOr: /orchestrate <status|plans|collect|retry|cancel|metrics>' }

  const plan = orch.decompose(args.trim())
  const assignments = orch.assignAgents(plan.id)
  orch.execute(plan.id)

  const lines = [
    `Orchestration plan created: ${plan.id}`,
    `Decomposed into ${plan.subtasks.length} subtasks:`,
    '',
  ]
  for (const a of assignments) {
    const st = plan.subtasks.find(s => s.id === a.subtaskId)!
    lines.push(`  ${st.id} → [${a.agentTemplate}] ${st.description}`)
    lines.push(`    Reason: ${a.reason}`)
  }
  lines.push('')
  lines.push(`Use /orchestrate status ${plan.id} to track progress.`)

  return { type: 'text', value: lines.join('\n') }
}

const orchestrate = {
  type: 'local',
  name: 'orchestrate',
  description: 'Auto-decompose and dispatch tasks to specialized agents',
  argumentHint: '<instruction> | <status|plans|collect|retry|cancel|metrics>',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default orchestrate
