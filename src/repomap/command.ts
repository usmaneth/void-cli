/**
 * Slash command handler for /repomap.
 *
 * Subcommands:
 *   /repomap              — Show the repo map (top symbols)
 *   /repomap show         — Show the repo map (top symbols)
 *   /repomap build        — Force rebuild the map
 *   /repomap file <path>  — Show symbols for a specific file
 *   /repomap related <path> — Show related files
 *   /repomap stats        — Show indexing statistics
 */

import {
  RepoMapBuilder,
  getBuilder,
  type RepoMap,
  type CodeSymbol,
} from './index.js'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSymbol(sym: CodeSymbol, showFile = true): string {
  const kindTag = sym.kind.padEnd(9)
  const refs = sym.references > 0 ? ` (${sym.references} ref${sym.references !== 1 ? 's' : ''})` : ''
  const filePart = showFile ? `  ${sym.file}:${sym.line}` : `:${sym.line}`
  return `  ${kindTag} ${sym.name}${refs}${filePart}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// Subcommand implementations
// ---------------------------------------------------------------------------

function showCmd(builder: RepoMapBuilder, map: RepoMap, topN: number): string {
  const ranked = builder.getRankedSymbols(map, topN)
  if (ranked.length === 0) {
    return 'No symbols found in the repository.'
  }

  const lines: string[] = [
    `Repository map (top ${ranked.length} symbols by reference count):`,
    '',
  ]

  for (const sym of ranked) {
    lines.push(formatSymbol(sym, true))
  }

  lines.push('')
  lines.push(`${map.files.length} files indexed, ${countTotalSymbols(map)} total symbols.`)
  lines.push(`Generated: ${new Date(map.generatedAt).toISOString()}`)

  return lines.join('\n')
}

function buildCmd(builder: RepoMapBuilder): string {
  const start = Date.now()
  const map = builder.build(true)
  const elapsed = Date.now() - start

  return [
    `Repo map rebuilt in ${formatDuration(elapsed)}.`,
    `  Files:   ${map.files.length}`,
    `  Symbols: ${countTotalSymbols(map)}`,
    `  Imports: ${countTotalImports(map)}`,
  ].join('\n')
}

function fileCmd(map: RepoMap, filePath: string): string {
  if (!filePath) return 'Usage: /repomap file <path>'

  const normalized = filePath.replace(/^\.\//, '')

  // Find exact match or suffix match
  const entry = map.files.find(
    (f) => f.path === normalized || f.path.endsWith(normalized),
  )

  if (!entry) {
    return `File "${filePath}" not found in the repo map. Try /repomap build first.`
  }

  const lines: string[] = [
    `${entry.path} (${entry.language}, ${formatSize(entry.size)}):`,
    '',
  ]

  if (entry.symbols.length === 0) {
    lines.push('  No symbols found.')
  } else {
    lines.push(`  Symbols (${entry.symbols.length}):`)
    const sorted = [...entry.symbols].sort((a, b) => b.references - a.references)
    for (const sym of sorted) {
      lines.push(formatSymbol(sym, false))
    }
  }

  if (entry.imports.length > 0) {
    lines.push('')
    lines.push(`  Imports (${entry.imports.length}):`)
    for (const imp of entry.imports) {
      lines.push(`    ${imp}`)
    }
  }

  return lines.join('\n')
}

function relatedCmd(
  builder: RepoMapBuilder,
  map: RepoMap,
  filePath: string,
): string {
  if (!filePath) return 'Usage: /repomap related <path>'

  const normalized = filePath.replace(/^\.\//, '')

  // Find the file in the map
  const entry = map.files.find(
    (f) => f.path === normalized || f.path.endsWith(normalized),
  )

  if (!entry) {
    return `File "${filePath}" not found in the repo map. Try /repomap build first.`
  }

  const related = builder.getRelatedFiles(map, entry.path)

  const lines: string[] = [`Related files for ${entry.path}:`, '']

  if (related.imports.length > 0) {
    lines.push(`  Imports (${related.imports.length}):`)
    for (const f of related.imports) {
      lines.push(`    -> ${f}`)
    }
  } else {
    lines.push('  Imports: none (or all external)')
  }

  lines.push('')

  if (related.importedBy.length > 0) {
    lines.push(`  Imported by (${related.importedBy.length}):`)
    for (const f of related.importedBy) {
      lines.push(`    <- ${f}`)
    }
  } else {
    lines.push('  Imported by: none')
  }

  return lines.join('\n')
}

function statsCmd(map: RepoMap): string {
  const totalSymbols = countTotalSymbols(map)
  const totalImports = countTotalImports(map)
  const totalSize = map.files.reduce((sum, f) => sum + f.size, 0)

  // Count symbols by kind
  const kindCounts: Record<string, number> = {}
  for (const file of map.files) {
    for (const sym of file.symbols) {
      kindCounts[sym.kind] = (kindCounts[sym.kind] ?? 0) + 1
    }
  }

  // Count files by language
  const langCounts: Record<string, number> = {}
  for (const file of map.files) {
    langCounts[file.language] = (langCounts[file.language] ?? 0) + 1
  }

  // Most-referenced symbols
  const allSymbols: CodeSymbol[] = []
  for (const file of map.files) {
    for (const sym of file.symbols) {
      allSymbols.push(sym)
    }
  }
  const topReferenced = allSymbols
    .filter((s) => s.references > 0)
    .sort((a, b) => b.references - a.references)
    .slice(0, 5)

  const lines: string[] = [
    'Repo map statistics:',
    '',
    `  Files:        ${map.files.length}`,
    `  Total size:   ${formatSize(totalSize)}`,
    `  Symbols:      ${totalSymbols}`,
    `  Imports:      ${totalImports}`,
    `  Generated:    ${new Date(map.generatedAt).toISOString()}`,
    '',
    '  By language:',
  ]

  for (const [lang, count] of Object.entries(langCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`    ${lang}: ${count} files`)
  }

  lines.push('')
  lines.push('  By symbol kind:')
  for (const [kind, count] of Object.entries(kindCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`    ${kind}: ${count}`)
  }

  if (topReferenced.length > 0) {
    lines.push('')
    lines.push('  Most referenced symbols:')
    for (const sym of topReferenced) {
      lines.push(
        `    ${sym.name} (${sym.kind}) — ${sym.references} refs — ${sym.file}`,
      )
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function countTotalSymbols(map: RepoMap): number {
  return map.files.reduce((sum, f) => sum + f.symbols.length, 0)
}

function countTotalImports(map: RepoMap): number {
  return map.files.reduce((sum, f) => sum + f.imports.length, 0)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

export async function handleRepoMapCommand(
  args: string,
  cwd?: string,
): Promise<{ output: string; isError?: boolean }> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''
  const rest = parts.slice(1)

  const root = cwd ?? process.cwd()

  try {
    const builder = getBuilder(root)
    // Build (or load from cache) the map
    const needsExplicitBuild = subcommand === 'build'
    const map = builder.build(needsExplicitBuild)

    switch (subcommand) {
      case '':
      case 'show':
      case 'help': {
        if (subcommand === 'help') {
          return { output: getUsage() }
        }
        const topN = rest[0] ? parseInt(rest[0], 10) : 30
        return { output: showCmd(builder, map, isNaN(topN) ? 30 : topN) }
      }

      case 'build':
        return { output: buildCmd(builder) }

      case 'file':
        return { output: fileCmd(map, rest.join(' ')) }

      case 'related':
        return { output: relatedCmd(builder, map, rest.join(' ')) }

      case 'stats':
        return { output: statsCmd(map) }

      default:
        return {
          output: `Unknown subcommand "${subcommand}". Run "/repomap help" for usage.`,
          isError: true,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      output: `Repo map error: ${message}`,
      isError: true,
    }
  }
}

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

function getUsage(): string {
  return [
    'Usage: /repomap <subcommand>',
    '',
    '  show [N]        — Show top N symbols by reference count (default: 30)',
    '  build           — Force rebuild the repo map',
    '  file <path>     — Show symbols for a specific file',
    '  related <path>  — Show files that import / are imported by a file',
    '  stats           — Show indexing statistics',
    '  help            — Show this help message',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export const repomapCommand = {
  type: 'local' as const,
  name: 'repomap',
  description: 'Show repository map with ranked code symbols',
  argumentHint: '<show|build|file|related|stats> [args]',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({
    call: async (args: string) => {
      const result = await handleRepoMapCommand(args)
      return { type: 'text' as const, value: result.output }
    },
  }),
}
