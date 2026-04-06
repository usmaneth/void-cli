/**
 * RepoMapManager — AST-inspired regex-based codebase mapping.
 *
 * Scans project files, extracts symbols (classes, functions, interfaces,
 * type aliases, exports, imports) via regex, ranks files by import-graph
 * connectivity, and produces a concise map string suitable for LLM context.
 *
 * Uses only Node.js built-ins: fs, path, os, crypto.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolEntry {
  name: string
  kind: 'class' | 'function' | 'interface' | 'type' | 'const' | 'enum' | 'export'
  exported: boolean
  extends?: string
}

export interface FileMapEntry {
  relativePath: string
  symbols: SymbolEntry[]
  imports: string[] // raw import module specifiers
  mtime: number
}

interface CacheData {
  rootDir: string
  entries: FileMapEntry[]
  generatedAt: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
])

const CODE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx'])

const DEFAULT_TOKEN_BUDGET = 200 // lines

// ---------------------------------------------------------------------------
// Regex patterns for symbol extraction
// ---------------------------------------------------------------------------

const SYMBOL_PATTERNS: Array<{
  regex: RegExp
  kind: SymbolEntry['kind']
  nameGroup: number
  exportedGroup?: number
  extendsGroup?: number
}> = [
  // export (default)? class Name (extends X)?
  {
    regex: /^(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
    kind: 'class',
    nameGroup: 2,
    exportedGroup: 1,
    extendsGroup: 3,
  },
  // export (default)? function name(
  {
    regex: /^(export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/,
    kind: 'function',
    nameGroup: 2,
    exportedGroup: 1,
  },
  // export (default)? interface Name
  {
    regex: /^(export\s+(?:default\s+)?)?interface\s+(\w+)/,
    kind: 'interface',
    nameGroup: 2,
    exportedGroup: 1,
  },
  // export (default)? type Name =
  {
    regex: /^(export\s+(?:default\s+)?)?type\s+(\w+)\s*[=<{]/,
    kind: 'type',
    nameGroup: 2,
    exportedGroup: 1,
  },
  // export (default)? const Name
  {
    regex: /^(export\s+(?:default\s+)?)?const\s+(\w+)\s*[=:]/,
    kind: 'const',
    nameGroup: 2,
    exportedGroup: 1,
  },
  // export (default)? enum Name
  {
    regex: /^(export\s+(?:default\s+)?)?(?:const\s+)?enum\s+(\w+)/,
    kind: 'enum',
    nameGroup: 2,
    exportedGroup: 1,
  },
  // standalone function (not exported)
  {
    regex: /^(?:async\s+)?function\s+(\w+)\s*\(/,
    kind: 'function',
    nameGroup: 1,
  },
  // class without export
  {
    regex: /^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
    kind: 'class',
    nameGroup: 1,
    extendsGroup: 2,
  },
]

const IMPORT_PATTERN = /import\s+(?:type\s+)?(?:\{[^}]*\}|[^;{]*)\s+from\s+['"]([^'"]+)['"]/g

const EXPORT_BRACE_PATTERN = /^export\s+\{([^}]+)\}/

// ---------------------------------------------------------------------------
// .gitignore parsing
// ---------------------------------------------------------------------------

function loadGitignorePatterns(rootDir: string): string[] {
  const gitignorePath = path.join(rootDir, '.gitignore')
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8')
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  } catch {
    return []
  }
}

function isIgnoredByGitignore(relativePath: string, patterns: string[]): boolean {
  const parts = relativePath.split(path.sep)
  for (const pattern of patterns) {
    const cleaned = pattern.replace(/\/$/, '')
    // Simple directory/file name match
    if (parts.includes(cleaned)) return true
    // Prefix match for patterns like "src/generated"
    if (relativePath.startsWith(cleaned + '/') || relativePath === cleaned) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walkDir(
  dir: string,
  rootDir: string,
  gitignorePatterns: string[],
  results: string[],
): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootDir, fullPath)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (isIgnoredByGitignore(relativePath, gitignorePatterns)) continue
      walkDir(fullPath, rootDir, gitignorePatterns, results)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!CODE_EXTENSIONS.has(ext)) continue
      if (isIgnoredByGitignore(relativePath, gitignorePatterns)) continue
      results.push(fullPath)
    }
  }
}

function discoverFiles(rootDir: string): string[] {
  const gitignorePatterns = loadGitignorePatterns(rootDir)
  const results: string[] = []
  walkDir(rootDir, rootDir, gitignorePatterns, results)
  return results.sort()
}

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

function extractSymbols(content: string): { symbols: SymbolEntry[]; imports: string[] } {
  const symbols: SymbolEntry[] = []
  const imports: string[] = []
  const seenSymbols = new Set<string>()
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trimStart()

    // Skip comments and blank lines
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.length === 0
    ) {
      continue
    }

    // Extract imports
    IMPORT_PATTERN.lastIndex = 0
    const importMatch = IMPORT_PATTERN.exec(line)
    if (importMatch?.[1]) {
      imports.push(importMatch[1])
    }

    // Extract export { ... } braces
    const exportBraceMatch = trimmed.match(EXPORT_BRACE_PATTERN)
    if (exportBraceMatch?.[1]) {
      const names = exportBraceMatch[1]
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0]!.trim())
        .filter((n) => n.length > 0)
      for (const name of names) {
        const key = `export:${name}`
        if (!seenSymbols.has(key)) {
          seenSymbols.add(key)
          symbols.push({ name, kind: 'export', exported: true })
        }
      }
      continue
    }

    // Extract symbol definitions
    for (const pattern of SYMBOL_PATTERNS) {
      const match = trimmed.match(pattern.regex)
      if (match?.[pattern.nameGroup]) {
        const name = match[pattern.nameGroup]!
        const key = `${pattern.kind}:${name}`
        if (seenSymbols.has(key)) break
        seenSymbols.add(key)

        const exported = pattern.exportedGroup
          ? !!match[pattern.exportedGroup]
          : false
        const extendsName = pattern.extendsGroup
          ? match[pattern.extendsGroup] ?? undefined
          : undefined

        symbols.push({
          name,
          kind: pattern.kind,
          exported,
          extends: extendsName,
        })
        break
      }
    }
  }

  return { symbols, imports }
}

// ---------------------------------------------------------------------------
// Import graph and relevance ranking
// ---------------------------------------------------------------------------

function buildImportGraph(entries: FileMapEntry[]): Map<string, Set<string>> {
  // Map: file path -> set of file paths it is imported by
  const importedByCount = new Map<string, Set<string>>()

  // Build a lookup from module specifier fragments to file paths
  const filePathSet = new Set(entries.map((e) => e.relativePath))

  for (const entry of entries) {
    for (const imp of entry.imports) {
      // Only consider relative imports
      if (!imp.startsWith('.') && !imp.startsWith('/')) continue

      const dir = path.dirname(entry.relativePath)
      const resolved = path.normalize(path.join(dir, imp))

      // Try to match against known files (with/without extension, index files)
      const candidates = [
        resolved,
        resolved.replace(/\.js$/, '.ts'),
        resolved.replace(/\.js$/, '.tsx'),
        `${resolved}.ts`,
        `${resolved}.tsx`,
        `${resolved}.js`,
        `${resolved}.jsx`,
        path.join(resolved, 'index.ts'),
        path.join(resolved, 'index.tsx'),
        path.join(resolved, 'index.js'),
      ]

      for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/')
        if (filePathSet.has(normalized)) {
          let set = importedByCount.get(normalized)
          if (!set) {
            set = new Set()
            importedByCount.set(normalized, set)
          }
          set.add(entry.relativePath)
          break
        }
      }
    }
  }

  return importedByCount
}

function rankEntries(entries: FileMapEntry[]): FileMapEntry[] {
  const importedBy = buildImportGraph(entries)

  return [...entries].sort((a, b) => {
    const aScore = importedBy.get(a.relativePath)?.size ?? 0
    const bScore = importedBy.get(b.relativePath)?.size ?? 0
    if (bScore !== aScore) return bScore - aScore
    return a.relativePath.localeCompare(b.relativePath)
  })
}

// ---------------------------------------------------------------------------
// Map formatting
// ---------------------------------------------------------------------------

function formatEntry(entry: FileMapEntry): string[] {
  const lines: string[] = [entry.relativePath]

  for (const sym of entry.symbols) {
    if (sym.kind === 'export') continue // handled separately

    let line = '  '
    switch (sym.kind) {
      case 'class':
        line += `class ${sym.name}`
        if (sym.extends) line += ` extends ${sym.extends}`
        break
      case 'function':
        line += `function ${sym.name}()`
        break
      case 'interface':
        line += `interface ${sym.name}`
        break
      case 'type':
        line += `type ${sym.name}`
        break
      case 'const':
        line += `const ${sym.name}`
        break
      case 'enum':
        line += `enum ${sym.name}`
        break
    }
    lines.push(line)
  }

  // Collect explicit exports
  const exportSymbols = entry.symbols.filter((s) => s.kind === 'export')
  const exportedDefs = entry.symbols.filter(
    (s) => s.kind !== 'export' && s.exported,
  )

  const allExportNames = new Set<string>()
  for (const s of exportSymbols) allExportNames.add(s.name)
  for (const s of exportedDefs) allExportNames.add(s.name)

  if (allExportNames.size > 0) {
    const names = [...allExportNames].sort()
    lines.push(`  export { ${names.join(', ')} }`)
  }

  return lines
}

// ---------------------------------------------------------------------------
// RepoMapManager — singleton
// ---------------------------------------------------------------------------

export class RepoMapManager {
  private rootDir: string = ''
  private cache: CacheData | null = null
  private tokenBudget: number = DEFAULT_TOKEN_BUDGET

  /**
   * Scan the project and generate a concise map string.
   */
  generateMap(rootDir: string): string {
    this.rootDir = path.resolve(rootDir)
    const files = discoverFiles(this.rootDir)
    const entries: FileMapEntry[] = []

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        // Skip very large files
        if (content.length > 500_000) continue

        const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/')
        const stat = fs.statSync(filePath)
        const { symbols, imports } = extractSymbols(content)

        // Skip files with no symbols
        if (symbols.length === 0) continue

        entries.push({
          relativePath,
          symbols,
          imports,
          mtime: stat.mtimeMs,
        })
      } catch {
        // Skip unreadable files
      }
    }

    // Rank by import connectivity
    const ranked = rankEntries(entries)

    // Format with token budget
    const outputLines: string[] = []
    for (const entry of ranked) {
      const entryLines = formatEntry(entry)
      if (outputLines.length + entryLines.length > this.tokenBudget) {
        // Truncate: add as many remaining entries as fit
        const remaining = this.tokenBudget - outputLines.length
        if (remaining >= 2) {
          // At minimum include the file path
          outputLines.push(entryLines[0]!)
          for (let i = 1; i < entryLines.length && outputLines.length < this.tokenBudget; i++) {
            outputLines.push(entryLines[i]!)
          }
        }
        break
      }
      outputLines.push(...entryLines)
    }

    // Update cache
    this.cache = {
      rootDir: this.rootDir,
      entries,
      generatedAt: Date.now(),
    }

    return outputLines.join('\n')
  }

  /**
   * Return the cached map or regenerate if stale/missing.
   */
  getMap(): string {
    if (this.cache && this.rootDir && !this.isCacheStale()) {
      return this.formatCachedEntries()
    }
    const root = this.rootDir || process.cwd()
    return this.generateMap(root)
  }

  /**
   * Force a full regeneration of the map.
   */
  refresh(): string {
    const root = this.rootDir || process.cwd()
    this.cache = null
    return this.generateMap(root)
  }

  /**
   * Return statistics about the current map.
   */
  getStats(): { files: number; symbols: number; cacheAge: number } {
    if (!this.cache) {
      return { files: 0, symbols: 0, cacheAge: -1 }
    }
    const totalSymbols = this.cache.entries.reduce(
      (sum, e) => sum + e.symbols.length,
      0,
    )
    return {
      files: this.cache.entries.length,
      symbols: totalSymbols,
      cacheAge: Date.now() - this.cache.generatedAt,
    }
  }

  /**
   * Set the maximum number of output lines (token budget).
   */
  setTokenBudget(lines: number): void {
    this.tokenBudget = Math.max(1, Math.floor(lines))
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isCacheStale(): boolean {
    if (!this.cache || !this.rootDir) return true

    // Sample a subset of files to check mtime changes
    const sampleSize = Math.min(20, this.cache.entries.length)
    for (let i = 0; i < sampleSize; i++) {
      const entry = this.cache.entries[i]!
      const fullPath = path.join(this.rootDir, entry.relativePath)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.mtimeMs !== entry.mtime) return true
      } catch {
        return true // file disappeared
      }
    }
    return false
  }

  private formatCachedEntries(): string {
    if (!this.cache) return ''

    const ranked = rankEntries(this.cache.entries)
    const outputLines: string[] = []

    for (const entry of ranked) {
      const entryLines = formatEntry(entry)
      if (outputLines.length + entryLines.length > this.tokenBudget) {
        const remaining = this.tokenBudget - outputLines.length
        if (remaining >= 2) {
          outputLines.push(entryLines[0]!)
          for (let i = 1; i < entryLines.length && outputLines.length < this.tokenBudget; i++) {
            outputLines.push(entryLines[i]!)
          }
        }
        break
      }
      outputLines.push(...entryLines)
    }

    return outputLines.join('\n')
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: RepoMapManager | null = null

export function getRepoMapManager(): RepoMapManager {
  if (!_instance) {
    _instance = new RepoMapManager()
  }
  return _instance
}
