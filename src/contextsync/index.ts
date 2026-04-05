/**
 * Workspace Context Sync — shared context materialization for agents.
 *
 * Design principles from 10x Core:
 * - Materialized views: project state as files agents can read
 * - Freshness tracking: stale data is automatically regenerated
 * - Agent collaboration: shared notes file for inter-agent communication
 *
 * Uses only Node.js built-ins.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync, rmSync } from 'fs'
import { join, relative, extname } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextFileType = 'repo-structure' | 'recent-changes' | 'open-issues' | 'test-status' | 'dependencies' | 'error-log' | 'agent-notes'

export type ContextFile = {
  type: ContextFileType
  path: string
  generatedAt: string
  staleAfterMs: number
  sizeBytes: number
}

export type ContextSyncConfig = {
  autoRefresh: boolean
  refreshIntervalMs: number
  staleThresholdMs: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectHash(): string {
  return createHash('sha256').update(process.cwd()).digest('hex').slice(0, 8)
}

function gitCmd(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { return '' }
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.c', '.cpp', '.h', '.cs', '.php', '.swift', '.kt'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.void', 'coverage', '.cache', 'vendor'])

// ---------------------------------------------------------------------------
// Context generators
// ---------------------------------------------------------------------------

function generateRepoStructure(): string {
  const lines: string[] = ['# Repository Structure', '']
  const cwd = process.cwd()

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 4) return
    let entries: string[]
    try { entries = readdirSync(dir).sort() } catch { return }

    const dirs: string[] = []
    const files: string[] = []

    for (const e of entries) {
      if (e.startsWith('.') && e !== '.env.example') continue
      if (SKIP_DIRS.has(e)) continue
      const full = join(dir, e)
      try {
        const st = statSync(full)
        if (st.isDirectory()) dirs.push(e)
        else files.push(e)
      } catch { continue }
    }

    for (const d of dirs) {
      lines.push(`${prefix}${d}/`)
      walk(join(dir, d), prefix + '  ', depth + 1)
    }
    for (const f of files) {
      lines.push(`${prefix}${f}`)
    }
  }

  walk(cwd, '', 0)
  return lines.join('\n')
}

function generateRecentChanges(): string {
  const log = gitCmd('git log --oneline -20')
  const diff = gitCmd('git diff --stat HEAD~5 2>/dev/null')
  const lines = ['# Recent Changes', '']
  if (log) { lines.push('## Recent Commits', log, '') }
  if (diff) { lines.push('## Recent File Changes', diff, '') }
  if (!log && !diff) lines.push('No git history available.')
  return lines.join('\n')
}

function generateOpenIssues(): string {
  const patterns = [/\/\/\s*(TODO|FIXME|HACK|XXX|BUG|OPTIMIZE):?\s*(.*)/i, /#\s*(TODO|FIXME|HACK|XXX):?\s*(.*)/i]
  const issues: string[] = []
  const cwd = process.cwd()

  function scan(dir: string): void {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e.startsWith('.') || SKIP_DIRS.has(e)) continue
      const full = join(dir, e)
      try {
        const st = statSync(full)
        if (st.isDirectory()) { scan(full); continue }
        if (!SOURCE_EXTS.has(extname(e))) continue
        if (st.size > 500000) continue // skip huge files
        const content = readFileSync(full, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          for (const pat of patterns) {
            const m = lines[i].match(pat)
            if (m) {
              issues.push(`${relative(cwd, full)}:${i + 1} — ${m[1]}: ${m[2].trim()}`)
            }
          }
        }
      } catch { continue }
    }
  }

  scan(cwd)
  const header = ['# Open Issues (TODO/FIXME/HACK)', '', `Found ${issues.length} issues:`, '']
  return header.concat(issues.slice(0, 100)).join('\n')
}

function generateTestStatus(): string {
  const lines = ['# Test Status', '']
  // Check for cached test results
  const cached = join(homedir(), '.void', 'test-results.txt')
  if (existsSync(cached)) {
    try {
      const content = readFileSync(cached, 'utf8')
      lines.push(content)
      return lines.join('\n')
    } catch { /* fall through */ }
  }
  lines.push('No test data available.', 'Run tests to generate data.')
  return lines.join('\n')
}

function generateDependencies(): string {
  const lines = ['# Dependencies', '']
  const cwd = process.cwd()

  // package.json
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const deps = Object.keys(pkg.dependencies || {})
      const devDeps = Object.keys(pkg.devDependencies || {})
      lines.push(`## Node.js (package.json)`)
      lines.push(`Dependencies: ${deps.length}`)
      for (const d of deps.slice(0, 30)) lines.push(`  - ${d}: ${pkg.dependencies[d]}`)
      if (deps.length > 30) lines.push(`  ... and ${deps.length - 30} more`)
      lines.push(`Dev Dependencies: ${devDeps.length}`)
      for (const d of devDeps.slice(0, 20)) lines.push(`  - ${d}: ${pkg.devDependencies[d]}`)
      if (devDeps.length > 20) lines.push(`  ... and ${devDeps.length - 20} more`)
      lines.push('')
    } catch { /* skip */ }
  }

  // requirements.txt
  const reqPath = join(cwd, 'requirements.txt')
  if (existsSync(reqPath)) {
    try {
      const reqs = readFileSync(reqPath, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
      lines.push(`## Python (requirements.txt)`, `Packages: ${reqs.length}`)
      for (const r of reqs.slice(0, 30)) lines.push(`  - ${r.trim()}`)
      lines.push('')
    } catch { /* skip */ }
  }

  // go.mod
  const goModPath = join(cwd, 'go.mod')
  if (existsSync(goModPath)) {
    try {
      const content = readFileSync(goModPath, 'utf8')
      const requires = content.match(/require\s*\(([\s\S]*?)\)/)?.[1]?.split('\n').filter(l => l.trim()) ?? []
      lines.push(`## Go (go.mod)`, `Modules: ${requires.length}`)
      for (const r of requires.slice(0, 20)) lines.push(`  - ${r.trim()}`)
      lines.push('')
    } catch { /* skip */ }
  }

  if (lines.length === 2) lines.push('No dependency files found.')
  return lines.join('\n')
}

function generateErrorLog(): string {
  const lines = ['# Recent Errors', '']
  // Try to read from error stream history
  try {
    const { getErrorStreamManager } = require('../errorstream/index.js')
    const mgr = getErrorStreamManager()
    const errors = mgr.getRecentErrors(20)
    if (errors.length === 0) {
      lines.push('No recent errors.')
    } else {
      for (const e of errors) {
        lines.push(`[${e.timestamp}] ${e.pattern?.severity ?? 'error'}: ${e.message}`)
        if (e.file) lines.push(`  File: ${e.file}`)
      }
    }
  } catch {
    lines.push('Error stream not available.')
  }
  return lines.join('\n')
}

function generateAgentNotes(storeDir: string): string {
  const notesPath = join(storeDir, 'agent-notes.txt')
  if (existsSync(notesPath)) {
    return readFileSync(notesPath, 'utf8')
  }
  return '# Agent Notes\n\nNo notes yet. Use /contextsync note <text> to add one.'
}

// ---------------------------------------------------------------------------
// ContextSyncManager
// ---------------------------------------------------------------------------

const ALL_TYPES: ContextFileType[] = ['repo-structure', 'recent-changes', 'open-issues', 'test-status', 'dependencies', 'error-log', 'agent-notes']

export class ContextSyncManager {
  private storeDir: string
  private config: ContextSyncConfig = {
    autoRefresh: false,
    refreshIntervalMs: 60000,
    staleThresholdMs: 300000, // 5 minutes
  }
  private autoTimer: ReturnType<typeof setInterval> | null = null
  private manifest: Map<ContextFileType, ContextFile> = new Map()

  constructor() {
    this.storeDir = join(homedir(), '.void', 'context', projectHash())
    mkdirSync(this.storeDir, { recursive: true })
    this.loadManifest()
  }

  sync(): ContextFile[] {
    const results: ContextFile[] = []
    for (const type of ALL_TYPES) {
      if (this.isStale(type)) {
        results.push(this.syncFile(type))
      } else {
        results.push(this.manifest.get(type)!)
      }
    }
    return results
  }

  syncFile(type: ContextFileType): ContextFile {
    let content: string
    switch (type) {
      case 'repo-structure': content = generateRepoStructure(); break
      case 'recent-changes': content = generateRecentChanges(); break
      case 'open-issues': content = generateOpenIssues(); break
      case 'test-status': content = generateTestStatus(); break
      case 'dependencies': content = generateDependencies(); break
      case 'error-log': content = generateErrorLog(); break
      case 'agent-notes': content = generateAgentNotes(this.storeDir); break
      default: content = 'Unknown context type'
    }

    const filePath = join(this.storeDir, `${type}.txt`)
    writeFileSync(filePath, content)

    const cf: ContextFile = {
      type,
      path: filePath,
      generatedAt: new Date().toISOString(),
      staleAfterMs: this.config.staleThresholdMs,
      sizeBytes: Buffer.byteLength(content),
    }
    this.manifest.set(type, cf)
    this.saveManifest()
    return cf
  }

  getStatus(): ContextFile[] {
    return ALL_TYPES.map(t => this.manifest.get(t) ?? {
      type: t, path: '', generatedAt: '', staleAfterMs: this.config.staleThresholdMs, sizeBytes: 0,
    })
  }

  getFile(type: ContextFileType): string {
    const cf = this.manifest.get(type)
    if (!cf || !existsSync(cf.path)) return `Context file "${type}" not generated. Run /contextsync first.`
    return readFileSync(cf.path, 'utf8')
  }

  isStale(type: ContextFileType): boolean {
    const cf = this.manifest.get(type)
    if (!cf || !cf.generatedAt) return true
    return Date.now() - new Date(cf.generatedAt).getTime() > cf.staleAfterMs
  }

  enableAutoRefresh(): void {
    if (this.autoTimer) return
    this.config.autoRefresh = true
    this.autoTimer = setInterval(() => this.sync(), this.config.refreshIntervalMs)
    this.autoTimer.unref()
  }

  disableAutoRefresh(): void {
    this.config.autoRefresh = false
    if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null }
  }

  addNote(agentId: string, note: string): void {
    const notesPath = join(this.storeDir, 'agent-notes.txt')
    let existing = ''
    if (existsSync(notesPath)) existing = readFileSync(notesPath, 'utf8')
    if (!existing.startsWith('#')) existing = '# Agent Notes\n\n'
    const entry = `[${agentId}] [${new Date().toISOString()}] ${note}\n`
    writeFileSync(notesPath, existing + entry)
  }

  getNotes(): string {
    return this.getFile('agent-notes')
  }

  clearNotes(): void {
    const notesPath = join(this.storeDir, 'agent-notes.txt')
    writeFileSync(notesPath, '# Agent Notes\n\nCleared.\n')
  }

  getConfig(): ContextSyncConfig { return { ...this.config } }
  setConfig(cfg: Partial<ContextSyncConfig>): void { Object.assign(this.config, cfg) }

  cleanup(): void {
    this.disableAutoRefresh()
    this.manifest.clear()
    try { rmSync(this.storeDir, { recursive: true, force: true }) } catch { /* ignore */ }
    mkdirSync(this.storeDir, { recursive: true })
  }

  // -- Persistence --

  private saveManifest(): void {
    const data: Record<string, ContextFile> = {}
    for (const [k, v] of this.manifest) data[k] = v
    writeFileSync(join(this.storeDir, 'manifest.json'), JSON.stringify(data, null, 2))
  }

  private loadManifest(): void {
    const p = join(this.storeDir, 'manifest.json')
    if (!existsSync(p)) return
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'))
      for (const [k, v] of Object.entries(data)) this.manifest.set(k as ContextFileType, v as ContextFile)
    } catch { /* skip corrupt */ }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ContextSyncManager | null = null
export function getContextSyncManager(): ContextSyncManager {
  if (!_instance) _instance = new ContextSyncManager()
  return _instance
}
