/**
 * /mentions slash command — manage @-mention context providers.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getMentionResolver } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const resolver = getMentionResolver()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'test') {
    const input = args.replace(/^\s*test\s+/, '')
    if (!input) {
      return { type: 'text', value: 'Usage: /mentions test <input with @-mentions>' }
    }

    const result = resolver.resolve(input)
    const lines: string[] = [
      `Mentions found: ${result.context.length}`,
      `Estimated tokens: ${result.totalTokensEstimate}`,
      `Clean input: "${result.cleanInput}"`,
      '',
    ]

    for (const resolved of result.context) {
      const m = resolved.mention
      lines.push(`--- @${m.type}${m.arg ? ' ' + m.arg : ''} (${resolved.tokenEstimate} tokens) ---`)
      // Truncate long content for display
      const preview = resolved.content.length > 500
        ? resolved.content.slice(0, 497) + '...'
        : resolved.content
      lines.push(preview)
      lines.push('')
    }

    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'providers') {
    const providers = resolver.listProviders()
    const lines = ['Available @-mention providers:', '']
    for (const p of providers) {
      lines.push(`  @${p.type} — ${p.description}`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  // Default: list available mention types
  const providers = resolver.listProviders()
  const lines = [
    '@-mention context providers',
    '',
    'Usage:',
    '  @file <path>        Include file contents',
    '  @folder <path>      Include directory listing',
    '  @git <ref>          Include git diff/show for a ref',
    '  @errors             Include current lint/build errors',
    '  @recent             Include recently changed files',
    '  @tree               Include project directory tree',
    '',
    `Registered providers: ${providers.length}`,
    '',
    'Subcommands:',
    '  /mentions test <input>    Test mention resolution',
    '  /mentions providers       List registered providers',
  ]
  return { type: 'text', value: lines.join('\n') }
}

const mentions = {
  type: 'local',
  name: 'mentions',
  description: 'Manage @-mention context providers',
  argumentHint: '<test|providers> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default mentions
