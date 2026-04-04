import type { Command, LocalCommandCall } from '../types/command.js'
import {
  getPermissionManager,
  VALID_MODES,
  type PermissionMode,
} from './index.js'

function formatPermissionMatrix(mode: PermissionMode): string {
  const manager = getPermissionManager()
  const matrix = manager.getPermissionMatrix()
  const lines: string[] = [`Permission matrix for "${mode}" mode:`, '']
  const maxToolLen = Math.max(...matrix.map(p => p.tool.length))

  for (const perm of matrix) {
    const toolPadded = perm.tool.padEnd(maxToolLen)
    const status = perm.allowed
      ? perm.requiresConfirmation
        ? 'allowed (requires confirmation)'
        : 'allowed'
      : 'blocked (requires confirmation to proceed)'
    lines.push(`  ${toolPadded}  ${status}`)
  }

  return lines.join('\n')
}

function formatCurrentMode(): string {
  const manager = getPermissionManager()
  const mode = manager.getMode()
  const description = manager.getModeDescription(mode)
  const override = manager.hasProjectOverride()
    ? ' (set by project .void/config.json)'
    : ''

  return `Current mode: ${mode}${override}\n${description}`
}

const call: LocalCommandCall = async (args) => {
  const manager = getPermissionManager()
  const trimmed = args.trim()

  // /mode — show current mode
  if (!trimmed) {
    return { type: 'text', value: formatCurrentMode() }
  }

  // /mode permissions — show permission matrix
  if (trimmed === 'permissions') {
    const mode = manager.getMode()
    return { type: 'text', value: formatPermissionMatrix(mode) }
  }

  // /mode <mode> — switch mode
  if (VALID_MODES.includes(trimmed as PermissionMode)) {
    const newMode = trimmed as PermissionMode
    manager.setMode(newMode)
    const description = manager.getModeDescription(newMode)
    return {
      type: 'text',
      value: `Switched to "${newMode}" mode.\n${description}`,
    }
  }

  // Unknown argument
  const validOptions = [...VALID_MODES, 'permissions'].join(', ')
  return {
    type: 'text',
    value: `Unknown argument: "${trimmed}"\nUsage: /mode [${validOptions}]`,
  }
}

const mode = {
  type: 'local',
  name: 'mode',
  description: 'View or change the permission mode (suggest, auto-edit, full-auto)',
  argumentHint: '[suggest|auto-edit|full-auto|permissions]',
  supportsNonInteractive: true,
  immediate: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default mode
