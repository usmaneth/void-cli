/**
 * /clarify slash command — control the pre-generation clarification system.
 *
 *   /clarify             — toggle clarification mode on/off
 *   /clarify on|off      — explicit enable/disable
 *   /clarify analyze ... — show ambiguity analysis for a message
 *   /clarify threshold N — set ambiguity threshold (0-100)
 *   /clarify status      — show current config
 */
import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import {
  AmbiguityAnalyzer,
  getClarificationManager,
} from './index.js'

const call: LocalCommandCall = async (args) => {
  const manager = getClarificationManager()
  const trimmed = args.trim()
  const parts = trimmed.split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''

  // --- /clarify (no args) — toggle ---
  if (!subcommand) {
    const nowEnabled = manager.toggle()
    return {
      type: 'text',
      value: `Clarification mode ${nowEnabled ? 'enabled' : 'disabled'}.`,
    }
  }

  // --- /clarify on ---
  if (subcommand === 'on') {
    manager.enable()
    return { type: 'text', value: 'Clarification mode enabled.' }
  }

  // --- /clarify off ---
  if (subcommand === 'off') {
    manager.disable()
    return { type: 'text', value: 'Clarification mode disabled.' }
  }

  // --- /clarify status ---
  if (subcommand === 'status') {
    const config = manager.getConfig()
    const lines = [
      'Clarification System Status',
      '---',
      `  Enabled:    ${config.enabled ? 'yes' : 'no'}`,
      `  Threshold:  ${config.triggerThreshold}`,
      `  Max Qs:     ${config.maxQuestions}`,
      `  Skip:       ${config.skipPatterns.length > 0 ? config.skipPatterns.join(', ') : '(none)'}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  // --- /clarify threshold <number> ---
  if (subcommand === 'threshold') {
    const raw = parts[1]
    if (!raw) {
      return {
        type: 'text',
        value: `Current threshold: ${manager.getConfig().triggerThreshold}\nUsage: /clarify threshold <0-100>`,
      }
    }
    const num = parseInt(raw, 10)
    if (isNaN(num) || num < 0 || num > 100) {
      return {
        type: 'text',
        value: 'Threshold must be a number between 0 and 100.',
      }
    }
    manager.setConfig({ triggerThreshold: num })
    return {
      type: 'text',
      value: `Ambiguity threshold set to ${num}.`,
    }
  }

  // --- /clarify analyze <message> ---
  if (subcommand === 'analyze') {
    const messageToAnalyze = parts.slice(1).join(' ').trim()
    if (!messageToAnalyze) {
      return {
        type: 'text',
        value: 'Usage: /clarify analyze <message>',
      }
    }

    const analyzer = new AmbiguityAnalyzer()
    const result = analyzer.analyze(messageToAnalyze)

    const lines: string[] = [
      'Ambiguity Analysis',
      '---',
      `  Message:  "${messageToAnalyze}"`,
      `  Score:    ${result.score}/100`,
      '',
    ]

    if (result.reasons.length > 0) {
      lines.push('  Reasons:')
      for (const reason of result.reasons) {
        lines.push(`    - ${reason}`)
      }
    } else {
      lines.push('  No ambiguity detected.')
    }

    if (result.suggestedQuestions.length > 0) {
      lines.push('')
      lines.push('  Suggested Questions:')
      for (const q of result.suggestedQuestions) {
        lines.push(`    - ${q}`)
      }
    }

    const threshold = manager.getConfig().triggerThreshold
    lines.push('')
    lines.push(
      result.score > threshold
        ? `  Would trigger clarification (score ${result.score} > threshold ${threshold}).`
        : `  Would NOT trigger clarification (score ${result.score} <= threshold ${threshold}).`,
    )

    return { type: 'text', value: lines.join('\n') }
  }

  // --- Unknown subcommand ---
  return {
    type: 'text',
    value: [
      `Unknown subcommand: "${subcommand}"`,
      '',
      'Usage:',
      '  /clarify            — toggle on/off',
      '  /clarify on|off     — explicit enable/disable',
      '  /clarify analyze .. — show ambiguity analysis',
      '  /clarify threshold  — set ambiguity threshold',
      '  /clarify status     — show current config',
    ].join('\n'),
  }
}

const clarify = {
  type: 'local',
  name: 'clarify',
  description: 'Control pre-generation clarification mode',
  argumentHint: '[on|off|analyze|threshold|status]',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default clarify
