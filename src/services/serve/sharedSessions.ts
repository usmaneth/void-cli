/**
 * Shared-session store.
 *
 * Maps a public `shareId` to a sessionId with optional expiration.
 *
 * This is the data model that PR #58's drizzle schema is extended with — a
 * `shared_sessions` table with columns (shareId TEXT PK, sessionId TEXT,
 * createdAt INT, expiresAt INT?). Because PR #58's drizzle migration infra
 * isn't yet merged in this worktree, we persist as JSON under
 * `~/.void/shared-sessions.json`. The shape is drop-in replaceable by a
 * drizzle-backed store once PR #58 lands — the `SharedSessionsStore` API is
 * identical to what the drizzle repo would expose.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface SharedSession {
  shareId: string
  sessionId: string
  createdAt: number
  expiresAt: number | null
}

interface SharedSessionsData {
  version: 1
  sessions: Record<string, SharedSession>
}

function defaultStorePath(): string {
  const base =
    process.env.VOID_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.void')
  return join(base, 'shared-sessions.json')
}

export function generateShareId(): string {
  // 12 bytes -> 16 base64url chars
  const buf = randomBytes(12)
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export class SharedSessionsStore {
  private readonly path: string
  private data: SharedSessionsData

  constructor(storePath?: string) {
    this.path = storePath ?? defaultStorePath()
    this.data = this.load()
  }

  private load(): SharedSessionsData {
    if (!existsSync(this.path)) {
      return { version: 1, sessions: {} }
    }
    try {
      const raw = readFileSync(this.path, 'utf-8')
      const parsed = JSON.parse(raw) as SharedSessionsData
      if (parsed.version !== 1 || typeof parsed.sessions !== 'object') {
        return { version: 1, sessions: {} }
      }
      return parsed
    } catch {
      return { version: 1, sessions: {} }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  /**
   * Create a share record for the given session. Returns the generated
   * share record (with a fresh shareId).
   */
  create(
    sessionId: string,
    opts?: { ttlMs?: number; shareId?: string },
  ): SharedSession {
    const shareId = opts?.shareId ?? generateShareId()
    const now = Date.now()
    const record: SharedSession = {
      shareId,
      sessionId,
      createdAt: now,
      expiresAt: opts?.ttlMs ? now + opts.ttlMs : null,
    }
    this.data.sessions[shareId] = record
    this.save()
    return record
  }

  /**
   * Look up a share record. Returns null if not found or expired.
   */
  get(shareId: string): SharedSession | null {
    const record = this.data.sessions[shareId]
    if (!record) return null
    if (record.expiresAt !== null && Date.now() > record.expiresAt) {
      return null
    }
    return record
  }

  list(): SharedSession[] {
    return Object.values(this.data.sessions)
  }

  delete(shareId: string): boolean {
    if (!(shareId in this.data.sessions)) return false
    delete this.data.sessions[shareId]
    this.save()
    return true
  }

  /** Purge any expired records. Returns count removed. */
  prune(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, record] of Object.entries(this.data.sessions)) {
      if (record.expiresAt !== null && now > record.expiresAt) {
        delete this.data.sessions[key]
        removed++
      }
    }
    if (removed > 0) this.save()
    return removed
  }
}
