import type { LocalCommandCall } from '../../types/command.js'
import { loadSessionInstructions } from '../../services/instructions/inject.js'

export const call: LocalCommandCall = async () => {
  const loaded = loadSessionInstructions()

  if (loaded.entries.length === 0) {
    return {
      type: 'text',
      value:
        'No layered instructions are active.\n\n' +
        'Add `instructions` (string or array) or `instructionFiles` (array of .md paths) ' +
        'to user, project (.claude/settings.json), or local (.claude/settings.local.json) settings. ' +
        'CLAUDE.md and AGENTS.md in the workspace root are auto-discovered unless ' +
        '`autoDiscoverInstructionFiles: false` is set.',
    }
  }

  const lines: string[] = []
  lines.push('Layered instructions (merged across layers):')
  lines.push(
    `  Contributing layers: ${loaded.contributingLayers.join(' → ')}`,
  )
  lines.push(
    `  Counts — user: ${loaded.layerCounts.user}, ` +
      `workspace: ${loaded.layerCounts.workspace}, ` +
      `local: ${loaded.layerCounts.local}`,
  )
  lines.push('')

  let idx = 1
  for (const entry of loaded.entries) {
    const s = entry.source
    const header =
      s.kind === 'inline'
        ? `[${idx}] ${s.layer} • inline #${s.index + 1}`
        : `[${idx}] ${s.layer} • file: ${s.filename}${
            s.autoDiscovered ? ' (auto-discovered)' : ''
          }`
    lines.push(header)
    // Indent content for readability.
    for (const contentLine of entry.content.split('\n')) {
      lines.push(`    ${contentLine}`)
    }
    lines.push('')
    idx++
  }

  return { type: 'text', value: lines.join('\n') }
}
