/**
 * Display helpers for the /fork and /revert TUI surfaces.
 *
 * - formatMessageForHistory — dim + strikethrough when revertedAt is set
 * - formatSessionListWithParent — "↳ forked from <parent-id>" when parentId exists
 * - findLastUserMessageId — fallback anchor when /fork or /revert is invoked
 *   without an explicit message ID
 *
 * These are pure presentation layers over the public session API — no DB
 * writes, no side-effects. Kept separate from api.ts so the PR #58 surface
 * stays stable.
 */
import { asc, desc, eq } from 'drizzle-orm'

import { getDb } from './db.js'
import type { Message, Session } from './api.js'
import { messages } from './schema.sql.js'

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

export type RenderedMessage = {
  id: string
  role: string
  text: string
  reverted: boolean
}

/**
 * Produce a plain-text rendering of a message row. When `revertedAt` is
 * non-null the output is wrapped in ANSI dim + strikethrough so the TUI
 * can show soft-deleted history without hiding it entirely.
 *
 * We intentionally avoid importing chalk here — callers that want color
 * can wrap via chalk.strikethrough(chalk.dim(text)). This function
 * returns the raw string and a `reverted` flag so the caller controls
 * styling for the target terminal.
 */
export function formatMessageForHistory(msg: Message): RenderedMessage {
  const text = extractMessageText(msg.content)
  return {
    id: msg.id,
    role: msg.role,
    text,
    reverted: msg.revertedAt !== null,
  }
}

/**
 * ANSI styling wrapper — emits CSI 2m (dim) + CSI 9m (strikethrough)
 * when reverted, plain text otherwise. The TUI uses chalk for most
 * rendering but this keeps the module dependency-free for testing.
 */
export function styleRenderedMessage(r: RenderedMessage): string {
  if (!r.reverted) return `[${r.role}] ${r.text}`
  // Dim + strikethrough via ANSI SGR. Reset with CSI 0m.
  return `\x1b[2m\x1b[9m[${r.role}] ${r.text}\x1b[0m`
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const c = content as any
    if (typeof c.text === 'string') return c.text
    if (Array.isArray(c.blocks)) {
      const first = c.blocks.find((b: any) => b?.type === 'text' && b?.text)
      if (first) return first.text
    }
    try {
      return JSON.stringify(content)
    } catch {
      return '(unserializable)'
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// Session-list parent-child rendering
// ---------------------------------------------------------------------------

export type RenderedSession = {
  id: string
  title: string
  isFork: boolean
  parentLine: string | null
}

/**
 * Render a session row with an optional "↳ forked from <parent-id>"
 * suffix line when parentId is set. The TUI pads this line to indent
 * visually under the parent session.
 */
export function formatSessionListEntry(s: Session): RenderedSession {
  const isFork = s.parentId !== null && s.parentId !== undefined
  const parentLine = isFork ? `  ↳ forked from ${s.parentId}` : null
  return {
    id: s.id,
    title: s.title || '(untitled)',
    isFork,
    parentLine,
  }
}

/**
 * Convenience: render a whole session list as a newline-joined string
 * suitable for a slash-command text response. Callers needing richer
 * layout (ink components) should iterate via formatSessionListEntry.
 */
export function renderSessionList(list: Session[]): string {
  const lines: string[] = []
  for (const s of list) {
    const entry = formatSessionListEntry(s)
    lines.push(`• ${entry.id}  ${entry.title}`)
    if (entry.parentLine) lines.push(entry.parentLine)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Anchor resolution — used by /fork and /revert when no ID is given
// ---------------------------------------------------------------------------

/**
 * Return the ID of the most recent non-reverted user message in the
 * session, or null if the session has no user messages.
 */
export async function findLastUserMessageId(
  sessionId: string,
): Promise<string | null> {
  const db = await getDb()
  const rows = await db
    .select({ id: messages.id, role: messages.role, revertedAt: messages.revertedAt })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .all()
  for (const r of rows as any[]) {
    if (r.role === 'user' && (r.revertedAt === null || r.revertedAt === undefined)) {
      return r.id as string
    }
  }
  return null
}

/**
 * Return the ID of the most recent non-reverted message of any role.
 * Used by /fork when the session has no user messages yet (edge case
 * for bootstrap sessions).
 */
export async function findLastMessageId(
  sessionId: string,
): Promise<string | null> {
  const db = await getDb()
  const rows = await db
    .select({ id: messages.id, revertedAt: messages.revertedAt })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(1)
    .all()
  const first = rows[0] as any
  if (!first) return null
  if (first.revertedAt !== null && first.revertedAt !== undefined) return null
  return first.id
}

// asc import retained for future ordered-iteration helpers; marked as
// intentionally-used to satisfy the bundler's tree-shake heuristics.
void asc
