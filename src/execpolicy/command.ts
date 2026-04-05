import type { Command } from '../types/command.js'
import type { LocalCommandCall, LocalCommandResult } from '../types/command.js'
import { getExecPolicyManager, type Decision, type PolicyRule } from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

function formatRule(rule: PolicyRule, index: number): string {
  const pattern = rule.pattern.join(' ')
  const justification = rule.justification ? ` — ${rule.justification}` : ''
  return `  [${index}] ${rule.decision.toUpperCase().padEnd(9)} ${pattern}${justification}`
}

function parseArgs(raw: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true
      quoteChar = ch
      continue
    }
    if (inQuote && ch === quoteChar) {
      inQuote = false
      continue
    }
    if (!inQuote && (ch === ' ' || ch === '\t')) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) {
    args.push(current)
  }
  return args
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function showSummary(): LocalCommandResult {
  const mgr = getExecPolicyManager()
  return text(mgr.summary())
}

function checkCommand(rest: string): LocalCommandResult {
  if (!rest.trim()) {
    return text('Usage: /execpolicy check <command>\nExample: /execpolicy check rm -rf /')
  }
  const mgr = getExecPolicyManager()
  const result = mgr.checkCommand(rest.trim())
  const lines = [`Command: ${rest.trim()}`, `Decision: ${result.decision.toUpperCase()}`]
  if (result.rule) {
    lines.push(`Matched rule pattern: ${result.rule.pattern.join(' ')}`)
  }
  if (result.justification) {
    lines.push(`Justification: ${result.justification}`)
  }
  return text(lines.join('\n'))
}

function listRules(): LocalCommandResult {
  const mgr = getExecPolicyManager()
  const rules = mgr.listRules()
  if (rules.length === 0) {
    return text('No rules loaded.')
  }

  const lines = [`ExecPolicy rules (${rules.length} total):\n`]
  for (let i = 0; i < rules.length; i++) {
    lines.push(formatRule(rules[i]!, i))
  }
  return text(lines.join('\n'))
}

function addRule(rest: string): LocalCommandResult {
  const parts = parseArgs(rest)
  if (parts.length < 2) {
    return text(
      'Usage: /execpolicy add <allow|prompt|forbidden> <pattern...> [-- justification]\n' +
        'Example: /execpolicy add forbidden sudo * -- Privileged commands not allowed',
    )
  }

  const decision = parts[0]! as string
  if (decision !== 'allow' && decision !== 'prompt' && decision !== 'forbidden') {
    return text(`Invalid decision "${decision}". Must be one of: allow, prompt, forbidden`)
  }

  // Split on `--` to separate pattern from justification
  const dashIndex = parts.indexOf('--')
  let patternParts: string[]
  let justification: string | undefined

  if (dashIndex > 1) {
    patternParts = parts.slice(1, dashIndex)
    justification = parts.slice(dashIndex + 1).join(' ') || undefined
  } else {
    patternParts = parts.slice(1)
  }

  const rule: PolicyRule = {
    pattern: patternParts,
    decision: decision as Decision,
  }
  if (justification) {
    rule.justification = justification
  }

  const mgr = getExecPolicyManager()
  mgr.addRule(rule)

  return text(`Added rule: ${decision.toUpperCase()} ${patternParts.join(' ')}${justification ? ` (${justification})` : ''}`)
}

function removeRule(rest: string): LocalCommandResult {
  const index = parseInt(rest.trim(), 10)
  if (isNaN(index)) {
    return text('Usage: /execpolicy remove <index>\nUse /execpolicy list to see rule indices.')
  }

  const mgr = getExecPolicyManager()
  const removed = mgr.removeRule(index)
  if (!removed) {
    return text(`No rule at index ${index}. Use /execpolicy list to see valid indices.`)
  }

  return text(`Removed rule [${index}]: ${removed.decision.toUpperCase()} ${removed.pattern.join(' ')}`)
}

function resetRules(): LocalCommandResult {
  const mgr = getExecPolicyManager()
  mgr.reset()
  return text('Policy reset to built-in defaults.')
}

function initProject(): LocalCommandResult {
  const mgr = getExecPolicyManager()
  const path = mgr.initProject()
  return text(`Created project policy file at ${path}`)
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const call: LocalCommandCall = async (
  args,
  _context,
): Promise<LocalCommandResult> => {
  const trimmed = args.trim()

  if (!trimmed) {
    return showSummary()
  }

  // Split into subcommand and the rest
  const spaceIdx = trimmed.indexOf(' ')
  const subcommand = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)

  switch (subcommand) {
    case 'check':
      return checkCommand(rest)
    case 'list':
      return listRules()
    case 'add':
      return addRule(rest)
    case 'remove':
      return removeRule(rest)
    case 'reset':
      return resetRules()
    case 'init':
      return initProject()
    default:
      return text(
        `Unknown subcommand "${subcommand}".\n` +
          'Available: check, list, add, remove, reset, init',
      )
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const execpolicy = {
  type: 'local',
  name: 'execpolicy',
  description: 'Manage command approval policies',
  argumentHint: '<check|list|add|remove|reset|init> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default execpolicy
