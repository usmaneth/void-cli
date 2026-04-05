import { basename, relative, resolve } from 'path'
import { statSync } from 'fs'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getCwd } from '../utils/cwd.js'
import { HintsManager } from './index.js'

/**
 * /hints slash command implementation.
 *
 * Subcommands:
 *   /hints           — show all discovered hint files and their content summary
 *   /hints list      — list all .voidhints files with locations and sizes
 *   /hints show [p]  — show hints relevant to a file/directory
 *   /hints init [p]  — create a .voidhints template in a directory
 *   /hints context [p] — show the full combined context that would be sent to the AI
 */
export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const projectRoot = getCwd()
  const manager = new HintsManager(projectRoot)

  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] || ''
  const subarg = parts.slice(1).join(' ').trim()

  switch (subcommand) {
    case '':
      return { type: 'text', value: handleOverview(manager) }
    case 'list':
      return { type: 'text', value: handleList(manager) }
    case 'show':
      return { type: 'text', value: handleShow(manager, subarg) }
    case 'init':
      return { type: 'text', value: handleInit(manager, subarg, projectRoot) }
    case 'context':
      return { type: 'text', value: handleContext(manager, subarg) }
    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage:',
          '  /hints              Show all discovered hint files',
          '  /hints list         List hint files with locations and sizes',
          '  /hints show [path]  Show hints relevant to a file/directory',
          '  /hints init [path]  Create a .voidhints template in a directory',
          '  /hints context [path]  Show combined context for the AI',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleOverview(manager: HintsManager): string {
  const hints = manager.load()

  if (hints.length === 0) {
    return [
      'No .voidhints files found in this project.',
      '',
      'Run /hints init to create one in the project root.',
    ].join('\n')
  }

  const lines: string[] = [`Found ${hints.length} hint file(s):`, '']

  for (const hint of hints) {
    const relPath = relative(manager.getProjectRoot(), hint.path) || basename(hint.path)
    lines.push(`--- ${relPath} (depth ${hint.depth}) ---`)

    if (hint.sections.length === 0) {
      lines.push('  (no sections)')
    } else {
      for (const section of hint.sections) {
        const preview = section.content.split('\n')[0]?.slice(0, 80) || '(empty)'
        lines.push(`  [${section.type}] ${section.title || '(untitled)'}: ${preview}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

function handleList(manager: HintsManager): string {
  const hints = manager.load()

  if (hints.length === 0) {
    return 'No .voidhints files found.'
  }

  const lines: string[] = ['Hint files:', '']

  for (const hint of hints) {
    const relPath = relative(manager.getProjectRoot(), hint.path) || basename(hint.path)
    const sizeBytes = hint.content.length
    const sectionCount = hint.sections.length
    lines.push(
      `  ${relPath}  (${formatSize(sizeBytes)}, ${sectionCount} section${sectionCount !== 1 ? 's' : ''}, depth ${hint.depth})`,
    )
  }

  return lines.join('\n')
}

function handleShow(manager: HintsManager, pathArg: string): string {
  if (!pathArg) {
    return 'Usage: /hints show <file-or-directory-path>'
  }

  const absPath = resolve(pathArg)
  const hints = manager.getHintsForFile(absPath)

  if (hints.length === 0) {
    return `No hints found relevant to ${pathArg}`
  }

  const lines: string[] = [`Hints relevant to ${pathArg}:`, '']

  for (const hint of hints) {
    const relPath = relative(manager.getProjectRoot(), hint.path) || basename(hint.path)
    lines.push(`--- ${relPath} ---`)
    lines.push(hint.content)
    lines.push('')
  }

  return lines.join('\n').trim()
}

function handleInit(manager: HintsManager, pathArg: string, projectRoot: string): string {
  const targetDir = pathArg ? resolve(pathArg) : projectRoot

  // Verify directory exists
  const stat = statSync(targetDir, { throwIfNoEntry: false })
  if (!stat?.isDirectory()) {
    return `Error: ${targetDir} is not a directory or does not exist.`
  }

  try {
    const createdPath = manager.createTemplate(targetDir)
    const relPath = relative(manager.getProjectRoot(), createdPath) || basename(createdPath)
    return `Created .voidhints template at ${relPath}\nEdit the file to add project-specific context and conventions.`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

function handleContext(manager: HintsManager, pathArg: string): string {
  const contextStr = pathArg ? manager.buildContext(resolve(pathArg)) : manager.buildContext()

  if (!contextStr) {
    return 'No hints context available. Create a .voidhints file with /hints init.'
  }

  return ['Combined hints context:', '', contextStr].join('\n')
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

import type { Command } from '../commands.js'

const hints = {
  type: 'local',
  name: 'hints',
  description: 'Manage hierarchical .voidhints project context files',
  argumentHint: '<list|show|init|context> [path]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default hints
