/**
 * @-mention context resolution — parses user input for @-mentions and resolves
 * them to contextual content, inspired by Cursor's @file/@docs/@web/@git system.
 *
 * Only uses Node.js built-ins; no external dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MentionType = 'file' | 'folder' | 'git' | 'errors' | 'recent' | 'tree'

export interface Mention {
  type: MentionType
  arg: string
  raw: string
  startIndex: number
  endIndex: number
}

export interface ResolvedMention {
  mention: Mention
  content: string
  tokenEstimate: number
}

export interface ResolvedInput {
  cleanInput: string
  context: ResolvedMention[]
  totalTokensEstimate: number
}

export interface MentionProvider {
  type: string
  description: string
  resolve: (arg: string) => string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MENTION_WITH_ARG_RE = /@(file|folder|git)\s+(\S+)/g
const MENTION_NO_ARG_RE = /@(errors|recent|tree)\b/g
const CHARS_PER_TOKEN = 4
const TREE_MAX_DEPTH = 4
const TREE_MAX_ENTRIES = 200

// ---------------------------------------------------------------------------
// Built-in provider descriptions
// ---------------------------------------------------------------------------

const BUILTIN_PROVIDERS: ReadonlyArray<MentionProvider> = [
  { type: 'file', description: 'Include file contents', resolve: resolveFile },
  { type: 'folder', description: 'Include directory listing with file summaries', resolve: resolveFolder },
  { type: 'git', description: 'Include git diff/log/show for a ref', resolve: resolveGit },
  { type: 'errors', description: 'Include current lint/build errors', resolve: resolveErrors },
  { type: 'recent', description: 'Include recently changed files (last 5 commits)', resolve: resolveRecent },
  { type: 'tree', description: 'Include project directory tree', resolve: resolveTree },
]

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function execGit(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

function resolveFile(arg: string): string {
  const resolved = path.resolve(arg)
  try {
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) {
      return `[error] ${resolved} is not a file.`
    }
    const content = fs.readFileSync(resolved, 'utf-8')
    return `--- file: ${resolved} ---\n${content}`
  } catch {
    return `[error] Cannot read file: ${resolved}`
  }
}

function resolveFolder(arg: string): string {
  const resolved = path.resolve(arg)
  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return `[error] ${resolved} is not a directory.`
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const lines: string[] = [`--- folder: ${resolved} ---`]

    for (const entry of entries) {
      const fullPath = path.join(resolved, entry.name)
      if (entry.isDirectory()) {
        lines.push(`  ${entry.name}/`)
      } else if (entry.isFile()) {
        const firstLine = readFirstLine(fullPath)
        lines.push(`  ${entry.name}${firstLine ? ` — ${firstLine}` : ''}`)
      } else {
        lines.push(`  ${entry.name} (symlink/other)`)
      }
    }

    return lines.join('\n')
  } catch {
    return `[error] Cannot read folder: ${resolved}`
  }
}

function readFirstLine(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(256)
    const bytesRead = fs.readSync(fd, buf, 0, 256, 0)
    fs.closeSync(fd)
    const text = buf.toString('utf-8', 0, bytesRead)
    const line = text.split('\n')[0]?.trim() ?? ''
    return line.length > 80 ? line.slice(0, 77) + '...' : line
  } catch {
    return ''
  }
}

function resolveGit(arg: string): string {
  // If arg contains ".." it is a range → use diff
  if (arg.includes('..')) {
    const diff = execGit(`git diff ${arg}`)
    if (!diff) return `[error] No diff output for range: ${arg}`
    return `--- git diff ${arg} ---\n${diff}`
  }

  // Otherwise treat as a single ref → git show
  const show = execGit(`git show ${arg}`)
  if (!show) return `[error] Could not resolve git ref: ${arg}`
  return `--- git show ${arg} ---\n${show}`
}

function resolveErrors(_arg: string): string {
  // Try to import the error stream manager dynamically at runtime.
  // Because this module is loaded lazily we cannot use top-level await;
  // instead we attempt a synchronous require-style approach via the
  // singleton that should already be initialised by the time mentions
  // are resolved.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getErrorStreamManager } = require('../errorstream/index.js') as {
      getErrorStreamManager: () => { getRecentErrors: (n: number) => ReadonlyArray<{ line: string; message: string }> }
    }
    const mgr = getErrorStreamManager()
    const errors = mgr.getRecentErrors(30)
    if (errors.length === 0) return '--- errors ---\nNo recent errors detected.'
    const lines = errors.map((e) => `  ${e.message || e.line}`)
    return `--- errors (${errors.length}) ---\n${lines.join('\n')}`
  } catch {
    return '--- errors ---\nError stream not available.'
  }
}

function resolveRecent(_arg: string): string {
  const files = execGit('git diff --name-only HEAD~5..HEAD')
  if (!files) return '--- recent ---\nNo recently changed files found.'

  const fileList = files.split('\n').filter(Boolean)
  const lines: string[] = [`--- recent (${fileList.length} files) ---`]

  for (const file of fileList) {
    const firstLine = readFirstLine(file)
    lines.push(`  ${file}${firstLine ? ` — ${firstLine}` : ''}`)
  }

  return lines.join('\n')
}

function resolveTree(_arg: string): string {
  const lines: string[] = ['--- tree ---']
  const gitignorePatterns = loadGitignorePatterns()
  walkTree('.', 0, lines, gitignorePatterns)
  return lines.join('\n')
}

function loadGitignorePatterns(): Set<string> {
  const patterns = new Set<string>()
  // Always ignore common directories
  patterns.add('node_modules')
  patterns.add('.git')
  patterns.add('dist')
  patterns.add('build')
  patterns.add('.next')
  patterns.add('coverage')
  patterns.add('__pycache__')

  try {
    const content = fs.readFileSync('.gitignore', 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        // Strip trailing slashes for directory matches
        patterns.add(trimmed.replace(/\/$/, ''))
      }
    }
  } catch {
    // No .gitignore, use defaults only
  }

  return patterns
}

function walkTree(
  dir: string,
  depth: number,
  lines: string[],
  ignored: Set<string>,
): void {
  if (depth > TREE_MAX_DEPTH || lines.length > TREE_MAX_ENTRIES) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  // Sort directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  const indent = '  '.repeat(depth)

  for (const entry of entries) {
    if (lines.length > TREE_MAX_ENTRIES) break
    if (ignored.has(entry.name)) continue

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`)
      walkTree(path.join(dir, entry.name), depth + 1, lines, ignored)
    } else {
      lines.push(`${indent}${entry.name}`)
    }
  }
}

// ---------------------------------------------------------------------------
// MentionResolver
// ---------------------------------------------------------------------------

export class MentionResolver {
  private customProviders: Map<string, MentionProvider> = new Map()

  /**
   * Parse input, resolve all mentions, and return enriched content.
   */
  resolve(input: string): ResolvedInput {
    const mentions = this.parseMentions(input)
    const context: ResolvedMention[] = []
    let totalTokensEstimate = 0

    for (const mention of mentions) {
      const content = this.resolveOne(mention)
      const tokenEstimate = estimateTokens(content)
      totalTokensEstimate += tokenEstimate
      context.push({ mention, content, tokenEstimate })
    }

    // Build clean input by stripping mention markers
    let cleanInput = input
    // Replace in reverse order to preserve indices
    for (let i = mentions.length - 1; i >= 0; i--) {
      const m = mentions[i]!
      cleanInput = cleanInput.slice(0, m.startIndex) + cleanInput.slice(m.endIndex)
    }
    cleanInput = cleanInput.replace(/\s{2,}/g, ' ').trim()

    return { cleanInput, context, totalTokensEstimate }
  }

  /**
   * Extract all @-mentions from text.
   */
  parseMentions(input: string): Mention[] {
    const mentions: Mention[] = []

    // Mentions with arguments: @file, @folder, @git
    const withArgRe = new RegExp(MENTION_WITH_ARG_RE.source, 'g')
    let match: RegExpExecArray | null
    while ((match = withArgRe.exec(input)) !== null) {
      mentions.push({
        type: match[1] as MentionType,
        arg: match[2]!,
        raw: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      })
    }

    // Mentions without arguments: @errors, @recent, @tree
    const noArgRe = new RegExp(MENTION_NO_ARG_RE.source, 'g')
    while ((match = noArgRe.exec(input)) !== null) {
      mentions.push({
        type: match[1] as MentionType,
        arg: '',
        raw: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      })
    }

    // Sort by start index so resolution order is predictable
    mentions.sort((a, b) => a.startIndex - b.startIndex)

    return mentions
  }

  /**
   * Resolve a single mention to its content string.
   */
  resolveOne(mention: Mention): string {
    // Check custom providers first
    const custom = this.customProviders.get(mention.type)
    if (custom) {
      try {
        return custom.resolve(mention.arg)
      } catch (err) {
        return `[error] Provider "${mention.type}" failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // Built-in resolution
    const builtin = BUILTIN_PROVIDERS.find((p) => p.type === mention.type)
    if (builtin) {
      try {
        return builtin.resolve(mention.arg)
      } catch (err) {
        return `[error] @${mention.type} failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    return `[error] Unknown mention type: @${mention.type}`
  }

  /**
   * List all available @-mention providers (built-in + custom).
   */
  listProviders(): MentionProvider[] {
    const providers = [...BUILTIN_PROVIDERS]
    for (const [, provider] of this.customProviders) {
      providers.push(provider)
    }
    return providers
  }

  /**
   * Register a custom @-mention provider. Overrides built-in providers of the
   * same type.
   */
  registerProvider(provider: MentionProvider): void {
    this.customProviders.set(provider.type, provider)
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: MentionResolver | null = null

export function getMentionResolver(): MentionResolver {
  if (!instance) {
    instance = new MentionResolver()
  }
  return instance
}
