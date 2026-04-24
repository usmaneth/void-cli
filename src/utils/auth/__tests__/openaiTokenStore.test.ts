import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Must be set BEFORE importing openaiTokenStore, since getClaudeConfigHomeDir
// is memoized on first call.
const TEST_DIR = mkdtempSync(join(tmpdir(), 'void-auth-test-'))
process.env.VOID_CONFIG_DIR = TEST_DIR

import {
  clearTokens,
  getAuthFilePath,
  loadTokens,
  saveTokens,
  type StoredAuthTokens,
} from '../openaiTokenStore.js'

describe('openaiTokenStore', () => {
  beforeAll(() => {
    // Confirm memoization settled on our temp dir.
    expect(getAuthFilePath().startsWith(TEST_DIR)).toBe(true)
  })

  afterAll(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  beforeEach(() => {
    clearTokens()
  })

  afterEach(() => {
    clearTokens()
  })

  it('round-trips tokens to disk', () => {
    const tokens: StoredAuthTokens = {
      access_token: 'access.jwt.here',
      refresh_token: 'refresh-abc',
      id_token: 'id.jwt.here',
      expires_at: Date.now() + 3_600_000,
      chatgpt_plan_type: 'pro',
      email: 'u@example.com',
      chatgpt_account_id: 'acct_1',
    }
    saveTokens(tokens)
    const loaded = loadTokens()
    expect(loaded).not.toBeNull()
    expect(loaded?.access_token).toBe(tokens.access_token)
    expect(loaded?.refresh_token).toBe(tokens.refresh_token)
    expect(loaded?.id_token).toBe(tokens.id_token)
    expect(loaded?.chatgpt_plan_type).toBe('pro')
    expect(loaded?.chatgpt_account_id).toBe('acct_1')
    expect(typeof loaded?.last_refresh).toBe('number')
  })

  it('writes the file with 0600 permissions', () => {
    const tokens: StoredAuthTokens = {
      access_token: 'a',
      refresh_token: 'r',
      id_token: 'i',
      expires_at: Date.now() + 1000,
    }
    saveTokens(tokens)
    const path = getAuthFilePath()
    expect(existsSync(path)).toBe(true)
    // Only check on POSIX — Windows doesn't have chmod semantics.
    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })

  it('loadTokens returns null when nothing is persisted', () => {
    expect(loadTokens()).toBeNull()
  })

  it('clearTokens removes the file', () => {
    saveTokens({
      access_token: 'a',
      refresh_token: 'r',
      id_token: 'i',
      expires_at: Date.now() + 1000,
    })
    expect(existsSync(getAuthFilePath())).toBe(true)
    clearTokens()
    expect(existsSync(getAuthFilePath())).toBe(false)
    expect(loadTokens()).toBeNull()
  })

  it('loadTokens rejects partial records', () => {
    // Write an invalid blob directly
    const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(
      getAuthFilePath(),
      JSON.stringify({ access_token: 'only-access' }),
      'utf-8',
    )
    expect(loadTokens()).toBeNull()
  })
})
