/**
 * restoreSession — the inverse of revertSession. Clears the revertedAt
 * marker on every soft-deleted message in `sessionId` whose createdAt is
 * strictly greater than `fromMessageId`'s createdAt (i.e. un-revert the
 * tail that was previously soft-deleted).
 *
 * Kept out of api.ts because api.ts is shared infrastructure (PR #58);
 * this is a thin additive helper consumed by the /revert --restore flag.
 *
 * Safe to run multiple times — only updates rows where revertedAt is
 * currently non-null, so repeated invocations are no-ops.
 */
import { and, eq, gt, isNotNull } from 'drizzle-orm'

import { getDb } from './db.js'
import { messages, sessions } from './schema.sql.js'

export async function restoreSession(
  sessionId: string,
  fromMessageId: string,
): Promise<{ restoredCount: number }> {
  const db = await getDb()
  const anchor = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.sessionId, sessionId), eq(messages.id, fromMessageId)),
    )
    .all()
  if (!anchor.length) {
    throw new Error(
      `restoreSession: message ${fromMessageId} not in session ${sessionId}`,
    )
  }
  const anchorCreated =
    (anchor[0] as any).createdAt ?? (anchor[0] as any).created_at

  const now = Date.now()
  const res = await db
    .update(messages)
    .set({ revertedAt: null })
    .where(
      and(
        eq(messages.sessionId, sessionId),
        gt(messages.createdAt, anchorCreated),
        isNotNull(messages.revertedAt),
      ),
    )
    .run()

  await db
    .update(sessions)
    .set({ updatedAt: now })
    .where(eq(sessions.id, sessionId))
    .run()

  const changes =
    (res as any)?.changes ??
    (res as any)?.[0]?.changes ??
    (res as any)?.rowsAffected ??
    0
  return { restoredCount: Number(changes) }
}
