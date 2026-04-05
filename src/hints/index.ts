import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join, relative, resolve, sep } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HintSection {
  title: string
  content: string
  type: 'rules' | 'conventions' | 'architecture' | 'testing' | 'context' | 'general'
}

export interface HintFile {
  path: string
  directory: string
  content: string
  depth: number
  sections: HintSection[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HINT_FILENAME = '.voidhints'
const ROOT_FALLBACK = 'VOID.md'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'vendor',
  '__pycache__',
])

const DEFAULT_TEMPLATE = `# Project Context

Describe what this project/directory does.

# Coding Conventions

- List coding conventions here
- e.g., "Use TypeScript strict mode"
- e.g., "Prefer functional patterns"

# Architecture

Describe the architecture and key patterns.

# Testing

- Describe testing requirements
- e.g., "Write unit tests for all public functions"

# Rules

- Files and patterns to never modify
- e.g., "Never modify files in /vendor"
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a section heading into a known type by looking for keywords.
 */
function classifySection(title: string): HintSection['type'] {
  const lower = title.toLowerCase()
  if (/\brules?\b/.test(lower)) return 'rules'
  if (/\bconventions?\b|coding\s+style|style\s+guide/.test(lower)) return 'conventions'
  if (/\barchitecture\b|design/.test(lower)) return 'architecture'
  if (/\btesting?\b|tests?\b/.test(lower)) return 'testing'
  if (/\bcontext\b|overview|about/.test(lower)) return 'context'
  return 'general'
}

/**
 * Parse markdown content into sections split on `#` headings.
 */
function parseSections(content: string): HintSection[] {
  const lines = content.split('\n')
  const sections: HintSection[] = []
  let currentTitle = ''
  let currentLines: string[] = []

  const flush = () => {
    const body = currentLines.join('\n').trim()
    if (currentTitle || body) {
      sections.push({
        title: currentTitle,
        content: body,
        type: classifySection(currentTitle),
      })
    }
  }

  for (const line of lines) {
    // Match top-level headings (# Heading)
    const match = line.match(/^#+\s+(.*)/)
    if (match) {
      flush()
      currentTitle = match[1]!.trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  flush()

  return sections
}

/**
 * Compute the depth of `dir` relative to `root`. Both must be absolute paths.
 */
function depthFromRoot(root: string, dir: string): number {
  const rel = relative(root, dir)
  if (rel === '') return 0
  return rel.split(sep).length
}

// ---------------------------------------------------------------------------
// HintsManager
// ---------------------------------------------------------------------------

export class HintsManager {
  private projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot)
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  getProjectRoot(): string {
    return this.projectRoot
  }

  /**
   * Walk the project tree and return metadata for every `.voidhints` file found.
   * Also checks for `VOID.md` at the project root as a fallback.
   */
  discover(): HintFile[] {
    const files: HintFile[] = []

    // Check for VOID.md at root
    const rootFallback = join(this.projectRoot, ROOT_FALLBACK)
    if (existsSync(rootFallback)) {
      const content = readFileSync(rootFallback, 'utf-8')
      files.push({
        path: rootFallback,
        directory: this.projectRoot,
        content,
        depth: 0,
        sections: parseSections(content),
      })
    }

    // Walk directory tree for .voidhints files
    this.walkDir(this.projectRoot, files)

    // Sort by depth (shallowest first)
    files.sort((a, b) => a.depth - b.depth)

    return files
  }

  /**
   * Discover and fully parse all hint files (same as discover since we parse eagerly).
   */
  load(): HintFile[] {
    return this.discover()
  }

  /**
   * Get the hints that are relevant for a specific file path.
   * Returns hints from the file's directory and all ancestor directories
   * up to the project root. Most specific (deepest) hints come last.
   */
  getHintsForFile(filePath: string): HintFile[] {
    const absPath = resolve(filePath)
    const fileDir = statSync(absPath, { throwIfNoEntry: false })?.isDirectory()
      ? absPath
      : dirname(absPath)

    // Ensure the file is under the project root
    const rel = relative(this.projectRoot, fileDir)
    if (rel.startsWith('..')) return []

    const allHints = this.load()

    // Collect the chain of directories from project root down to fileDir
    const relevantDirs = new Set<string>()
    let current = fileDir
    while (true) {
      relevantDirs.add(current)
      if (current === this.projectRoot) break
      const parent = dirname(current)
      if (parent === current) break // filesystem root guard
      current = parent
    }

    return allHints
      .filter(h => relevantDirs.has(h.directory))
      .sort((a, b) => a.depth - b.depth) // shallowest first, deepest last
  }

  /**
   * Build a combined context string from hint files.
   * If `filePath` is provided, only includes relevant hints for that file.
   */
  buildContext(filePath?: string): string {
    const hints = filePath ? this.getHintsForFile(filePath) : this.load()

    if (hints.length === 0) {
      return ''
    }

    const parts: string[] = []

    for (const hint of hints) {
      const relDir = relative(this.projectRoot, hint.directory) || '(project root)'
      const fileName = basename(hint.path)

      parts.push(`<!-- Hints from ${relDir} (${fileName}) -->`)
      parts.push('')

      for (const section of hint.sections) {
        if (section.title) {
          parts.push(`## [${relDir}] ${section.title}`)
        }
        if (section.content) {
          parts.push(section.content)
        }
        parts.push('')
      }
    }

    return parts.join('\n').trim()
  }

  /**
   * Parse a `.voidhints` file's content into typed sections.
   */
  parseFile(content: string): HintSection[] {
    return parseSections(content)
  }

  /**
   * Create a starter `.voidhints` template file in the given directory.
   * Returns the absolute path to the created file.
   */
  createTemplate(directory: string): string {
    const absDir = resolve(directory)
    const filePath = join(absDir, HINT_FILENAME)

    if (existsSync(filePath)) {
      throw new Error(`A ${HINT_FILENAME} file already exists at ${filePath}`)
    }

    writeFileSync(filePath, DEFAULT_TEMPLATE, 'utf-8')
    return filePath
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Recursively walk directories looking for `.voidhints` files.
   */
  private walkDir(dir: string, results: HintFile[]): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return // Permission denied or other read error
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue

      const fullPath = join(dir, entry)

      let stat
      try {
        stat = statSync(fullPath, { throwIfNoEntry: false })
      } catch {
        continue
      }
      if (!stat) continue

      if (stat.isFile() && entry === HINT_FILENAME) {
        const content = readFileSync(fullPath, 'utf-8')
        results.push({
          path: fullPath,
          directory: dir,
          content,
          depth: depthFromRoot(this.projectRoot, dir),
          sections: parseSections(content),
        })
      } else if (stat.isDirectory()) {
        this.walkDir(fullPath, results)
      }
    }
  }
}

export { DEFAULT_TEMPLATE }
