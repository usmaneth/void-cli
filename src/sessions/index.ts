import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  id: string // UUID
  title: string // auto-generated or user-provided
  titleUserSet?: boolean // true if user explicitly set the title
  createdAt: number // timestamp
  updatedAt: number // timestamp
  messageCount: number
  tokenUsage: { input: number; output: number }
  cwd: string // working directory
  branch?: string // git branch
  tags: string[]
  /**
   * Auto-generated conversation summary (PR #58 column).
   * Populated by auto-compaction. First line doubles as the default title
   * when the user hasn't set one explicitly.
   */
  summary?: string
  /** Count of messages summarised into `summary` at last re-summarise. */
  summarizedMessageCount?: number
  /** ISO/epoch timestamp of the most recent auto-compaction. */
  compactedAt?: number
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  tokenUsage?: { input: number; output: number }
  toolCalls?: Array<{ name: string; result: string }>
  /** Marker set on a synthetic system message produced by auto-compaction. */
  compactedAt?: number
}

// ---------------------------------------------------------------------------
// SessionStore – low-level persistence
// ---------------------------------------------------------------------------

export class SessionStore {
  readonly storePath: string

  constructor(storePath?: string) {
    this.storePath =
      storePath ??
      join(
        process.env.VOID_CONFIG_DIR ??
          process.env.CLAUDE_CONFIG_DIR ??
          join(homedir(), '.void'),
        'sessions',
      )
    mkdirSync(this.storePath, { recursive: true })
  }

  // ---- helpers -----------------------------------------------------------

  private sessionDir(sessionId: string): string {
    return join(this.storePath, sessionId)
  }

  private metadataPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'metadata.json')
  }

  private messagesPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'messages.jsonl')
  }

  /** Path to a stashed pre-compaction copy of messages (supports /uncompact). */
  private stashPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'messages.pre-compact.jsonl')
  }

  /** Persist the current messages as a pre-compaction stash for rollback. */
  stashMessages(sessionId: string, messages: SessionMessage[]): void {
    const dir = this.sessionDir(sessionId)
    mkdirSync(dir, { recursive: true })
    const jsonl = messages.map(m => JSON.stringify(m)).join('\n')
    writeFileSync(this.stashPath(sessionId), jsonl ? jsonl + '\n' : '')
  }

  /** Return the stashed messages if any, or null. */
  loadStash(sessionId: string): SessionMessage[] | null {
    const path = this.stashPath(sessionId)
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8').trim()
    if (raw.length === 0) return []
    const out: SessionMessage[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length > 0) out.push(JSON.parse(line))
    }
    return out
  }

  /** Remove the pre-compaction stash. */
  clearStash(sessionId: string): void {
    const path = this.stashPath(sessionId)
    if (existsSync(path)) {
      rmSync(path, { force: true })
    }
  }

  /** Overwrite the entire messages.jsonl — used by compaction and uncompaction. */
  rewriteMessages(sessionId: string, messages: SessionMessage[]): void {
    const dir = this.sessionDir(sessionId)
    mkdirSync(dir, { recursive: true })
    const jsonl = messages.map(m => JSON.stringify(m)).join('\n')
    writeFileSync(this.messagesPath(sessionId), jsonl ? jsonl + '\n' : '')
  }

  // ---- public API --------------------------------------------------------

  save(session: SessionMetadata, messages: SessionMessage[]): void {
    const dir = this.sessionDir(session.id)
    mkdirSync(dir, { recursive: true })

    writeFileSync(this.metadataPath(session.id), JSON.stringify(session, null, 2))

    // Write messages as JSONL (one JSON object per line)
    const jsonl = messages.map(m => JSON.stringify(m)).join('\n')
    writeFileSync(this.messagesPath(session.id), jsonl ? jsonl + '\n' : '')
  }

  load(sessionId: string): { metadata: SessionMetadata; messages: SessionMessage[] } | null {
    const metaFile = this.metadataPath(sessionId)
    if (!existsSync(metaFile)) {
      return null
    }

    const metadata: SessionMetadata = JSON.parse(readFileSync(metaFile, 'utf-8'))

    const msgFile = this.messagesPath(sessionId)
    const messages: SessionMessage[] = []
    if (existsSync(msgFile)) {
      const raw = readFileSync(msgFile, 'utf-8').trim()
      if (raw.length > 0) {
        for (const line of raw.split('\n')) {
          if (line.trim().length > 0) {
            messages.push(JSON.parse(line))
          }
        }
      }
    }

    return { metadata, messages }
  }

  list(options?: { limit?: number; search?: string }): SessionMetadata[] {
    if (!existsSync(this.storePath)) {
      return []
    }

    const entries = readdirSync(this.storePath, { withFileTypes: true })
    const sessions: SessionMetadata[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metaFile = this.metadataPath(entry.name)
      if (!existsSync(metaFile)) continue
      try {
        const meta: SessionMetadata = JSON.parse(readFileSync(metaFile, 'utf-8'))
        // If the user hasn't set a title and a summary exists, the list view
        // should surface the summary's first line rather than stale heuristic.
        if (!meta.titleUserSet && meta.summary) {
          const firstLine = meta.summary.split('\n')[0]?.trim()
          if (firstLine && firstLine.length > 0) {
            meta.title = firstLine.slice(0, 80)
          }
        }
        sessions.push(meta)
      } catch {
        // skip corrupted metadata files
      }
    }

    // Sort by updatedAt descending (most recent first)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)

    // Apply search filter
    if (options?.search) {
      const query = options.search.toLowerCase()
      const filtered = sessions.filter(
        s =>
          s.title.toLowerCase().includes(query) ||
          s.tags.some(t => t.toLowerCase().includes(query)),
      )
      return options?.limit ? filtered.slice(0, options.limit) : filtered
    }

    return options?.limit ? sessions.slice(0, options.limit) : sessions
  }

  delete(sessionId: string): boolean {
    const dir = this.sessionDir(sessionId)
    if (!existsSync(dir)) {
      return false
    }
    rmSync(dir, { recursive: true, force: true })
    return true
  }

  updateTitle(sessionId: string, title: string): boolean {
    const metaFile = this.metadataPath(sessionId)
    if (!existsSync(metaFile)) {
      return false
    }
    const meta: SessionMetadata = JSON.parse(readFileSync(metaFile, 'utf-8'))
    meta.title = title
    meta.titleUserSet = true
    meta.updatedAt = Date.now()
    writeFileSync(metaFile, JSON.stringify(meta, null, 2))
    return true
  }

  addTag(sessionId: string, tag: string): boolean {
    const metaFile = this.metadataPath(sessionId)
    if (!existsSync(metaFile)) {
      return false
    }
    const meta: SessionMetadata = JSON.parse(readFileSync(metaFile, 'utf-8'))
    if (!meta.tags.includes(tag)) {
      meta.tags.push(tag)
      meta.updatedAt = Date.now()
      writeFileSync(metaFile, JSON.stringify(meta, null, 2))
    }
    return true
  }

  getRecent(count: number): SessionMetadata[] {
    return this.list({ limit: count })
  }

  /** Append a single message to the JSONL file without rewriting the whole file. */
  appendMessage(sessionId: string, message: SessionMessage): void {
    const msgFile = this.messagesPath(sessionId)
    appendFileSync(msgFile, JSON.stringify(message) + '\n')
  }

  /** Persist only the metadata file (e.g. after updating counters). */
  saveMetadata(session: SessionMetadata): void {
    const dir = this.sessionDir(session.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.metadataPath(session.id), JSON.stringify(session, null, 2))
  }
}

// ---------------------------------------------------------------------------
// SessionManager – higher-level session lifecycle
// ---------------------------------------------------------------------------

export class SessionManager {
  private store: SessionStore
  currentSession: SessionMetadata | null = null
  private messages: SessionMessage[] = []

  constructor(store?: SessionStore) {
    this.store = store ?? new SessionStore()
  }

  /** Create a brand-new session and set it as the active session. */
  startSession(cwd: string, branch?: string): SessionMetadata {
    const now = Date.now()
    const session: SessionMetadata = {
      id: randomUUID(),
      title: 'Untitled session',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenUsage: { input: 0, output: 0 },
      cwd,
      branch,
      tags: [],
    }
    this.currentSession = session
    this.messages = []
    // Persist the initial metadata so the directory exists on disk
    this.store.saveMetadata(session)
    return session
  }

  /** Append a message to the current session and persist incrementally. */
  recordMessage(message: SessionMessage): void {
    if (!this.currentSession) {
      throw new Error('No active session. Call startSession() first.')
    }
    this.messages.push(message)
    this.currentSession.messageCount++
    if (message.tokenUsage) {
      this.currentSession.tokenUsage.input += message.tokenUsage.input
      this.currentSession.tokenUsage.output += message.tokenUsage.output
    }
    this.currentSession.updatedAt = Date.now()

    // Auto-title after the first user message if still untitled
    if (
      this.currentSession.title === 'Untitled session' &&
      message.role === 'user'
    ) {
      this.currentSession.title = this.autoTitle(this.messages)
    }

    // Persist incrementally: append message + rewrite metadata
    this.store.appendMessage(this.currentSession.id, message)
    this.store.saveMetadata(this.currentSession)
  }

  /**
   * Generate a short title from the conversation.
   *
   * Heuristic: take the first user message, strip common filler words,
   * extract the leading meaningful tokens, and cap at 60 characters.
   */
  autoTitle(messages: SessionMessage[]): string {
    const firstUser = messages.find(m => m.role === 'user')
    if (!firstUser) return 'Untitled session'

    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'shall', 'can',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its',
      'that', 'this', 'these', 'those', 'of', 'in', 'to', 'for',
      'with', 'on', 'at', 'from', 'by', 'about', 'as', 'and', 'or',
      'but', 'if', 'not', 'no', 'so', 'just', 'please', 'thanks',
    ])

    // Take the first line (or the whole thing if single-line)
    const firstLine = firstUser.content.split('\n')[0] ?? firstUser.content
    const words = firstLine
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)

    // Keep meaningful words, up to 60 chars
    const meaningful: string[] = []
    let len = 0
    for (const word of words) {
      if (stopWords.has(word.toLowerCase())) continue
      if (len + word.length + (meaningful.length > 0 ? 1 : 0) > 60) break
      meaningful.push(word)
      len += word.length + (meaningful.length > 1 ? 1 : 0)
    }

    if (meaningful.length === 0) {
      // Fallback: just truncate the raw text
      return firstLine.slice(0, 60).trim() || 'Untitled session'
    }

    return meaningful.join(' ')
  }

  /** Finalize and persist the current session. */
  endSession(): SessionMetadata | null {
    if (!this.currentSession) return null
    this.currentSession.updatedAt = Date.now()
    this.store.save(this.currentSession, this.messages)
    const ended = this.currentSession
    this.currentSession = null
    this.messages = []
    return ended
  }

  /** Load a previous session and set it as active for continued use. */
  resumeSession(sessionId: string): SessionMetadata | null {
    const data = this.store.load(sessionId)
    if (!data) return null
    this.currentSession = data.metadata
    this.messages = data.messages
    return data.metadata
  }

  /** Export a session in the requested format. */
  exportSession(sessionId: string, format: 'json' | 'markdown' = 'json'): string | null {
    const data = this.store.load(sessionId)
    if (!data) return null

    if (format === 'json') {
      return JSON.stringify(
        { metadata: data.metadata, messages: data.messages },
        null,
        2,
      )
    }

    // Markdown export
    const lines: string[] = []
    lines.push(`# ${data.metadata.title}`)
    lines.push('')
    lines.push(`- **Session ID:** ${data.metadata.id}`)
    lines.push(`- **Created:** ${new Date(data.metadata.createdAt).toISOString()}`)
    lines.push(`- **Updated:** ${new Date(data.metadata.updatedAt).toISOString()}`)
    lines.push(`- **Messages:** ${data.metadata.messageCount}`)
    lines.push(`- **Working directory:** ${data.metadata.cwd}`)
    if (data.metadata.branch) {
      lines.push(`- **Branch:** ${data.metadata.branch}`)
    }
    if (data.metadata.tags.length > 0) {
      lines.push(`- **Tags:** ${data.metadata.tags.join(', ')}`)
    }
    lines.push(
      `- **Token usage:** ${data.metadata.tokenUsage.input} input / ${data.metadata.tokenUsage.output} output`,
    )
    lines.push('')
    lines.push('---')
    lines.push('')

    for (const msg of data.messages) {
      const ts = new Date(msg.timestamp).toISOString()
      const roleLabel = msg.role.charAt(0).toUpperCase() + msg.role.slice(1)
      lines.push(`### ${roleLabel} (${ts})`)
      lines.push('')
      lines.push(msg.content)
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('')
        lines.push('**Tool calls:**')
        for (const tc of msg.toolCalls) {
          lines.push(`- \`${tc.name}\`: ${tc.result}`)
        }
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  /** Access the underlying store for direct operations. */
  getStore(): SessionStore {
    return this.store
  }

  /** Get current in-memory messages for the active session. */
  getMessages(): SessionMessage[] {
    return [...this.messages]
  }

  /** Replace the in-memory messages (used by auto-compaction). */
  setMessages(messages: SessionMessage[]): void {
    this.messages = [...messages]
    if (this.currentSession) {
      this.currentSession.messageCount = this.messages.length
      this.currentSession.updatedAt = Date.now()
    }
  }

  /**
   * Apply an auto-compaction result to the active session.
   *
   * Stashes the pre-compaction messages (for /uncompact rollback),
   * persists the `summary` on metadata, and rewrites messages.jsonl as
   * `[synthetic summary] + preservedRecent`.
   *
   * Returns the new metadata snapshot.
   */
  applyCompaction(params: {
    summary: string
    preservedRecent: SessionMessage[]
    summarizedMessageCount: number
  }): SessionMetadata | null {
    if (!this.currentSession) return null
    const sessionId = this.currentSession.id

    // 1. Stash original messages (for rollback).
    this.store.stashMessages(sessionId, this.messages)

    // 2. Build the synthetic summary system message.
    const compactedAt = Date.now()
    const syntheticSummary: SessionMessage = {
      role: 'system',
      content: params.summary,
      timestamp: compactedAt,
      compactedAt,
    }

    // 3. Replace in-memory messages.
    const newMessages: SessionMessage[] = [syntheticSummary, ...params.preservedRecent]
    this.messages = newMessages

    // 4. Update metadata.
    this.currentSession.summary = params.summary
    this.currentSession.summarizedMessageCount = params.summarizedMessageCount
    this.currentSession.compactedAt = compactedAt
    this.currentSession.messageCount = newMessages.length
    this.currentSession.updatedAt = compactedAt

    // If the user never set a title, promote the summary's first line.
    if (!this.currentSession.titleUserSet) {
      const firstLine = params.summary.split('\n')[0]?.trim()
      if (firstLine) {
        this.currentSession.title = firstLine.slice(0, 80)
      }
    }

    // 5. Persist: rewrite messages.jsonl + metadata.
    this.store.rewriteMessages(sessionId, newMessages)
    this.store.saveMetadata(this.currentSession)

    return this.currentSession
  }

  /**
   * Roll back the most recent compaction. Restores messages from the stash
   * and clears `summary` / `compactedAt` on metadata. Returns true on success.
   */
  uncompact(): boolean {
    if (!this.currentSession) return false
    const sessionId = this.currentSession.id
    const stashed = this.store.loadStash(sessionId)
    if (!stashed) return false

    this.messages = stashed
    this.currentSession.messageCount = stashed.length
    this.currentSession.compactedAt = undefined
    this.currentSession.summary = undefined
    this.currentSession.summarizedMessageCount = undefined
    this.currentSession.updatedAt = Date.now()

    this.store.rewriteMessages(sessionId, stashed)
    this.store.saveMetadata(this.currentSession)
    this.store.clearStash(sessionId)
    return true
  }

  /** Explicitly set the title (marks titleUserSet so auto-compaction won't override). */
  setTitle(title: string): void {
    if (!this.currentSession) return
    this.currentSession.title = title
    this.currentSession.titleUserSet = true
    this.currentSession.updatedAt = Date.now()
    this.store.saveMetadata(this.currentSession)
  }
}
