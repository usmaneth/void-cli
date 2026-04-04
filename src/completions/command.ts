/**
 * Registers the `/completion` and `/doctor` slash commands.
 */

import { getOriginalCwd } from '../bootstrap/state.js'
import type { Command, LocalCommandCall } from '../types/command.js'
import { getCompletionScript } from './index.js'
import { runDoctorChecks, type DoctorCheck } from './doctor.js'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<DoctorCheck['status'], string> = {
  pass: '\u2714', // checkmark
  warn: '\u26A0', // warning
  fail: '\u2718', // cross
}

const STATUS_LABELS: Record<DoctorCheck['status'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
}

function formatCheck(check: DoctorCheck): string {
  const icon = STATUS_ICONS[check.status]
  const label = STATUS_LABELS[check.status]
  let line = `  ${icon} [${label}] ${check.name}: ${check.message}`
  if (check.fix) {
    line += `\n           Fix: ${check.fix}`
  }
  return line
}

// ---------------------------------------------------------------------------
// /completion command
// ---------------------------------------------------------------------------

const completionCall: LocalCommandCall = async (args) => {
  const shell = args.trim().toLowerCase()

  if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish') {
    return {
      type: 'text' as const,
      value:
        'Usage: /completion <bash|zsh|fish>\n\nOutput a shell completion script for the specified shell.',
    }
  }

  const script = getCompletionScript(shell)
  return { type: 'text' as const, value: script }
}

export const completionCommand = {
  type: 'local',
  name: 'completion',
  description: 'Output shell completion script (bash, zsh, or fish)',
  argumentHint: '<bash|zsh|fish>',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call: completionCall }),
} satisfies Command

// ---------------------------------------------------------------------------
// /doctor command  (standalone diagnostics — complements the existing Doctor UI)
// ---------------------------------------------------------------------------

const doctorCall: LocalCommandCall = async (_args) => {
  const cwd = getOriginalCwd() ?? process.cwd()
  const checks = await runDoctorChecks(cwd)

  const lines: string[] = ['', 'Void Doctor', '==========', '']

  for (const check of checks) {
    lines.push(formatCheck(check))
  }

  const passed = checks.filter((c) => c.status === 'pass').length
  const warned = checks.filter((c) => c.status === 'warn').length
  const failed = checks.filter((c) => c.status === 'fail').length

  lines.push('')
  lines.push(
    `Summary: ${passed} passed, ${warned} warnings, ${failed} failures`,
  )

  if (failed > 0) {
    lines.push('')
    lines.push('Fix the failures above to ensure Void works correctly.')
  }

  lines.push('')

  return { type: 'text' as const, value: lines.join('\n') }
}

export const doctorDiagCommand = {
  type: 'local',
  name: 'doctor-diag',
  aliases: ['diag'],
  description: 'Run diagnostic checks on your Void environment',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call: doctorCall }),
} satisfies Command
