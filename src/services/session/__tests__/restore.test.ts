/**
 * Tests for restoreSession (the /revert --restore backend).
 *
 * Runs against an in-memory SQLite DB, like the other session-service
 * tests. Verifies that restoreSession is the inverse of revertSession.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  appendMessage,
  createSession,
  getDb,
  resetDbForTesting,
  resumeSession,
  revertSession,
} from '../index.js'
import { restoreSession } from '../restore.js'

beforeEach(async () => {
  resetDbForTesting()
  await getDb(':memory:')
})

async function seed() {
  const s = await createSession({ title: 'r' })
  const m1 = await appendMessage({
    sessionId: s.id,
    role: 'user',
    content: 'one',
  })
  await new Promise(r => setTimeout(r, 2))
  const m2 = await appendMessage({
    sessionId: s.id,
    role: 'assistant',
    content: 'two',
  })
  await new Promise(r => setTimeout(r, 2))
  const m3 = await appendMessage({
    sessionId: s.id,
    role: 'user',
    content: 'three',
  })
  return { s, m1, m2, m3 }
}

describe('restoreSession', () => {
  it('un-reverts messages soft-deleted after the anchor', async () => {
    const { s, m2 } = await seed()

    await revertSession(s.id, m2.id)
    const afterRevert = await resumeSession(s.id)
    expect(afterRevert?.messages.length).toBe(2)

    const res = await restoreSession(s.id, m2.id)
    expect(res.restoredCount).toBe(1)

    const restored = await resumeSession(s.id)
    expect(restored?.messages.length).toBe(3)
    expect(restored?.messages.map(m => m.content)).toEqual([
      'one',
      'two',
      'three',
    ])
  })

  it('is a no-op when nothing is currently reverted', async () => {
    const { s, m2 } = await seed()
    const res = await restoreSession(s.id, m2.id)
    expect(res.restoredCount).toBe(0)
  })

  it('is idempotent across multiple invocations', async () => {
    const { s, m2 } = await seed()
    await revertSession(s.id, m2.id)
    const first = await restoreSession(s.id, m2.id)
    const second = await restoreSession(s.id, m2.id)
    expect(first.restoredCount).toBe(1)
    expect(second.restoredCount).toBe(0)
  })

  it('throws when the anchor is missing from the session', async () => {
    const { s } = await seed()
    await expect(restoreSession(s.id, 'not-a-real-id')).rejects.toThrow(
      /not in session/,
    )
  })
})
