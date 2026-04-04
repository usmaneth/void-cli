/**
 * /architect slash command
 *
 * Usage:
 *   /architect on|off           - toggle architect mode
 *   /architect config           - show current config
 *   /architect model <role> <m> - set model for architect or coder role
 *   /architect plan <task>      - plan a task without executing
 */

import type { LocalCommandCall } from '../types/command.js'
import type { Command } from '../commands.js'
import { getArchitectMode } from './index.js'

export const call: LocalCommandCall = async (args) => {
  const architect = getArchitectMode()
  const trimmed = args.trim()

  // No args -> show status
  if (!trimmed) {
    const config = architect.getConfig()
    const status = config.enabled ? 'ON' : 'OFF'
    return {
      type: 'text',
      value: `Architect mode is ${status}. Use /architect on|off to toggle, /architect config for details.`,
    }
  }

  const parts = trimmed.split(/\s+/)
  const subcommand = parts[0]!.toLowerCase()

  // -- on / off -------------------------------------------------------------
  if (subcommand === 'on') {
    architect.setConfig({ enabled: true })
    return {
      type: 'text',
      value: 'Architect mode enabled. Tasks will be planned before implementation.',
    }
  }

  if (subcommand === 'off') {
    architect.setConfig({ enabled: false })
    return {
      type: 'text',
      value: 'Architect mode disabled.',
    }
  }

  // -- config ---------------------------------------------------------------
  if (subcommand === 'config') {
    const config = architect.getConfig()
    const lines = [
      'Architect Mode Configuration:',
      `  enabled:        ${config.enabled}`,
      `  architectModel: ${config.architectModel}`,
      `  coderModel:     ${config.coderModel}`,
      `  autoApply:      ${config.autoApply}`,
      `  planPrompt:     ${config.planPrompt ? '(custom)' : '(default)'}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  // -- model <architect|coder> <model-name> ---------------------------------
  if (subcommand === 'model') {
    const role = parts[1]?.toLowerCase()
    const modelName = parts[2]

    if (!role || !modelName) {
      return {
        type: 'text',
        value:
          'Usage: /architect model <architect|coder> <model-name>\n\nExample:\n  /architect model architect claude-sonnet-4-20250514\n  /architect model coder claude-sonnet-4-20250514',
      }
    }

    if (role === 'architect') {
      architect.setConfig({ architectModel: modelName })
      return {
        type: 'text',
        value: `Architect model set to: ${modelName}`,
      }
    }

    if (role === 'coder') {
      architect.setConfig({ coderModel: modelName })
      return {
        type: 'text',
        value: `Coder model set to: ${modelName}`,
      }
    }

    return {
      type: 'text',
      value: `Unknown role "${role}". Use "architect" or "coder".`,
    }
  }

  // -- plan <task> ----------------------------------------------------------
  if (subcommand === 'plan') {
    const task = parts.slice(1).join(' ')
    if (!task) {
      return {
        type: 'text',
        value: 'Usage: /architect plan <task description>',
      }
    }

    // Plan without a transport - returns the formatted plan structure.
    // In a full integration the caller would wire up sendMessage to the
    // model API, but here we generate the plan request and show what
    // would be sent to the architect model.
    const plan = await architect.planTask(task, '')

    if (plan.steps.length > 0) {
      return { type: 'text', value: architect.formatPlan(plan) }
    }

    // No transport was provided - show the user what will happen
    return {
      type: 'text',
      value: [
        'Architect plan request prepared. In a full pipeline the following',
        'would be sent to the architect model:',
        '',
        `  Model: ${architect.getConfig().architectModel}`,
        `  Task:  ${task}`,
        '',
        'To execute, ensure a message transport is configured.',
      ].join('\n'),
    }
  }

  // -- unknown subcommand ---------------------------------------------------
  return {
    type: 'text',
    value: [
      `Unknown subcommand "${subcommand}".`,
      '',
      'Usage:',
      '  /architect on|off                        - toggle architect mode',
      '  /architect config                        - show current config',
      '  /architect model <architect|coder> <name> - set model for a role',
      '  /architect plan <task>                    - plan without executing',
    ].join('\n'),
  }
}

const architect = {
  type: 'local',
  name: 'architect',
  description:
    'Toggle architect mode (two-model pipeline: plan then implement)',
  supportsNonInteractive: false,
  argumentHint: '[on|off|config|model|plan] [...]',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default architect
