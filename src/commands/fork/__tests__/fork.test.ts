/**
 * Tests for the /fork command. All session-API calls are mocked via
 * vi.mock so we never touch the real SQLite DB in test runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the session API surface. These hoist to the top of the file
// before ../fork.js resolves its imports.
// ---------------------------------------------------------------------------
const forkSession = vi.fn()
const findLastUserMessageId = vi.fn()
const findLastMessageId = vi.fn()

vi.mock('../../../services/session/api.js', () => ({
  forkSession: (...a: any[]) => forkSession(...a),
}))

vi.mock('../../../services/session/display.js', () => ({
  findLastUserMessageId: (...a: any[]) => findLastUserMessageId(...a),
  findLastMessageId: (...a: any[]) => findLastMessageId(...a),
}))

vi.mock('../../../services/session/index.js', () => ({
  isSqliteSessionsEnabled: () => true,
}))

let call: (
  args: string,
  context: any,
) => Promise<{ type: 'text'; value: string }>

beforeEach(async () => {
  vi.resetModules()
  forkSession.mockReset()
  findLastUserMessageId.mockReset()
  findLastMessageId.mockReset()
  delete process.env.VOID_ACTIVE_SESSION_ID
  delete process.env.VOID_SESSION_ID

  const mod = (await import('../fork.js')) as any
  call = mod.call
})

function mkContext(sessionId: string | null): any {
  return {
    getAppState: () => ({ sessionId }),
  }
}

describe('/fork command', () => {
  it('forks from an explicit message ID', async () => {
    forkSession.mockResolvedValue({ id: 'child-123' })
    const res = await call('msg-42', mkContext('parent-1'))
    expect(forkSession).toHaveBeenCalledWith('parent-1', 'msg-42')
    expect(res.value).toContain('Forked session → child-123')
    expect(res.value).toContain('Parent: parent-1')
  })

  it('falls back to the last user message when no ID is given', async () => {
    findLastUserMessageId.mockResolvedValue('user-msg-7')
    forkSession.mockResolvedValue({ id: 'child-b' })
    const res = await call('', mkContext('parent-x'))
    expect(findLastUserMessageId).toHaveBeenCalledWith('parent-x')
    expect(forkSession).toHaveBeenCalledWith('parent-x', 'user-msg-7')
    expect(res.value).toContain('child-b')
  })

  it('falls back to the last message (any role) when no user message exists', async () => {
    findLastUserMessageId.mockResolvedValue(null)
    findLastMessageId.mockResolvedValue('assistant-msg-3')
    forkSession.mockResolvedValue({ id: 'child-c' })
    const res = await call('', mkContext('s-1'))
    expect(forkSession).toHaveBeenCalledWith('s-1', 'assistant-msg-3')
    expect(res.value).toContain('child-c')
  })

  it('returns a helpful error when the session has no messages', async () => {
    findLastUserMessageId.mockResolvedValue(null)
    findLastMessageId.mockResolvedValue(null)
    const res = await call('', mkContext('empty-session'))
    expect(forkSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/no messages yet/i)
  })

  it('returns an error when no active session exists', async () => {
    const res = await call('msg-1', mkContext(null))
    expect(forkSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/no active session/i)
  })

  it('surfaces errors thrown by forkSession', async () => {
    forkSession.mockRejectedValue(new Error('message not in session'))
    const res = await call('bogus', mkContext('s1'))
    expect(res.value).toMatch(/\/fork failed.*message not in session/i)
  })

  it('falls back to the VOID_SESSION_ID env var when no context sessionId', async () => {
    process.env.VOID_SESSION_ID = 'env-session'
    forkSession.mockResolvedValue({ id: 'kid' })
    const res = await call('m', { getAppState: () => ({}) })
    expect(forkSession).toHaveBeenCalledWith('env-session', 'm')
    expect(res.value).toContain('kid')
  })

  it('prefers an explicit anchor over the last-user-message fallback', async () => {
    findLastUserMessageId.mockResolvedValue('should-not-be-used')
    forkSession.mockResolvedValue({ id: 'z' })
    await call('explicit-anchor', mkContext('s'))
    expect(forkSession).toHaveBeenCalledWith('s', 'explicit-anchor')
    expect(findLastUserMessageId).not.toHaveBeenCalled()
  })

  it('exposes the new child id on process.env when no setter is available', async () => {
    forkSession.mockResolvedValue({ id: 'new-active' })
    await call('m', mkContext('parent'))
    expect(process.env.VOID_ACTIVE_SESSION_ID).toBe('new-active')
  })

  it('invokes a custom setSessionId when present on the context', async () => {
    forkSession.mockResolvedValue({ id: 'child' })
    const setSessionId = vi.fn()
    await call('m', { ...mkContext('parent'), setSessionId })
    expect(setSessionId).toHaveBeenCalledWith('child')
    // env fallback should NOT fire when the setter succeeded
    expect(process.env.VOID_ACTIVE_SESSION_ID).toBeUndefined()
  })
})

describe('/fork gating', () => {
  it('refuses to run when VOID_USE_SQLITE_SESSIONS is off', async () => {
    vi.resetModules()
    vi.doMock('../../../services/session/index.js', () => ({
      isSqliteSessionsEnabled: () => false,
    }))
    const mod = (await import('../fork.js')) as any
    const res = await mod.call('', mkContext('s'))
    expect(res.value).toMatch(/VOID_USE_SQLITE_SESSIONS/)
  })
})
