/**
 * AutoCommitManager — automatic git commits with smart Conventional Commit messages.
 *
 * Analyzes diffs to determine commit type (feat, fix, chore, etc.) and generates
 * descriptive commit messages. Inspired by Aider's auto-commit workflow.
 *
 * Uses only Node.js built-ins (fs, path, os, crypto, child_process).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoCommitConfig = {
  enabled: boolean
  conventionalCommits: boolean
  prefix: string
  author: string | null
  signoff: boolean
}

export type CommitResult = {
  success: boolean
  hash: string
  message: string
  filesCommitted: number
}

export type UndoResult = {
  success: boolean
  hash: string
  message: string
}

export type CommitEntry = {
  hash: string
  message: string
  timestamp: string
  files: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), '.void')
const CONFIG_PATH = join(CONFIG_DIR, 'autocommit.json')
const TRAILER = '(void)'

const DEFAULT_CONFIG: AutoCommitConfig = {
  enabled: false,
  conventionalCommits: true,
  prefix: '',
  author: null,
  signoff: false,
}

// ---------------------------------------------------------------------------
// Diff analysis helpers
// ---------------------------------------------------------------------------

type CommitType = 'feat' | 'fix' | 'chore' | 'test' | 'docs' | 'refactor'

const TEST_PATTERNS = [
  /test[s]?\//i,
  /\.test\./i,
  /\.spec\./i,
  /__tests__\//i,
  /\.test$/i,
]

const DOC_PATTERNS = [
  /\.md$/i,
  /docs?\//i,
  /readme/i,
  /changelog/i,
  /license/i,
  /\.txt$/i,
  /\.rst$/i,
]

const CONFIG_PATTERNS = [
  /\.config\./i,
  /\.json$/i,
  /\.ya?ml$/i,
  /\.toml$/i,
  /\.ini$/i,
  /\.env/i,
  /eslint/i,
  /prettier/i,
  /tsconfig/i,
  /webpack/i,
  /vite\.config/i,
  /rollup/i,
  /babel/i,
  /jest\.config/i,
  /package\.json$/i,
  /Makefile$/i,
  /Dockerfile$/i,
  /docker-compose/i,
]

const BUG_PATTERNS = [
  /fix(es|ed)?[\s:]/i,
  /bug/i,
  /patch/i,
  /correct(s|ed|ion)?/i,
  /repair/i,
  /resolv(e|es|ed)/i,
]

/**
 * Parse a unified diff to extract file-level metadata.
 */
function parseDiffFiles(diff: string): {
  added: string[]
  deleted: string[]
  modified: string[]
} {
  const added: string[] = []
  const deleted: string[] = []
  const modified: string[] = []

  const diffHeaders = diff.split(/^diff --git /m).filter(Boolean)

  for (const section of diffHeaders) {
    const headerMatch = section.match(/^a\/(.+?) b\/(.+)/)
    if (!headerMatch) continue

    const filePath = headerMatch[2]

    if (section.includes('new file mode')) {
      added.push(filePath)
    } else if (section.includes('deleted file mode')) {
      deleted.push(filePath)
    } else {
      modified.push(filePath)
    }
  }

  return { added, deleted, modified }
}

/**
 * Determine the conventional commit type from diff content and file paths.
 */
function determineCommitType(
  diff: string,
  files: { added: string[]; deleted: string[]; modified: string[] },
): CommitType {
  const allFiles = [...files.added, ...files.deleted, ...files.modified]

  // New files => feat
  if (files.added.length > 0 && files.deleted.length === 0 && files.modified.length === 0) {
    return 'feat'
  }

  // Deleted files only => chore
  if (files.deleted.length > 0 && files.added.length === 0 && files.modified.length === 0) {
    return 'chore'
  }

  // All test files => test
  if (allFiles.length > 0 && allFiles.every((f) => TEST_PATTERNS.some((p) => p.test(f)))) {
    return 'test'
  }

  // All doc files => docs
  if (allFiles.length > 0 && allFiles.every((f) => DOC_PATTERNS.some((p) => p.test(f)))) {
    return 'docs'
  }

  // All config files => chore
  if (allFiles.length > 0 && allFiles.every((f) => CONFIG_PATTERNS.some((p) => p.test(f)))) {
    return 'chore'
  }

  // Bug-like changes in the diff body => fix
  if (BUG_PATTERNS.some((p) => p.test(diff))) {
    return 'fix'
  }

  // Default
  return 'refactor'
}

/**
 * Compute the scope from a list of file paths (common directory prefix).
 */
function computeScope(files: string[]): string {
  if (files.length === 0) return ''
  if (files.length === 1) {
    const dir = dirname(files[0])
    return dir === '.' ? basename(files[0], extname(files[0])) : lastSegment(dir)
  }

  const dirs = files.map((f) => dirname(f).split('/'))
  const minLen = Math.min(...dirs.map((d) => d.length))
  const common: string[] = []

  for (let i = 0; i < minLen; i++) {
    const seg = dirs[0][i]
    if (dirs.every((d) => d[i] === seg)) {
      common.push(seg)
    } else {
      break
    }
  }

  const prefix = common.join('/')
  if (!prefix || prefix === '.') return ''
  return lastSegment(prefix)
}

function lastSegment(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || ''
}

function extname(filePath: string): string {
  const base = basename(filePath)
  const dotIdx = base.lastIndexOf('.')
  return dotIdx <= 0 ? '' : base.slice(dotIdx)
}

/**
 * Build a short description from changed files.
 */
function buildDescription(files: {
  added: string[]
  deleted: string[]
  modified: string[]
}): string {
  const parts: string[] = []

  if (files.added.length > 0) {
    const names = files.added.map((f) => basename(f))
    parts.push(`add ${summarizeNames(names)}`)
  }
  if (files.deleted.length > 0) {
    const names = files.deleted.map((f) => basename(f))
    parts.push(`remove ${summarizeNames(names)}`)
  }
  if (files.modified.length > 0) {
    const names = files.modified.map((f) => basename(f))
    parts.push(`update ${summarizeNames(names)}`)
  }

  return parts.join(', ') || 'update files'
}

function summarizeNames(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

// ---------------------------------------------------------------------------
// AutoCommitManager
// ---------------------------------------------------------------------------

export class AutoCommitManager {
  private config: AutoCommitConfig
  private history: CommitEntry[] = []
  private undoCount = 0

  constructor() {
    this.config = this.loadConfig()
  }

  // -- Config persistence ---------------------------------------------------

  private loadConfig(): AutoCommitConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AutoCommitConfig>
        return { ...DEFAULT_CONFIG, ...parsed }
      }
    } catch {
      // Ignore corrupted config — fall through to defaults.
    }
    return { ...DEFAULT_CONFIG }
  }

  private saveConfig(): void {
    try {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true })
      }
      writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2) + '\n', 'utf-8')
    } catch {
      // Best-effort persistence.
    }
  }

  // -- Public API -----------------------------------------------------------

  enable(): void {
    this.config.enabled = true
    this.saveConfig()
  }

  disable(): void {
    this.config.enabled = false
    this.saveConfig()
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  configure(opts: Partial<AutoCommitConfig>): void {
    this.config = { ...this.config, ...opts }
    this.saveConfig()
  }

  getConfig(): AutoCommitConfig {
    return { ...this.config }
  }

  /**
   * Generate a Conventional Commit message from a unified diff string.
   */
  generateMessage(diff: string, context?: string): string {
    const files = parseDiffFiles(diff)
    const allFiles = [...files.added, ...files.deleted, ...files.modified]

    const commitType = this.config.conventionalCommits
      ? determineCommitType(diff, files)
      : null

    const scope = computeScope(allFiles)
    const description = context || buildDescription(files)

    let message = ''

    if (commitType) {
      message = scope ? `${commitType}(${scope}): ${description}` : `${commitType}: ${description}`
    } else {
      message = description
    }

    if (this.config.prefix) {
      message = `${this.config.prefix} ${message}`
    }

    // Append trailer
    message += `\n\n${TRAILER}`

    return message
  }

  /**
   * Stage the given files and create a commit with an auto-generated message.
   */
  commit(files: string[], context?: string): CommitResult {
    try {
      // Stage files
      if (files.length > 0) {
        git(['add', '--', ...files])
      }

      // Get diff of staged changes
      const diff = git(['diff', '--cached'])

      if (!diff) {
        return { success: false, hash: '', message: 'No staged changes to commit.', filesCommitted: 0 }
      }

      const message = this.generateMessage(diff, context)

      // Build commit args
      const commitArgs = ['commit', '-m', message]

      if (this.config.author) {
        commitArgs.push('--author', this.config.author)
      }
      if (this.config.signoff) {
        commitArgs.push('--signoff')
      }

      git(commitArgs)

      // Retrieve the hash of the new commit
      const hash = git(['rev-parse', '--short', 'HEAD'])
      const firstLine = message.split('\n')[0]

      // Record in history
      this.history.unshift({
        hash,
        message: firstLine,
        timestamp: new Date().toISOString(),
        files: [...files],
      })

      return {
        success: true,
        hash,
        message: firstLine,
        filesCommitted: files.length,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return { success: false, hash: '', message: errorMessage, filesCommitted: 0 }
    }
  }

  /**
   * Undo the last auto-commit via `git reset HEAD~1`.
   */
  undo(): UndoResult {
    try {
      const hash = git(['rev-parse', '--short', 'HEAD'])
      const message = git(['log', '-1', '--format=%s'])

      git(['reset', 'HEAD~1'])

      this.undoCount++

      return { success: true, hash, message: `Undone: ${message}` }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return { success: false, hash: '', message: errorMessage }
    }
  }

  /**
   * Return recent auto-commits from in-memory history.
   */
  getHistory(limit = 10): CommitEntry[] {
    return this.history.slice(0, limit)
  }

  /**
   * Return aggregate statistics.
   */
  getStats(): { totalCommits: number; undoCount: number } {
    return {
      totalCommits: this.history.length,
      undoCount: this.undoCount,
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AutoCommitManager | null = null

export function getAutoCommitManager(): AutoCommitManager {
  if (!instance) {
    instance = new AutoCommitManager()
  }
  return instance
}
