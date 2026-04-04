/**
 * Repository map / code indexing system inspired by aider's PageRank repo map.
 *
 * Uses regex-based parsing (no tree-sitter) to extract code structure from
 * multiple languages, build a reference graph, and rank symbols by how often
 * they are referenced across the codebase.
 *
 * Only uses Node.js built-in modules: fs, path, crypto.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as os from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeSymbol {
  name: string
  kind:
    | 'function'
    | 'class'
    | 'method'
    | 'interface'
    | 'type'
    | 'variable'
    | 'export'
  file: string
  line: number
  references: number // how many times referenced elsewhere
}

export interface FileEntry {
  path: string
  language: string
  symbols: CodeSymbol[]
  imports: string[] // imported modules/files
  size: number // file size in bytes
}

export interface RepoMap {
  files: FileEntry[]
  symbolIndex: Map<string, CodeSymbol[]> // symbol name -> locations
  referenceGraph: Map<string, string[]> // file -> files it imports
  generatedAt: number
}

export interface RepoMapOptions {
  root: string
  include?: string[] // glob patterns
  exclude?: string[] // patterns to exclude
  maxFiles?: number // max files to index (default: 1000)
  cacheDir?: string // default: ~/.void/repomap/
}

// Serialized form for JSON cache
interface SerializedRepoMap {
  files: FileEntry[]
  symbolIndex: Record<string, CodeSymbol[]>
  referenceGraph: Record<string, string[]>
  generatedAt: number
}

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

const DEFAULT_INCLUDE = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
  '**/*.java',
]

const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'vendor',
  '.next',
  'coverage',
  '__pycache__',
  '.tox',
  'target',
]

const DEFAULT_MAX_FILES = 1000

// ---------------------------------------------------------------------------
// LanguageParser — regex-based symbol extraction
// ---------------------------------------------------------------------------

type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'unknown'

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
}

interface SymbolPattern {
  regex: RegExp
  kind: CodeSymbol['kind']
  nameGroup: number // capture group index for the symbol name
}

interface ImportPattern {
  regex: RegExp
  moduleGroup: number // capture group index for the module path
}

const TS_JS_SYMBOL_PATTERNS: SymbolPattern[] = [
  // export function name(
  {
    regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    kind: 'function',
    nameGroup: 1,
  },
  // export class Name
  { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'class', nameGroup: 1 },
  // export interface Name
  { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: 'interface', nameGroup: 1 },
  // export type Name
  {
    regex: /^(?:export\s+)?type\s+(\w+)\s*[=<{]/,
    kind: 'type',
    nameGroup: 1,
  },
  // export const name = / export let name =
  {
    regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/,
    kind: 'variable',
    nameGroup: 1,
  },
  // export default
  { regex: /^export\s+default\s+(?:class|function)\s+(\w+)/, kind: 'export', nameGroup: 1 },
  // Arrow function: const name = (... ) =>  or  const name = async (
  {
    regex:
      /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*[^=]+)?\s*=>/,
    kind: 'function',
    nameGroup: 1,
  },
  // Method in class body:   name(   or   async name(
  {
    regex: /^\s+(?:async\s+)?(?:static\s+)?(?:private\s+|protected\s+|public\s+)?(\w+)\s*\(/,
    kind: 'method',
    nameGroup: 1,
  },
]

const TS_JS_IMPORT_PATTERNS: ImportPattern[] = [
  // import ... from 'module'
  { regex: /import\s+.*?\s+from\s+['"]([^'"]+)['"]/, moduleGroup: 1 },
  // import 'module'
  { regex: /import\s+['"]([^'"]+)['"]/, moduleGroup: 1 },
  // require('module')
  { regex: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/, moduleGroup: 1 },
]

const PYTHON_SYMBOL_PATTERNS: SymbolPattern[] = [
  // def name(
  { regex: /^(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'function', nameGroup: 1 },
  // class Name
  { regex: /^class\s+(\w+)/, kind: 'class', nameGroup: 1 },
  // NAME = ... (module-level constants)
  { regex: /^([A-Z][A-Z_0-9]+)\s*=/, kind: 'variable', nameGroup: 1 },
]

const PYTHON_IMPORT_PATTERNS: ImportPattern[] = [
  // from module import ...
  { regex: /^from\s+(\S+)\s+import/, moduleGroup: 1 },
  // import module
  { regex: /^import\s+(\S+)/, moduleGroup: 1 },
]

const GO_SYMBOL_PATTERNS: SymbolPattern[] = [
  // func name(   or   func (r Receiver) name(
  { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/, kind: 'function', nameGroup: 1 },
  // type Name struct
  { regex: /^type\s+(\w+)\s+struct\b/, kind: 'class', nameGroup: 1 },
  // type Name interface
  { regex: /^type\s+(\w+)\s+interface\b/, kind: 'interface', nameGroup: 1 },
  // type Name ...  (other type defs)
  { regex: /^type\s+(\w+)\s+\w/, kind: 'type', nameGroup: 1 },
]

const GO_IMPORT_PATTERNS: ImportPattern[] = [
  // import "pkg" or import ( "pkg" )
  { regex: /["']([^"']+)["']/, moduleGroup: 1 },
]

const RUST_SYMBOL_PATTERNS: SymbolPattern[] = [
  // fn name(   or   pub fn name(   or   pub(crate) fn name(
  {
    regex: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/,
    kind: 'function',
    nameGroup: 1,
  },
  // struct Name
  { regex: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/, kind: 'class', nameGroup: 1 },
  // trait Name
  { regex: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/, kind: 'interface', nameGroup: 1 },
  // impl Name   or   impl Trait for Name
  { regex: /^impl(?:<[^>]*>)?\s+(?:(\w+)\s+for\s+)?(\w+)/, kind: 'class', nameGroup: 2 },
  // enum Name
  { regex: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, kind: 'type', nameGroup: 1 },
  // type Name
  { regex: /^(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)/, kind: 'type', nameGroup: 1 },
]

const RUST_IMPORT_PATTERNS: ImportPattern[] = [
  // use crate::module  or  use std::collections
  { regex: /^use\s+(\S+?)(?:::(?:\{|[A-Z]\w*|\*))?;/, moduleGroup: 1 },
]

const JAVA_SYMBOL_PATTERNS: SymbolPattern[] = [
  // public/private/protected class Name
  {
    regex:
      /^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?class\s+(\w+)/,
    kind: 'class',
    nameGroup: 1,
  },
  // interface Name
  {
    regex: /^(?:public|private|protected)?\s*interface\s+(\w+)/,
    kind: 'interface',
    nameGroup: 1,
  },
  // enum Name
  {
    regex: /^(?:public|private|protected)?\s*enum\s+(\w+)/,
    kind: 'type',
    nameGroup: 1,
  },
  // method: public Type name(
  {
    regex:
      /^\s+(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/,
    kind: 'method',
    nameGroup: 1,
  },
]

const JAVA_IMPORT_PATTERNS: ImportPattern[] = [
  // import com.example.Class
  { regex: /^import\s+(?:static\s+)?(\S+);/, moduleGroup: 1 },
]

function getSymbolPatterns(language: Language): SymbolPattern[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return TS_JS_SYMBOL_PATTERNS
    case 'python':
      return PYTHON_SYMBOL_PATTERNS
    case 'go':
      return GO_SYMBOL_PATTERNS
    case 'rust':
      return RUST_SYMBOL_PATTERNS
    case 'java':
      return JAVA_SYMBOL_PATTERNS
    default:
      return []
  }
}

function getImportPatterns(language: Language): ImportPattern[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return TS_JS_IMPORT_PATTERNS
    case 'python':
      return PYTHON_IMPORT_PATTERNS
    case 'go':
      return GO_IMPORT_PATTERNS
    case 'rust':
      return RUST_IMPORT_PATTERNS
    case 'java':
      return JAVA_IMPORT_PATTERNS
    default:
      return []
  }
}

function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown'
}

/**
 * Parse a single file and extract symbols and imports.
 */
export function parseFile(filePath: string, content: string): FileEntry {
  const language = detectLanguage(filePath)
  const symbolPatterns = getSymbolPatterns(language)
  const importPatterns = getImportPatterns(language)

  const symbols: CodeSymbol[] = []
  const imports: string[] = []
  const seenSymbols = new Set<string>()
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trimStart()

    // Skip comments
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      continue
    }

    // Check import patterns
    for (const pattern of importPatterns) {
      const match = line.match(pattern.regex)
      if (match?.[pattern.moduleGroup]) {
        imports.push(match[pattern.moduleGroup]!)
        break
      }
    }

    // Check symbol patterns
    for (const pattern of symbolPatterns) {
      const match = trimmed.match(pattern.regex)
      if (match?.[pattern.nameGroup]) {
        const name = match[pattern.nameGroup]!
        // Skip common keywords/noise
        if (isReservedWord(name, language)) continue
        // Deduplicate: prefer earlier occurrence
        const key = `${name}:${pattern.kind}`
        if (seenSymbols.has(key)) continue
        seenSymbols.add(key)
        symbols.push({
          name,
          kind: pattern.kind,
          file: filePath,
          line: i + 1,
          references: 0,
        })
        break
      }
    }
  }

  return {
    path: filePath,
    language,
    symbols,
    imports,
    size: Buffer.byteLength(content, 'utf-8'),
  }
}

const RESERVED_WORDS_COMMON = new Set([
  'if',
  'else',
  'for',
  'while',
  'return',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'this',
  'super',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'typeof',
  'instanceof',
  'delete',
  'throw',
  'try',
  'catch',
  'finally',
  'constructor',
  'toString',
  'valueOf',
])

const RESERVED_WORDS_PYTHON = new Set([
  ...RESERVED_WORDS_COMMON,
  'self',
  'cls',
  'None',
  'True',
  'False',
  'def',
  'class',
  'lambda',
  'yield',
  'pass',
  'raise',
  'with',
  'as',
  'from',
  'import',
  'global',
  'nonlocal',
  '__init__',
  '__str__',
  '__repr__',
])

function isReservedWord(name: string, language: Language): boolean {
  if (language === 'python') {
    return RESERVED_WORDS_PYTHON.has(name)
  }
  return RESERVED_WORDS_COMMON.has(name)
}

// ---------------------------------------------------------------------------
// File discovery — recursive walk using node:fs
// ---------------------------------------------------------------------------

function matchesGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching: supports ** and *
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars except * and ?
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(filePath)
}

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  const parts = filePath.split(path.sep)
  for (const pattern of excludePatterns) {
    // Check if any path segment matches the exclude pattern
    if (parts.includes(pattern)) return true
    // Also check full path match
    if (matchesGlob(filePath, pattern)) return true
  }
  return false
}

function walkDirectory(
  dir: string,
  root: string,
  includePatterns: string[],
  excludePatterns: string[],
  maxFiles: number,
  result: string[],
): void {
  if (result.length >= maxFiles) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // skip directories we can't read
  }

  for (const entry of entries) {
    if (result.length >= maxFiles) return

    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(root, fullPath)

    if (shouldExclude(relativePath, excludePatterns)) continue

    if (entry.isDirectory()) {
      walkDirectory(fullPath, root, includePatterns, excludePatterns, maxFiles, result)
    } else if (entry.isFile()) {
      const matches = includePatterns.some((pattern) =>
        matchesGlob(relativePath, pattern),
      )
      if (matches) {
        result.push(fullPath)
      }
    }
  }
}

function discoverFiles(
  root: string,
  includePatterns: string[],
  excludePatterns: string[],
  maxFiles: number,
): string[] {
  const result: string[] = []
  walkDirectory(root, root, includePatterns, excludePatterns, maxFiles, result)
  return result
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

function defaultCacheDir(): string {
  return path.join(os.homedir(), '.void', 'repomap')
}

function cacheFilePath(cacheDir: string): string {
  return path.join(cacheDir, 'repomap-cache.json')
}

function cacheMetaPath(cacheDir: string): string {
  return path.join(cacheDir, 'repomap-meta.json')
}

/**
 * Compute a hash of file modification times to use as cache key.
 */
function computeMtimeHash(files: string[]): string {
  const hash = crypto.createHash('sha256')
  // Sort for deterministic ordering
  const sorted = [...files].sort()
  for (const f of sorted) {
    try {
      const stat = fs.statSync(f)
      hash.update(`${f}:${stat.mtimeMs}\n`)
    } catch {
      hash.update(`${f}:missing\n`)
    }
  }
  return hash.digest('hex')
}

export function loadCache(cacheDir: string): RepoMap | null {
  const fp = cacheFilePath(cacheDir)
  if (!fs.existsSync(fp)) return null

  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const data: SerializedRepoMap = JSON.parse(raw)

    // Reconstruct Maps from plain objects
    const symbolIndex = new Map<string, CodeSymbol[]>()
    for (const [key, val] of Object.entries(data.symbolIndex)) {
      symbolIndex.set(key, val)
    }

    const referenceGraph = new Map<string, string[]>()
    for (const [key, val] of Object.entries(data.referenceGraph)) {
      referenceGraph.set(key, val)
    }

    return {
      files: data.files,
      symbolIndex,
      referenceGraph,
      generatedAt: data.generatedAt,
    }
  } catch {
    return null
  }
}

export function saveCache(map: RepoMap, cacheDir: string): void {
  const dir = cacheDir
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Serialize Maps to plain objects
  const symbolIndex: Record<string, CodeSymbol[]> = {}
  for (const [key, val] of map.symbolIndex) {
    symbolIndex[key] = val
  }

  const referenceGraph: Record<string, string[]> = {}
  for (const [key, val] of map.referenceGraph) {
    referenceGraph[key] = val
  }

  const data: SerializedRepoMap = {
    files: map.files,
    symbolIndex,
    referenceGraph,
    generatedAt: map.generatedAt,
  }

  fs.writeFileSync(cacheFilePath(cacheDir), JSON.stringify(data), 'utf-8')
}

function saveCacheMeta(cacheDir: string, mtimeHash: string): void {
  const dir = cacheDir
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(
    cacheMetaPath(cacheDir),
    JSON.stringify({ mtimeHash }),
    'utf-8',
  )
}

function loadCacheMeta(cacheDir: string): { mtimeHash: string } | null {
  const fp = cacheMetaPath(cacheDir)
  if (!fs.existsSync(fp)) return null
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch {
    return null
  }
}

export function isCacheValid(
  cacheDir: string,
  files: string[],
): boolean {
  const meta = loadCacheMeta(cacheDir)
  if (!meta) return false

  const cached = loadCache(cacheDir)
  if (!cached) return false

  const currentHash = computeMtimeHash(files)
  return meta.mtimeHash === currentHash
}

// ---------------------------------------------------------------------------
// RepoMapBuilder
// ---------------------------------------------------------------------------

export class RepoMapBuilder {
  private root: string
  private includePatterns: string[]
  private excludePatterns: string[]
  private maxFiles: number
  private cacheDir: string

  constructor(options: RepoMapOptions) {
    this.root = path.resolve(options.root)
    this.includePatterns = options.include ?? DEFAULT_INCLUDE
    this.excludePatterns = options.exclude ?? DEFAULT_EXCLUDE
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
    this.cacheDir = options.cacheDir ?? defaultCacheDir()
  }

  /**
   * Scan files, parse symbols, build reference graph, count references.
   * Returns a cached version if the cache is still valid.
   */
  build(forceRebuild = false): RepoMap {
    const files = discoverFiles(
      this.root,
      this.includePatterns,
      this.excludePatterns,
      this.maxFiles,
    )

    // Check cache
    if (!forceRebuild && isCacheValid(this.cacheDir, files)) {
      const cached = loadCache(this.cacheDir)
      if (cached) return cached
    }

    // Parse all files
    const fileEntries: FileEntry[] = []
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        // Skip binary/very large files
        if (content.length > 500_000) continue
        const relativePath = path.relative(this.root, filePath)
        const entry = parseFile(relativePath, content)
        fileEntries.push(entry)
      } catch {
        // Skip files we can't read
      }
    }

    // Build symbol index: symbol name -> all CodeSymbol entries
    const symbolIndex = new Map<string, CodeSymbol[]>()
    for (const file of fileEntries) {
      for (const sym of file.symbols) {
        const existing = symbolIndex.get(sym.name)
        if (existing) {
          existing.push(sym)
        } else {
          symbolIndex.set(sym.name, [sym])
        }
      }
    }

    // Build reference graph: file -> imported files
    const referenceGraph = new Map<string, string[]>()
    for (const file of fileEntries) {
      const resolvedImports: string[] = []
      for (const imp of file.imports) {
        // Try to resolve the import to a known file
        const resolved = this.resolveImport(imp, file.path, fileEntries)
        if (resolved) {
          resolvedImports.push(resolved)
        }
      }
      referenceGraph.set(file.path, resolvedImports)
    }

    // Count references: for each file, look at all identifiers used
    // and increment the reference count of matching symbols in other files
    this.countReferences(fileEntries, symbolIndex)

    const map: RepoMap = {
      files: fileEntries,
      symbolIndex,
      referenceGraph,
      generatedAt: Date.now(),
    }

    // Save cache
    try {
      const mtimeHash = computeMtimeHash(files)
      saveCache(map, this.cacheDir)
      saveCacheMeta(this.cacheDir, mtimeHash)
    } catch {
      // Cache save failure is non-fatal
    }

    return map
  }

  /**
   * Return symbols sorted by reference count (most-referenced first).
   * This is the "PageRank approximation" — symbols referenced by many files
   * are considered more important.
   */
  getRankedSymbols(map: RepoMap, topN = 50): CodeSymbol[] {
    const allSymbols: CodeSymbol[] = []
    for (const file of map.files) {
      for (const sym of file.symbols) {
        allSymbols.push(sym)
      }
    }

    allSymbols.sort((a, b) => {
      // Primary: reference count descending
      if (b.references !== a.references) return b.references - a.references
      // Secondary: kind priority (classes/interfaces first)
      const kindOrder: Record<string, number> = {
        class: 0,
        interface: 1,
        type: 2,
        function: 3,
        method: 4,
        variable: 5,
        export: 6,
      }
      const aOrder = kindOrder[a.kind] ?? 99
      const bOrder = kindOrder[b.kind] ?? 99
      if (aOrder !== bOrder) return aOrder - bOrder
      // Tertiary: alphabetical
      return a.name.localeCompare(b.name)
    })

    return allSymbols.slice(0, topN)
  }

  /**
   * Generate a compact string representation of the repo suitable for LLM context.
   * Format: `file.ts: ClassName, functionName, InterfaceName` per line.
   * Truncated to fit within maxTokens estimate (4 chars ~ 1 token).
   */
  getFileMap(map: RepoMap, maxTokens = 2000): string {
    const maxChars = maxTokens * 4
    const lines: string[] = []
    let totalChars = 0

    // Sort files: those with more referenced symbols first
    const filesWithScore = map.files
      .map((f) => ({
        file: f,
        score: f.symbols.reduce((sum, s) => sum + s.references, 0),
      }))
      .sort((a, b) => b.score - a.score)

    for (const { file } of filesWithScore) {
      if (file.symbols.length === 0) continue

      // Sort symbols within file by reference count
      const sortedSymbols = [...file.symbols].sort(
        (a, b) => b.references - a.references,
      )

      const symbolNames = sortedSymbols.map(
        (s) =>
          `${s.name}${s.kind === 'class' || s.kind === 'interface' ? ` (${s.kind})` : ''}`,
      )
      const line = `${file.path}: ${symbolNames.join(', ')}`

      if (totalChars + line.length + 1 > maxChars) {
        // Try a truncated version with fewer symbols
        const shortSymbols = symbolNames.slice(0, 3)
        const shortLine = `${file.path}: ${shortSymbols.join(', ')}${symbolNames.length > 3 ? ', ...' : ''}`
        if (totalChars + shortLine.length + 1 > maxChars) break
        lines.push(shortLine)
        totalChars += shortLine.length + 1
      } else {
        lines.push(line)
        totalChars += line.length + 1
      }
    }

    return lines.join('\n')
  }

  /**
   * Find files that import or are imported by the given file.
   */
  getRelatedFiles(map: RepoMap, filePath: string): { imports: string[]; importedBy: string[] } {
    const normalizedPath = filePath.replace(/^\.\//, '')

    // Files this file imports
    const imports = map.referenceGraph.get(normalizedPath) ?? []

    // Files that import this file
    const importedBy: string[] = []
    for (const [file, deps] of map.referenceGraph) {
      if (deps.includes(normalizedPath)) {
        importedBy.push(file)
      }
    }

    return { imports, importedBy }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Try to resolve an import string to a file in the repo.
   */
  private resolveImport(
    importPath: string,
    fromFile: string,
    files: FileEntry[],
  ): string | null {
    // Skip external packages
    if (
      !importPath.startsWith('.') &&
      !importPath.startsWith('/') &&
      !importPath.startsWith('src/')
    ) {
      return null
    }

    const dir = path.dirname(fromFile)
    const resolved = path.normalize(path.join(dir, importPath))

    // Try exact match and common extensions
    const candidates = [
      resolved,
      `${resolved}.ts`,
      `${resolved}.tsx`,
      `${resolved}.js`,
      `${resolved}.jsx`,
      `${resolved}.py`,
      `${resolved}.go`,
      `${resolved}.rs`,
      `${resolved}.java`,
      path.join(resolved, 'index.ts'),
      path.join(resolved, 'index.tsx'),
      path.join(resolved, 'index.js'),
      path.join(resolved, 'index.jsx'),
    ]

    const fileSet = new Set(files.map((f) => f.path))

    for (const candidate of candidates) {
      const normalized = candidate.replace(/\\/g, '/')
      if (fileSet.has(normalized)) return normalized
      // Also try without leading ./
      const withoutDotSlash = normalized.replace(/^\.\//, '')
      if (fileSet.has(withoutDotSlash)) return withoutDotSlash
    }

    return null
  }

  /**
   * Count how many files reference each symbol by scanning file contents
   * for symbol name usage.
   */
  private countReferences(
    files: FileEntry[],
    symbolIndex: Map<string, CodeSymbol[]>,
  ): void {
    // Build a set of symbol names that are worth tracking
    // (skip very short names that cause false positives)
    const trackableSymbols = new Map<string, CodeSymbol[]>()
    for (const [name, syms] of symbolIndex) {
      if (name.length >= 3) {
        trackableSymbols.set(name, syms)
      }
    }

    // For each file, scan its imports to see which files it references
    // Then give credit to symbols in those imported files
    for (const file of files) {
      // Build a set of words used in this file (approximate identifier extraction)
      const words = new Set<string>()
      const content = file.symbols.length > 0 || file.imports.length > 0
        ? this.getFileWords(file.path)
        : null

      if (!content) continue

      for (const word of content) {
        words.add(word)
      }

      // Check which symbols from OTHER files are referenced in this file
      for (const [name, syms] of trackableSymbols) {
        if (!words.has(name)) continue

        for (const sym of syms) {
          // Don't count self-references (symbol referenced in its own file)
          if (sym.file === file.path) continue
          sym.references++
        }
      }
    }
  }

  /**
   * Extract identifiers from a file for reference counting.
   */
  private getFileWords(filePath: string): Set<string> | null {
    const fullPath = path.join(this.root, filePath)
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const words = new Set<string>()
      // Match word-like tokens (identifiers)
      const matches = content.match(/\b[a-zA-Z_]\w{2,}\b/g)
      if (matches) {
        for (const m of matches) {
          words.add(m)
        }
      }
      return words
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience: module-level singleton builder
// ---------------------------------------------------------------------------

let _builderInstance: RepoMapBuilder | null = null
let _lastRoot: string | null = null

/**
 * Get or create a RepoMapBuilder for the given root directory.
 */
export function getBuilder(root: string, options?: Partial<RepoMapOptions>): RepoMapBuilder {
  if (_builderInstance && _lastRoot === root) return _builderInstance
  _builderInstance = new RepoMapBuilder({ root, ...options })
  _lastRoot = root
  return _builderInstance
}
