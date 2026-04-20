/**
 * Tests for the /revert command. All DB-touching calls are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseRevertArgs } from '../revert.js'

const revertSession = vi.fn()
const restoreSession = vi.fn()
const findLastUserMessageId = vi.fn()

vi.mock('../../../services/session/api.js', () => ({
  revertSession: (...a: any[]) => revertSession(...a),
}))

vi.mock('../../../services/session/restore.js', () => ({
  restoreSession: (...a: any[]) => restoreSession(...a),
}))

vi.mock('../../../services/session/display.js', () => ({
  findLastUserMessageId: (...a: any[]) => findLastUserMessageId(...a),
  findLastMessageId: vi.fn(),
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
  revertSession.mockReset()
  restoreSession.mockReset()
  findLastUserMessageId.mockReset()
  delete process.env.VOID_ACTIVE_SESSION_ID
  delete process.env.VOID_SESSION_ID
  const mod = (await import('../revert.js')) as any
  call = mod.call
})

function mkContext(sessionId: string | null, extra: Record<string, any> = {}): any {
  return {
    getAppState: () => ({ sessionId }),
    ...extra,
  }
}

describe('parseRevertArgs', () => {
  it('extracts a positional messageId', () => {
    const r = parseRevertArgs('abc123')
    expect(r.messageId).toBe('abc123')
    expect(r.restore).toBe(false)
    expect(r.yes).toBe(false)
  })

  it('detects --restore (and --undo alias)', () => {
    expect(parseRevertArgs('abc --restore').restore).toBe(true)
    expect(parseRevertArgs('abc --undo').restore).toBe(true)
  })

  it('detects --yes / --force / -y', () => {
    expect(parseRevertArgs('abc --yes').yes).toBe(true)
    expect(parseRevertArgs('abc --force').yes).toBe(true)
    expect(parseRevertArgs('abc -y').yes).toBe(true)
  })

  it('handles empty input without crashing', () => {
    const r = parseRevertArgs('')
    expect(r.messageId).toBeNull()
    expect(r.restore).toBe(false)
  })

  it('is case-insensitive for flags', () => {
    expect(parseRevertArgs('abc --RESTORE').restore).toBe(true)
    expect(parseRevertArgs('abc --YES').yes).toBe(true)
  })
})

describe('/revert command', () => {
  it('refuses to run without confirmation when no --yes is passed', async () => {
    const res = await call('msg-1', mkContext('s-1'))
    expect(revertSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/canceled/i)
  })

  it('reverts with --yes and surfaces the count', async () => {
    revertSession.mockResolvedValue({ revertedCount: 3 })
    const res = await call('msg-1 --yes', mkContext('s-1'))
    expect(revertSession).toHaveBeenCalledWith('s-1', 'msg-1')
    expect(res.value).toMatch(/Reverted 3 messages/)
    expect(res.value).toMatch(/--restore to undo/)
  })

  it('falls back to the last user message when no anchor is given', async () => {
    findLastUserMessageId.mockResolvedValue('u-7')
    revertSession.mockResolvedValue({ revertedCount: 1 })
    const res = await call('--yes', mkContext('s-1'))
    expect(revertSession).toHaveBeenCalledWith('s-1', 'u-7')
    expect(res.value).toMatch(/Reverted 1 message(?!s)/)
  })

  it('handles --restore by calling restoreSession', async () => {
    restoreSession.mockResolvedValue({ restoredCount: 2 })
    const res = await call('anchor --restore', mkContext('s-1'))
    expect(restoreSession).toHaveBeenCalledWith('s-1', 'anchor')
    expect(revertSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/Restored 2 messages/)
  })

  it('--restore does NOT require confirmation', async () => {
    restoreSession.mockResolvedValue({ restoredCount: 1 })
    const res = await call('anchor --restore', mkContext('s-1'))
    expect(res.value).not.toMatch(/canceled/i)
  })

  it('invokes the context confirmer when present (yes = proceed)', async () => {
    revertSession.mockResolvedValue({ revertedCount: 1 })
    const confirmer = vi.fn().mockResolvedValue(true)
    const res = await call(
      'msg-42',
      mkContext('s-1', { confirmBeforeRevert: confirmer }),
    )
    expect(confirmer).toHaveBeenCalledWith({ anchorId: 'msg-42' })
    expect(revertSession).toHaveBeenCalled()
    expect(res.value).toMatch(/Reverted/)
  })

  it('invokes the context confirmer when present (no = cancel)', async () => {
    const confirmer = vi.fn().mockResolvedValue(false)
    const res = await call(
      'msg-42',
      mkContext('s-1', { confirmBeforeRevert: confirmer }),
    )
    expect(confirmer).toHaveBeenCalled()
    expect(revertSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/canceled/i)
  })

  it('reports an error when no active session exists', async () => {
    const res = await call('msg-1 --yes', mkContext(null))
    expect(revertSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/no active session/i)
  })

  it('reports an error when no anchor can be resolved', async () => {
    findLastUserMessageId.mockResolvedValue(null)
    const res = await call('--yes', mkContext('s-1'))
    expect(revertSession).not.toHaveBeenCalled()
    expect(res.value).toMatch(/no user messages/i)
  })

  it('surfaces errors thrown by revertSession', async () => {
    revertSession.mockRejectedValue(new Error('bad anchor'))
    const res = await call('x --yes', mkContext('s-1'))
    expect(res.value).toMatch(/\/revert failed.*bad anchor/i)
  })
})

describe('/revert gating', () => {
  it('refuses to run when VOID_USE_SQLITE_SESSIONS is off', async () => {
    vi.resetModules()
    vi.doMock('../../../services/session/index.js', () => ({
      isSqliteSessionsEnabled: () => false,
    }))
    const mod = (await import('../revert.js')) as any
    const res = await mod.call('x --yes', mkContext('s'))
    expect(res.value).toMatch(/VOID_USE_SQLITE_SESSIONS/)
  })
})
