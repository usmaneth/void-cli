import * as fs from 'fs'
import * as path from 'path'
import type { Command, LocalCommandCall } from '../types/command.js'
import { getEditGuardrail } from './index.js'

function formatConfig(): string {
  const guardrail = getEditGuardrail()
  const cfg = guardrail.config
  const lines = [
    `Edit Guardrails Configuration`,
    `─────────────────────────────`,
    `  enabled:            ${cfg.enabled}`,
    `  syntaxCheck:        ${cfg.syntaxCheck}`,
    `  lintOnEdit:         ${cfg.lintOnEdit}`,
    `  rejectInvalidEdits: ${cfg.rejectInvalidEdits}`,
    `  maxFileSize:        ${cfg.maxFileSize.toLocaleString()} bytes`,
    `  blockedPaths:       ${cfg.blockedPaths.length === 0 ? '(none)' : ''}`,
  ]
  for (const p of cfg.blockedPaths) {
    lines.push(`    - ${p}`)
  }
  lines.push(
    `  protectedPatterns:  ${cfg.protectedPatterns.length === 0 ? '(none)' : ''}`,
  )
  for (const p of cfg.protectedPatterns) {
    lines.push(`    - ${p}`)
  }
  return lines.join('\n')
}

function formatStatus(): string {
  const guardrail = getEditGuardrail()
  const cfg = guardrail.config
  const status = cfg.enabled ? 'ON' : 'OFF'
  return [
    `Edit Guardrails: ${status}`,
    `  Syntax checking: ${cfg.syntaxCheck ? 'on' : 'off'}`,
    `  Lint on edit:    ${cfg.lintOnEdit ? 'on' : 'off'}`,
    `  Reject invalid:  ${cfg.rejectInvalidEdits ? 'on' : 'off'}`,
    `  Blocked paths:   ${cfg.blockedPaths.length}`,
  ].join('\n')
}

function checkFile(filePath: string): string {
  const guardrail = getEditGuardrail()
  const resolved = path.resolve(filePath)

  if (!fs.existsSync(resolved)) {
    return `File not found: ${resolved}`
  }

  let content: string
  try {
    content = fs.readFileSync(resolved, 'utf-8')
  } catch (err) {
    return `Cannot read file: ${resolved} (${err instanceof Error ? err.message : String(err)})`
  }

  const result = guardrail.checkBeforeEdit(resolved, content)
  const lines = [`Guardrail check for: ${resolved}`, `───`]

  if (result.syntaxValid) {
    lines.push(`Syntax: valid`)
  } else {
    lines.push(`Syntax: INVALID`)
  }

  if (result.errors.length > 0) {
    lines.push(`\nErrors:`)
    for (const e of result.errors) {
      lines.push(`  - ${e}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`\nWarnings:`)
    for (const w of result.warnings) {
      lines.push(`  - ${w}`)
    }
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    lines.push(`No issues found.`)
  }

  return lines.join('\n')
}

const call: LocalCommandCall = async (args: string) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''
  const guardrail = getEditGuardrail()

  switch (subcommand) {
    case '': {
      // /guardrails — show status
      return { type: 'text', value: formatStatus() }
    }

    case 'on': {
      guardrail.config.enabled = true
      return { type: 'text', value: 'Edit guardrails enabled.' }
    }

    case 'off': {
      guardrail.config.enabled = false
      return { type: 'text', value: 'Edit guardrails disabled.' }
    }

    case 'check': {
      const filePath = parts.slice(1).join(' ')
      if (!filePath) {
        return {
          type: 'text',
          value: 'Usage: /guardrails check <file>',
        }
      }
      return { type: 'text', value: checkFile(filePath) }
    }

    case 'block': {
      const blockPath = parts.slice(1).join(' ')
      if (!blockPath) {
        return {
          type: 'text',
          value: 'Usage: /guardrails block <path>',
        }
      }
      guardrail.addBlockedPath(blockPath)
      return {
        type: 'text',
        value: `Blocked: ${path.resolve(blockPath)}`,
      }
    }

    case 'unblock': {
      const unblockPath = parts.slice(1).join(' ')
      if (!unblockPath) {
        return {
          type: 'text',
          value: 'Usage: /guardrails unblock <path>',
        }
      }
      guardrail.removeBlockedPath(unblockPath)
      return {
        type: 'text',
        value: `Unblocked: ${path.resolve(unblockPath)}`,
      }
    }

    case 'config': {
      return { type: 'text', value: formatConfig() }
    }

    default: {
      return {
        type: 'text',
        value: [
          'Usage:',
          '  /guardrails          — show current status',
          '  /guardrails on|off   — toggle guardrails',
          '  /guardrails check <file> — validate a file',
          '  /guardrails block <path> — block a path from edits',
          '  /guardrails unblock <path> — unblock a path',
          '  /guardrails config   — show full configuration',
        ].join('\n'),
      }
    }
  }
}

const guardrailsCommand = {
  type: 'local',
  name: 'guardrails',
  description: 'Manage edit guardrails (syntax checking, blocked paths, linting)',
  supportsNonInteractive: true,
  isEnabled: () => true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default guardrailsCommand
