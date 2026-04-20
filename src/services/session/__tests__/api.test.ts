import { beforeEach, describe, expect, it } from 'vitest'

import {
  appendMessage,
  countSessions,
  createSession,
  forkSession,
  getDb,
  listMessageParts,
  listSessions,
  loadSession,
  resetDbForTesting,
  resumeSession,
  revertSession,
  searchSessions,
  updateSession,
} from '../index.js'

beforeEach(async () => {
  resetDbForTesting()
  await getDb(':memory:')
})

describe('session create/list/load/resume', () => {
  it('creates a session and loads it back', async () => {
    const s = await createSession({ title: 'hello', projectId: '/tmp/foo' })
    expect(s.id).toMatch(/^[0-9A-Z]{26}$/) // ULID
    const loaded = await loadSession(s.id)
    expect(loaded?.title).toBe('hello')
    expect(loaded?.projectId).toBe('/tmp/foo')
    expect(loaded?.parentId).toBeNull()
  })

  it('lists sessions newest-first and filters by project', async () => {
    const a = await createSession({ title: 'a', projectId: '/p1' })
    await new Promise((r) => setTimeout(r, 2))
    const b = await createSession({ title: 'b', projectId: '/p1' })
    await new Promise((r) => setTimeout(r, 2))
    await createSession({ title: 'c', projectId: '/p2' })

    const p1 = await listSessions({ projectId: '/p1' })
    expect(p1.map((s) => s.id)).toEqual([b.id, a.id])

    const all = await listSessions({})
    expect(all.length).toBe(3)
  })

  it('resumeSession returns non-reverted messages in order', async () => {
    const s = await createSession({ title: 'chat' })
    const m1 = await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: { text: 'hi' },
    })
    const m2 = await appendMessage({
      sessionId: s.id,
      role: 'assistant',
      content: { text: 'hello' },
    })
    const restored = await resumeSession(s.id)
    expect(restored?.messages.map((m) => m.id)).toEqual([m1.id, m2.id])
  })
})

describe('appendMessage + parts', () => {
  it('stores message parts and content JSON', async () => {
    const s = await createSession({})
    const m = await appendMessage({
      sessionId: s.id,
      role: 'assistant',
      content: { blocks: [{ type: 'text', text: 'hey' }] },
      usage: { input: 10, output: 20 },
      parts: [
        { type: 'text', state: { text: 'hey' } },
        { type: 'tool_use', state: { name: 'bash' } },
      ],
    })
    const parts = await listMessageParts(m.id)
    expect(parts.length).toBe(2)
    expect(parts[0].type).toBe('text')
    expect(parts[1].type).toBe('tool_use')
    const loaded = await resumeSession(s.id)
    expect((loaded?.messages[0].content as any).blocks[0].text).toBe('hey')
    expect((loaded?.messages[0].usage as any).input).toBe(10)
  })
})

describe('forkSession', () => {
  it('copies history up to the fork point and links parent', async () => {
    const s = await createSession({ title: 'parent' })
    const m1 = await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: 'one',
    })
    await new Promise((r) => setTimeout(r, 2))
    const m2 = await appendMessage({
      sessionId: s.id,
      role: 'assistant',
      content: 'two',
    })
    await new Promise((r) => setTimeout(r, 2))
    await appendMessage({ sessionId: s.id, role: 'user', content: 'three' })

    const child = await forkSession(s.id, m2.id)
    expect(child.parentId).toBe(s.id)
    expect(child.parentMessageId).toBe(m2.id)

    const restored = await resumeSession(child.id)
    expect(restored?.messages.length).toBe(2)
    expect(restored?.messages.map((m) => m.content)).toEqual(['one', 'two'])

    // Parent untouched
    const parent = await resumeSession(s.id)
    expect(parent?.messages.length).toBe(3)
  })

  it('throws when fork point is in another session', async () => {
    const a = await createSession({})
    const b = await createSession({})
    const m = await appendMessage({
      sessionId: a.id,
      role: 'user',
      content: 'x',
    })
    await expect(forkSession(b.id, m.id)).rejects.toThrow(/not in session/)
  })
})

describe('revertSession', () => {
  it('soft-deletes messages after the anchor', async () => {
    const s = await createSession({})
    const m1 = await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: 'one',
    })
    await new Promise((r) => setTimeout(r, 2))
    const m2 = await appendMessage({
      sessionId: s.id,
      role: 'assistant',
      content: 'two',
    })
    await new Promise((r) => setTimeout(r, 2))
    await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: 'three',
    })

    const res = await revertSession(s.id, m2.id)
    expect(res.revertedCount).toBe(1)

    const restored = await resumeSession(s.id)
    expect(restored?.messages.map((m) => m.id)).toEqual([m1.id, m2.id])
  })
})

describe('searchSessions', () => {
  it('seeds 100 sessions and finds by title or summary', async () => {
    for (let i = 0; i < 100; i++) {
      await createSession({
        title: i === 42 ? 'needle in a haystack' : `session ${i}`,
        summary: i === 17 ? 'alpha-beta gamma' : `filler ${i}`,
      })
    }
    expect(await countSessions()).toBe(100)

    const hay = await searchSessions({ query: 'needle' })
    expect(hay.length).toBeGreaterThanOrEqual(1)
    expect(hay[0].title).toContain('needle')

    const gamma = await searchSessions({ query: 'gamma' })
    expect(gamma.length).toBeGreaterThanOrEqual(1)
    expect(gamma[0].summary).toContain('gamma')
  })

  it('returns empty array for blank query', async () => {
    const r = await searchSessions({ query: '   ' })
    expect(r).toEqual([])
  })
})

describe('updateSession', () => {
  it('updates fields and bumps updatedAt', async () => {
    const s = await createSession({ title: 'old' })
    const before = s.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    await updateSession(s.id, { title: 'new', summary: 'summary' })
    const after = await loadSession(s.id)
    expect(after?.title).toBe('new')
    expect(after?.summary).toBe('summary')
    expect(after!.updatedAt).toBeGreaterThan(before)
  })
})
