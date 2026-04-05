/**
 * /think slash command for toggling and configuring thinking mode.
 *
 * Usage:
 *   /think           — toggle thinking mode on/off
 *   /think on|off    — explicit enable/disable
 *   /think budget N  — set token budget to N
 *   /think auto      — toggle auto-thinking for complex queries
 *   /think status    — show current config and last complexity analysis
 */

import type { Command } from '../types/command.js'
import type { LocalCommandModule } from '../types/command.js'
import { getThinkingMode } from './index.js'

function formatStatus(): string {
  const tm = getThinkingMode()
  const config = tm.getConfig()
  const lines: string[] = [
    'Thinking mode configuration:',
    `  enabled:             ${config.enabled ? 'on' : 'off'}`,
    `  budgetTokens:        ${config.budgetTokens}`,
    `  showThinking:        ${config.showThinking ? 'yes' : 'no'}`,
    `  autoThink:           ${config.autoThink ? 'on' : 'off'}`,
    `  complexityThreshold: ${config.complexityThreshold} words`,
  ]

  const lastAnalysis = tm.lastAnalysis
  if (lastAnalysis) {
    lines.push('')
    lines.push(`Last complexity analysis (score: ${lastAnalysis.score}/100):`)
    for (const reason of lastAnalysis.reasons) {
      lines.push(`  - ${reason}`)
    }
  }

  return lines.join('\n')
}

const call: LocalCommandModule['call'] = async (args: string) => {
  const tm = getThinkingMode()
  const trimmed = args.trim().toLowerCase()

  // /think (no args) — toggle
  if (!trimmed) {
    const newState = tm.toggle()
    return {
      type: 'text' as const,
      value: `Thinking mode ${newState ? 'enabled' : 'disabled'}.`,
    }
  }

  // /think on
  if (trimmed === 'on') {
    tm.enable()
    return { type: 'text' as const, value: 'Thinking mode enabled.' }
  }

  // /think off
  if (trimmed === 'off') {
    tm.disable()
    return { type: 'text' as const, value: 'Thinking mode disabled.' }
  }

  // /think auto
  if (trimmed === 'auto') {
    const config = tm.getConfig()
    const newAutoThink = !config.autoThink
    tm.setConfig({ autoThink: newAutoThink })
    return {
      type: 'text' as const,
      value: `Auto-thinking ${newAutoThink ? 'enabled' : 'disabled'}. Complex queries will ${newAutoThink ? 'automatically' : 'not'} trigger thinking mode.`,
    }
  }

  // /think status
  if (trimmed === 'status') {
    return { type: 'text' as const, value: formatStatus() }
  }

  // /think budget <tokens>
  if (trimmed.startsWith('budget')) {
    const budgetArg = trimmed.slice('budget'.length).trim()
    const tokens = parseInt(budgetArg, 10)
    if (isNaN(tokens) || tokens < 1) {
      return {
        type: 'text' as const,
        value: 'Usage: /think budget <tokens> — tokens must be a positive integer.',
      }
    }
    try {
      tm.setBudget(tokens)
      return {
        type: 'text' as const,
        value: `Thinking token budget set to ${tokens}.`,
      }
    } catch (err) {
      return {
        type: 'text' as const,
        value: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  return {
    type: 'text' as const,
    value: [
      `Unknown argument: "${args.trim()}"`,
      '',
      'Usage:',
      '  /think          — toggle thinking mode on/off',
      '  /think on|off   — explicit enable/disable',
      '  /think budget N — set token budget to N',
      '  /think auto     — toggle auto-thinking for complex queries',
      '  /think status   — show current config',
    ].join('\n'),
  }
}

const think = {
  type: 'local',
  name: 'think',
  description: 'Toggle or configure thinking mode for extended reasoning',
  argumentHint: '[on|off|auto|status|budget <n>]',
  supportsNonInteractive: true,
  load: async (): Promise<LocalCommandModule> => ({ call }),
} satisfies Command

export default think
