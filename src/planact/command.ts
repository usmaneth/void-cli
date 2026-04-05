/**
 * /planact slash command implementation.
 *
 * Subcommands:
 *   /planact           - show current mode and plan
 *   /planact plan      - switch to plan mode
 *   /planact act       - switch to act mode
 *   /planact auto      - switch to auto mode
 *   /planact show      - show current plan with step status
 *   /planact step <id> <status> - update step status
 *   /planact add <description>  - add step to plan
 *   /planact clear     - clear current plan
 */

import type { ToolUseContext } from '../Tool.js'
import type { Command } from '../types/command.js'
import type { LocalCommandResult } from '../types/command.js'
import {
  getPlanActManager,
  type PlanActMode,
  type PlanStepStatus,
} from './index.js'

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const manager = getPlanActManager()
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] || ''
  const rest = parts.slice(1).join(' ').trim()

  switch (subcommand) {
    case '':
      return { type: 'text', value: manager.formatFullStatus() }

    case 'plan':
    case 'act':
    case 'auto':
      return handleSetMode(subcommand)

    case 'show':
      return handleShow()

    case 'step':
      return handleStep(parts.slice(1))

    case 'add':
      return handleAdd(rest)

    case 'clear':
      return handleClear()

    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage:',
          '  /planact              Show current mode and plan',
          '  /planact plan         Switch to plan mode (reasoning only)',
          '  /planact act          Switch to act mode (full execution)',
          '  /planact auto         Switch to auto mode (AI decides)',
          '  /planact show         Show current plan with status',
          '  /planact step <id> <status>  Update step (completed/skipped)',
          '  /planact add <desc>   Add a step to the current plan',
          '  /planact clear        Clear the current plan',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleSetMode(mode: PlanActMode): LocalCommandResult {
  const manager = getPlanActManager()
  manager.setMode(mode)

  const descriptions: Record<PlanActMode, string> = {
    plan: 'PLAN mode: reasoning only, no tool execution.',
    act: 'ACT mode: full execution, follows plan steps.',
    auto: 'AUTO mode: AI decides when to plan vs act.',
  }

  return { type: 'text', value: `Switched to ${descriptions[mode]}` }
}

function handleShow(): LocalCommandResult {
  const manager = getPlanActManager()
  const plan = manager.getCurrentPlan()

  if (!plan) {
    return {
      type: 'text',
      value: 'No active plan. Switch to plan mode with /planact plan to create one.',
    }
  }

  return { type: 'text', value: manager.formatPlanForDisplay() }
}

function handleStep(args: string[]): LocalCommandResult {
  const manager = getPlanActManager()

  if (args.length < 2) {
    return {
      type: 'text',
      value: 'Usage: /planact step <id> <completed|skipped|pending|in_progress>',
    }
  }

  const id = parseInt(args[0]!, 10)
  if (isNaN(id)) {
    return { type: 'text', value: `Invalid step id: ${args[0]}` }
  }

  const status = args[1] as string
  const validStatuses: PlanStepStatus[] = [
    'completed',
    'skipped',
    'pending',
    'in_progress',
  ]
  if (!validStatuses.includes(status as PlanStepStatus)) {
    return {
      type: 'text',
      value: `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`,
    }
  }

  const updated = manager.updateStep(id, status as PlanStepStatus)
  if (!updated) {
    return {
      type: 'text',
      value: manager.getCurrentPlan()
        ? `Step ${id} not found in current plan.`
        : 'No active plan.',
    }
  }

  return {
    type: 'text',
    value: `Step ${id} marked as ${status}.\n\n${manager.formatPlanForDisplay()}`,
  }
}

function handleAdd(description: string): LocalCommandResult {
  const manager = getPlanActManager()

  if (!description) {
    return { type: 'text', value: 'Usage: /planact add <step description>' }
  }

  if (!manager.getCurrentPlan()) {
    return {
      type: 'text',
      value: 'No active plan. Switch to plan mode with /planact plan first.',
    }
  }

  const step = manager.addStep(description)
  if (!step) {
    return { type: 'text', value: 'Failed to add step.' }
  }

  return {
    type: 'text',
    value: `Added step ${step.id}: ${step.description}\n\n${manager.formatPlanForDisplay()}`,
  }
}

function handleClear(): LocalCommandResult {
  const manager = getPlanActManager()
  manager.clearPlan()
  return { type: 'text', value: 'Plan cleared.' }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const planact = {
  type: 'local',
  name: 'planact',
  description: 'Toggle between plan and act modes',
  argumentHint: '<plan|act|auto|show|step|add|clear>',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default planact
