import { execSync } from 'child_process'
import { extname, relative, resolve } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: 'add' | 'delete' | 'context'
  content: string
  oldLineNum?: number
  newLineNum?: number
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  header: string
  lines: DiffLine[]
}

export interface DiffEntry {
  filePath: string
  relativePath: string
  language: string
  hunks: DiffHunk[]
  additions: number
  deletions: number
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  oldPath?: string
}

export interface ReviewSummary {
  totalFiles: number
  totalAdditions: number
  totalDeletions: number
  filesByStatus: Record<string, number>
  filesByLanguage: Record<string, number>
}

export interface DiffFilter {
  files?: string[]
  languages?: string[]
  minChanges?: number
  status?: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.xml': 'xml',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.r': 'r',
  '.lua': 'lua',
  '.php': 'php',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.vim': 'vim',
  '.el': 'elisp',
  '.clj': 'clojure',
  '.dart': 'dart',
  '.zig': 'zig',
}

function languageFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'unknown'
}

function statusIcon(status: DiffEntry['status']): string {
  switch (status) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
  }
}

// ---------------------------------------------------------------------------
// DiffParser
// ---------------------------------------------------------------------------

export class DiffParser {
  /**
   * Parse unified diff text (output of `git diff`) into structured DiffEntry
   * objects. Handles multiple files, renames, and binary diffs.
   */
  parseUnifiedDiff(diffText: string): DiffEntry[] {
    const entries: DiffEntry[] = []
    // Split on the "diff --git" delimiter while keeping the delimiter
    const fileSections = diffText.split(/^(?=diff --git )/m).filter(Boolean)

    for (const section of fileSections) {
      const entry = this.parseFileSection(section)
      if (entry) {
        entries.push(entry)
      }
    }

    return entries
  }

  private parseFileSection(section: string): DiffEntry | null {
    const lines = section.split('\n')
    if (lines.length === 0) {
      return null
    }

    // Extract file paths from "diff --git a/foo b/bar"
    const headerMatch = lines[0]?.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (!headerMatch) {
      return null
    }

    const oldPath = headerMatch[1]!
    const newPath = headerMatch[2]!

    // Determine status from the index/mode lines
    let status: DiffEntry['status'] = 'modified'
    let renamedFrom: string | undefined

    for (const line of lines.slice(1)) {
      if (line.startsWith('new file mode')) {
        status = 'added'
      } else if (line.startsWith('deleted file mode')) {
        status = 'deleted'
      } else if (line.startsWith('rename from ')) {
        status = 'renamed'
        renamedFrom = line.slice('rename from '.length)
      } else if (line.startsWith('@@') || line.startsWith('Binary')) {
        break
      }
    }

    // Parse hunks
    const hunks = this.parseHunks(section)

    // Count additions and deletions
    let additions = 0
    let deletions = 0
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') {
          additions++
        }
        if (line.type === 'delete') {
          deletions++
        }
      }
    }

    return {
      filePath: resolve(newPath),
      relativePath: newPath,
      language: languageFromPath(newPath),
      hunks,
      additions,
      deletions,
      status,
      ...(renamedFrom ? { oldPath: renamedFrom } : {}),
    }
  }

  private parseHunks(section: string): DiffHunk[] {
    const hunks: DiffHunk[] = []
    // Split on hunk headers
    const parts = section.split(/^(@@[^@]*@@.*$)/m)

    // parts come in pairs: [prefix, header, body, header, body, ...]
    for (let i = 1; i < parts.length; i += 2) {
      const header = parts[i]!
      const body = parts[i + 1] ?? ''
      const hunk = this.parseHunk(header + '\n' + body)
      if (hunk) {
        hunks.push(hunk)
      }
    }

    return hunks
  }

  /**
   * Parse a single @@ hunk including its header and lines.
   */
  parseHunk(hunkText: string): DiffHunk {
    const lines = hunkText.split('\n')
    const headerLine = lines[0] ?? ''

    // Parse @@ -oldStart,oldCount +newStart,newCount @@ optional header
    const match = headerLine.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/,
    )

    const oldStart = match ? parseInt(match[1]!, 10) : 1
    const oldCount = match && match[2] ? parseInt(match[2], 10) : 1
    const newStart = match ? parseInt(match[3]!, 10) : 1
    const newCount = match && match[4] ? parseInt(match[4], 10) : 1
    const header = headerLine

    let oldLineNum = oldStart
    let newLineNum = newStart

    const diffLines: DiffLine[] = []

    for (const rawLine of lines.slice(1)) {
      // Skip empty trailing lines from split
      if (rawLine === '' && lines.indexOf(rawLine) === lines.length - 1) {
        continue
      }

      const prefix = rawLine[0]
      const content = rawLine.slice(1)

      if (prefix === '+') {
        diffLines.push({
          type: 'add',
          content,
          newLineNum: newLineNum++,
        })
      } else if (prefix === '-') {
        diffLines.push({
          type: 'delete',
          content,
          oldLineNum: oldLineNum++,
        })
      } else if (prefix === ' ' || prefix === undefined) {
        // Context line or empty context line
        if (prefix === ' ') {
          diffLines.push({
            type: 'context',
            content,
            oldLineNum: oldLineNum++,
            newLineNum: newLineNum++,
          })
        }
      } else if (prefix === '\\') {
        // "\ No newline at end of file" — skip
        continue
      }
    }

    return {
      oldStart,
      oldCount,
      newStart,
      newCount,
      header,
      lines: diffLines,
    }
  }

  /**
   * Parse diff output into a ReviewSummary with aggregate statistics.
   */
  parseStat(diffText: string): ReviewSummary {
    const entries = this.parseUnifiedDiff(diffText)
    return this.buildSummary(entries)
  }

  private buildSummary(entries: DiffEntry[]): ReviewSummary {
    const filesByStatus: Record<string, number> = {}
    const filesByLanguage: Record<string, number> = {}
    let totalAdditions = 0
    let totalDeletions = 0

    for (const entry of entries) {
      totalAdditions += entry.additions
      totalDeletions += entry.deletions
      filesByStatus[entry.status] = (filesByStatus[entry.status] ?? 0) + 1
      filesByLanguage[entry.language] =
        (filesByLanguage[entry.language] ?? 0) + 1
    }

    return {
      totalFiles: entries.length,
      totalAdditions,
      totalDeletions,
      filesByStatus,
      filesByLanguage,
    }
  }

  /**
   * Classify a change based on its size and scope.
   */
  classifyChange(
    entry: DiffEntry,
  ): 'trivial' | 'minor' | 'major' | 'significant' {
    const total = entry.additions + entry.deletions
    if (total <= 5) {
      return 'trivial'
    }
    if (total <= 25) {
      return 'minor'
    }
    if (total <= 100) {
      return 'major'
    }
    return 'significant'
  }
}

// ---------------------------------------------------------------------------
// DiffFormatter
// ---------------------------------------------------------------------------

export class DiffFormatter {
  /**
   * Render all diffs in a unified view with file headers, gutters, and
   * coloured +/- prefixes.
   */
  formatUnified(entries: DiffEntry[]): string {
    const parts: string[] = []

    for (const entry of entries) {
      // File header
      const icon = statusIcon(entry.status)
      const rename =
        entry.status === 'renamed' && entry.oldPath
          ? ` (from ${entry.oldPath})`
          : ''
      parts.push(
        `━━━ ${icon} ${entry.relativePath}${rename} (+${entry.additions}, -${entry.deletions}) ━━━`,
      )

      for (const hunk of entry.hunks) {
        parts.push(hunk.header)

        for (const line of hunk.lines) {
          const oldGutter =
            line.oldLineNum !== undefined
              ? String(line.oldLineNum).padStart(4)
              : '    '
          const newGutter =
            line.newLineNum !== undefined
              ? String(line.newLineNum).padStart(4)
              : '    '

          if (line.type === 'add') {
            parts.push(`${oldGutter} ${newGutter} \x1b[32m+${line.content}\x1b[0m`)
          } else if (line.type === 'delete') {
            parts.push(`${oldGutter} ${newGutter} \x1b[31m-${line.content}\x1b[0m`)
          } else {
            parts.push(`${oldGutter} ${newGutter}  ${line.content}`)
          }
        }
      }

      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * Render diffs in a side-by-side view. The terminal width is split in half:
   * old content on the left, new content on the right.
   */
  formatSideBySide(entries: DiffEntry[], width: number): string {
    const halfWidth = Math.floor((width - 3) / 2) // 3 for the "│" divider + padding
    const parts: string[] = []

    for (const entry of entries) {
      const icon = statusIcon(entry.status)
      const header = `━━━ ${icon} ${entry.relativePath} (+${entry.additions}, -${entry.deletions}) ━━━`
      parts.push(header)

      for (const hunk of entry.hunks) {
        parts.push(hunk.header)

        // Collect left/right pairs. Walk through lines and align them.
        const leftLines: string[] = []
        const rightLines: string[] = []

        for (const line of hunk.lines) {
          if (line.type === 'context') {
            leftLines.push(` ${line.content}`)
            rightLines.push(` ${line.content}`)
          } else if (line.type === 'delete') {
            leftLines.push(`-${line.content}`)
            // Don't push to right yet — a matching add may follow
          } else if (line.type === 'add') {
            rightLines.push(`+${line.content}`)
          }

          // Balance: ensure arrays stay aligned for context lines
          while (
            leftLines.length > rightLines.length &&
            (hunk.lines[hunk.lines.indexOf(line) + 1]?.type !== 'add' ||
              line.type === 'context')
          ) {
            rightLines.push('')
            break
          }
          while (rightLines.length > leftLines.length) {
            leftLines.push('')
          }
        }

        // Pad to equal length
        while (leftLines.length < rightLines.length) {
          leftLines.push('')
        }
        while (rightLines.length < leftLines.length) {
          rightLines.push('')
        }

        for (let i = 0; i < leftLines.length; i++) {
          const left = (leftLines[i] ?? '').slice(0, halfWidth).padEnd(halfWidth)
          const right = (rightLines[i] ?? '').slice(0, halfWidth)
          parts.push(`${left} │ ${right}`)
        }
      }

      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * Compact summary view showing stats per file with a visual bar chart.
   */
  formatSummary(entries: DiffEntry[]): string {
    const parts: string[] = []
    let totalAdd = 0
    let totalDel = 0
    const maxBarWidth = 40

    // Find the max change count for scaling the bar chart
    let maxChanges = 0
    for (const entry of entries) {
      const total = entry.additions + entry.deletions
      if (total > maxChanges) {
        maxChanges = total
      }
      totalAdd += entry.additions
      totalDel += entry.deletions
    }

    for (const entry of entries) {
      const icon = statusIcon(entry.status)
      const stats = `(+${entry.additions}, -${entry.deletions})`
      const total = entry.additions + entry.deletions
      const barLen =
        maxChanges > 0 ? Math.max(1, Math.round((total / maxChanges) * maxBarWidth)) : 1
      const addLen = Math.round((entry.additions / Math.max(total, 1)) * barLen)
      const delLen = barLen - addLen
      const bar =
        '\x1b[32m' +
        '+'.repeat(addLen) +
        '\x1b[31m' +
        '-'.repeat(delLen) +
        '\x1b[0m'
      parts.push(`  ${icon} ${entry.relativePath.padEnd(50)} ${stats.padEnd(14)} ${bar}`)
    }

    parts.push('')
    parts.push(
      `  ${entries.length} file(s) changed, \x1b[32m+${totalAdd}\x1b[0m additions, \x1b[31m-${totalDel}\x1b[0m deletions`,
    )

    return parts.join('\n')
  }

  /**
   * Format entries after applying a filter.
   */
  formatFiltered(entries: DiffEntry[], filter: DiffFilter): string {
    const filtered = applyFilter(entries, filter)
    return this.formatUnified(filtered)
  }
}

function applyFilter(entries: DiffEntry[], filter: DiffFilter): DiffEntry[] {
  let result = entries

  if (filter.files && filter.files.length > 0) {
    const set = new Set(filter.files)
    result = result.filter(
      (e) => set.has(e.relativePath) || set.has(e.filePath),
    )
  }

  if (filter.languages && filter.languages.length > 0) {
    const set = new Set(filter.languages.map((l) => l.toLowerCase()))
    result = result.filter((e) => set.has(e.language))
  }

  if (filter.minChanges !== undefined) {
    const min = filter.minChanges
    result = result.filter((e) => e.additions + e.deletions >= min)
  }

  if (filter.status && filter.status.length > 0) {
    const set = new Set(filter.status)
    result = result.filter((e) => set.has(e.status))
  }

  return result
}

// ---------------------------------------------------------------------------
// ReviewSession
// ---------------------------------------------------------------------------

export class ReviewSession {
  entries: DiffEntry[] = []
  currentIndex = 0

  private parser = new DiffParser()
  private cwd: string

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd()
  }

  // -- Loading ----------------------------------------------------------------

  /**
   * Load diff from `git diff` with optional extra arguments.
   */
  async loadFromGit(args?: string): Promise<void> {
    const cmd = args ? `git diff ${args}` : 'git diff'
    const output = this.exec(cmd)
    this.entries = this.parser.parseUnifiedDiff(output)
    this.currentIndex = 0
  }

  /**
   * Load staged changes (`git diff --staged`).
   */
  async loadFromStaged(): Promise<void> {
    const output = this.exec('git diff --staged')
    this.entries = this.parser.parseUnifiedDiff(output)
    this.currentIndex = 0
  }

  /**
   * Load diff between a branch and HEAD (`git diff <branch>...HEAD`).
   */
  async loadFromBranch(branch: string): Promise<void> {
    const output = this.exec(`git diff ${branch}...HEAD`)
    this.entries = this.parser.parseUnifiedDiff(output)
    this.currentIndex = 0
  }

  // -- Navigation -------------------------------------------------------------

  next(): void {
    if (this.currentIndex < this.entries.length - 1) {
      this.currentIndex++
    }
  }

  prev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--
    }
  }

  goTo(index: number): void {
    if (index >= 0 && index < this.entries.length) {
      this.currentIndex = index
    }
  }

  getCurrentEntry(): DiffEntry {
    return this.entries[this.currentIndex]!
  }

  // -- Summaries & Filtering --------------------------------------------------

  getSummary(): ReviewSummary {
    return this.parser.parseStat(this.formatRawEntries())
  }

  /**
   * Build a ReviewSummary directly from the loaded entries without re-parsing.
   */
  private buildSummaryFromEntries(): ReviewSummary {
    const filesByStatus: Record<string, number> = {}
    const filesByLanguage: Record<string, number> = {}
    let totalAdditions = 0
    let totalDeletions = 0

    for (const entry of this.entries) {
      totalAdditions += entry.additions
      totalDeletions += entry.deletions
      filesByStatus[entry.status] = (filesByStatus[entry.status] ?? 0) + 1
      filesByLanguage[entry.language] =
        (filesByLanguage[entry.language] ?? 0) + 1
    }

    return {
      totalFiles: this.entries.length,
      totalAdditions,
      totalDeletions,
      filesByStatus,
      filesByLanguage,
    }
  }

  filter(filter: DiffFilter): DiffEntry[] {
    return applyFilter(this.entries, filter)
  }

  getChangesByFile(): Map<string, DiffEntry> {
    const map = new Map<string, DiffEntry>()
    for (const entry of this.entries) {
      map.set(entry.relativePath, entry)
    }
    return map
  }

  // -- Internal ---------------------------------------------------------------

  private exec(cmd: string): string {
    try {
      return execSync(cmd, {
        cwd: this.cwd,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50 MB
      })
    } catch {
      // git diff exits with code 1 when there are differences — that's expected.
      // If the command truly fails it will throw and we return empty.
      return ''
    }
  }

  /**
   * Reconstruct raw unified diff text from parsed entries (used internally
   * by getSummary when we already have parsed data).
   */
  private formatRawEntries(): string {
    // It's simpler to just re-run git diff for the stat, but we already
    // have the parsed entries. Build a minimal unified diff string.
    const parts: string[] = []
    for (const entry of this.entries) {
      parts.push(`diff --git a/${entry.relativePath} b/${entry.relativePath}`)
      for (const hunk of entry.hunks) {
        parts.push(hunk.header)
        for (const line of hunk.lines) {
          if (line.type === 'add') {
            parts.push(`+${line.content}`)
          } else if (line.type === 'delete') {
            parts.push(`-${line.content}`)
          } else {
            parts.push(` ${line.content}`)
          }
        }
      }
    }
    return parts.join('\n')
  }
}
