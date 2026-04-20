/**
 * Tests for src/services/session/display.ts helpers — message formatting,
 * session-list rendering, and last-message resolution.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  appendMessage,
  createSession,
  getDb,
  resetDbForTesting,
  revertSession,
} from '../index.js'
import {
  findLastMessageId,
  findLastUserMessageId,
  formatMessageForHistory,
  formatSessionListEntry,
  renderSessionList,
  styleRenderedMessage,
} from '../display.js'

beforeEach(async () => {
  resetDbForTesting()
  await getDb(':memory:')
})

describe('formatMessageForHistory', () => {
  it('returns reverted=false for live messages', () => {
    const r = formatMessageForHistory({
      id: 'm',
      sessionId: 's',
      role: 'user',
      content: 'hello',
      providerMetadata: null,
      usage: null,
      createdAt: 0,
      revertedAt: null,
    })
    expect(r.reverted).toBe(false)
    expect(r.text).toBe('hello')
    expect(r.role).toBe('user')
  })

  it('returns reverted=true when revertedAt is set', () => {
    const r = formatMessageForHistory({
      id: 'm',
      sessionId: 's',
      role: 'assistant',
      content: { text: 'deleted' },
      providerMetadata: null,
      usage: null,
      createdAt: 0,
      revertedAt: 12345,
    })
    expect(r.reverted).toBe(true)
    expect(r.text).toBe('deleted')
  })

  it('extracts text from content.blocks[0].text', () => {
    const r = formatMessageForHistory({
      id: 'm',
      sessionId: 's',
      role: 'assistant',
      content: { blocks: [{ type: 'text', text: 'block-text' }] },
      providerMetadata: null,
      usage: null,
      createdAt: 0,
      revertedAt: null,
    })
    expect(r.text).toBe('block-text')
  })
})

describe('styleRenderedMessage', () => {
  it('leaves live messages un-decorated', () => {
    const styled = styleRenderedMessage({
      id: 'm',
      role: 'user',
      text: 'hi',
      reverted: false,
    })
    expect(styled).toBe('[user] hi')
  })

  it('applies ANSI dim + strikethrough to reverted messages', () => {
    const styled = styleRenderedMessage({
      id: 'm',
      role: 'user',
      text: 'gone',
      reverted: true,
    })
    // CSI 2m = dim, CSI 9m = strikethrough, CSI 0m = reset
    expect(styled).toMatch(/\x1b\[2m/)
    expect(styled).toMatch(/\x1b\[9m/)
    expect(styled).toMatch(/\x1b\[0m$/)
    expect(styled).toContain('gone')
  })
})

describe('formatSessionListEntry + renderSessionList', () => {
  it('flags forks via parentLine', () => {
    const entry = formatSessionListEntry({
      id: 's2',
      slug: '',
      title: 'child',
      projectId: '',
      parentId: 's1',
      parentMessageId: 'm-anchor',
      createdAt: 0,
      updatedAt: 0,
      status: 'active',
      summary: '',
    })
    expect(entry.isFork).toBe(true)
    expect(entry.parentLine).toBe('  ↳ forked from s1')
  })

  it('leaves root sessions without a parentLine', () => {
    const entry = formatSessionListEntry({
      id: 's1',
      slug: '',
      title: 'root',
      projectId: '',
      parentId: null,
      parentMessageId: null,
      createdAt: 0,
      updatedAt: 0,
      status: 'active',
      summary: '',
    })
    expect(entry.isFork).toBe(false)
    expect(entry.parentLine).toBeNull()
  })

  it('renders a mixed list with indented fork lines', () => {
    const out = renderSessionList([
      {
        id: 'parent',
        slug: '',
        title: 'P',
        projectId: '',
        parentId: null,
        parentMessageId: null,
        createdAt: 0,
        updatedAt: 0,
        status: 'active',
        summary: '',
      },
      {
        id: 'child',
        slug: '',
        title: 'C',
        projectId: '',
        parentId: 'parent',
        parentMessageId: 'm',
        createdAt: 0,
        updatedAt: 0,
        status: 'active',
        summary: '',
      },
    ])
    expect(out).toContain('• parent  P')
    expect(out).toContain('• child  C')
    expect(out).toContain('↳ forked from parent')
  })
})

describe('findLastUserMessageId / findLastMessageId', () => {
  it('returns null for an empty session', async () => {
    const s = await createSession({})
    expect(await findLastUserMessageId(s.id)).toBeNull()
    expect(await findLastMessageId(s.id)).toBeNull()
  })

  it('returns the latest non-reverted user message', async () => {
    const s = await createSession({})
    await appendMessage({ sessionId: s.id, role: 'user', content: 'u1' })
    await new Promise(r => setTimeout(r, 2))
    await appendMessage({
      sessionId: s.id,
      role: 'assistant',
      content: 'a1',
    })
    await new Promise(r => setTimeout(r, 2))
    const u2 = await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: 'u2',
    })
    expect(await findLastUserMessageId(s.id)).toBe(u2.id)
  })

  it('skips reverted messages', async () => {
    const s = await createSession({})
    const u1 = await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: 'u1',
    })
    await new Promise(r => setTimeout(r, 2))
    const u2 = await appendMessage({
      sessionId: s.id,
      role: 'user',
      content: 'u2',
    })
    await revertSession(s.id, u1.id) // soft-deletes u2
    expect(await findLastUserMessageId(s.id)).toBe(u1.id)
    // findLastMessageId returns null when the latest row is reverted —
    // the tail of the session is empty from the consumer's POV.
    expect(await findLastMessageId(s.id)).toBeNull()
    void u2
  })
})
