import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { getDefaultDbPath } from '../db.js'

describe('getDefaultDbPath', () => {
  const orig = {
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    VOID_DB_PATH: process.env.VOID_DB_PATH,
    APPDATA: process.env.APPDATA,
  }

  beforeEach(() => {
    delete process.env.XDG_DATA_HOME
    delete process.env.VOID_DB_PATH
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('prefers VOID_DB_PATH env var over everything', () => {
    process.env.VOID_DB_PATH = '/tmp/explicit/void.db'
    expect(getDefaultDbPath()).toBe('/tmp/explicit/void.db')
  })

  it('prefers XDG_DATA_HOME when set', () => {
    process.env.XDG_DATA_HOME = '/custom/xdg'
    expect(getDefaultDbPath()).toBe('/custom/xdg/void-cli/void.db')
  })

  it('falls back to platform default when XDG is unset', () => {
    const p = getDefaultDbPath()
    // Just assert the path lives under void-cli/void.db — exact prefix
    // depends on the host OS.
    expect(p.endsWith('void-cli/void.db')).toBe(true)
  })
})
