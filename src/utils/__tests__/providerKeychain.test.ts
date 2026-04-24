import { describe, expect, it } from 'vitest'
import {
  getProviderEnvVarName,
  getProviderKeychainServiceName,
  hasProviderEnvKey,
  PROVIDER_KEYCHAIN_NAMES,
  validateProviderKey,
} from '../providerKeychain.js'

describe('validateProviderKey — openrouter', () => {
  it('accepts valid sk-or-v1- keys', () => {
    const res = validateProviderKey('openrouter', 'sk-or-v1-' + 'a'.repeat(64))
    expect(res.ok).toBe(true)
  })

  it('trims whitespace before validating', () => {
    const res = validateProviderKey(
      'openrouter',
      '  sk-or-v1-' + 'a'.repeat(40) + '  ',
    )
    expect(res.ok).toBe(true)
  })

  it('rejects openai-shaped keys', () => {
    const res = validateProviderKey('openrouter', 'sk-' + 'a'.repeat(40))
    expect(res.ok).toBe(false)
    if (res.ok === false) expect(res.reason).toMatch(/sk-or-v1-/)
  })

  it('rejects too-short keys', () => {
    const res = validateProviderKey('openrouter', 'sk-or-v1-abc')
    expect(res.ok).toBe(false)
  })

  it('rejects empty input', () => {
    const res = validateProviderKey('openrouter', '   ')
    expect(res.ok).toBe(false)
  })
})

describe('validateProviderKey — openai', () => {
  it('accepts valid sk- keys', () => {
    const res = validateProviderKey('openai', 'sk-' + 'a'.repeat(48))
    expect(res.ok).toBe(true)
  })

  it('rejects openrouter keys pasted into openai', () => {
    const res = validateProviderKey('openai', 'sk-or-v1-' + 'a'.repeat(40))
    expect(res.ok).toBe(false)
    if (res.ok === false) expect(res.reason).toMatch(/OpenRouter/)
  })

  it('rejects bare google-style keys', () => {
    const res = validateProviderKey('openai', 'AIzaSy' + 'a'.repeat(33))
    expect(res.ok).toBe(false)
    if (res.ok === false) expect(res.reason).toMatch(/"sk-"/)
  })

  it('rejects keys with whitespace', () => {
    const res = validateProviderKey('openai', 'sk-abc def')
    expect(res.ok).toBe(false)
  })
})

describe('validateProviderKey — gemini', () => {
  it('accepts 39-char alphanumeric keys', () => {
    const res = validateProviderKey('gemini', 'A'.repeat(39))
    expect(res.ok).toBe(true)
  })

  it('accepts keys with hyphens/underscores', () => {
    const res = validateProviderKey('gemini', 'AIzaSy_abc-' + 'x'.repeat(28))
    expect(res.ok).toBe(true)
  })

  it('rejects spaces', () => {
    const res = validateProviderKey('gemini', 'AIza Sy' + 'a'.repeat(32))
    expect(res.ok).toBe(false)
  })

  it('rejects too-short keys', () => {
    const res = validateProviderKey('gemini', 'A'.repeat(10))
    expect(res.ok).toBe(false)
  })

  it('rejects keys with unsupported punctuation', () => {
    const res = validateProviderKey('gemini', 'A'.repeat(20) + '.' + 'a'.repeat(20))
    expect(res.ok).toBe(false)
  })
})

describe('providerKeychain helpers', () => {
  it('getProviderEnvVarName maps each provider to its env var', () => {
    expect(getProviderEnvVarName('openrouter')).toBe('OPENROUTER_API_KEY')
    expect(getProviderEnvVarName('openai')).toBe('OPENAI_API_KEY')
    expect(getProviderEnvVarName('gemini')).toBe('GEMINI_API_KEY')
  })

  it('getProviderKeychainServiceName returns Void-<provider>', () => {
    expect(getProviderKeychainServiceName('openrouter')).toBe('Void-openrouter')
    expect(getProviderKeychainServiceName('openai')).toBe('Void-openai')
    expect(getProviderKeychainServiceName('gemini')).toBe('Void-gemini')
  })

  it('PROVIDER_KEYCHAIN_NAMES covers the three paste-API-key providers', () => {
    expect([...PROVIDER_KEYCHAIN_NAMES].sort()).toEqual([
      'gemini',
      'openai',
      'openrouter',
    ])
  })

  it('hasProviderEnvKey reflects process.env state', () => {
    const saved = process.env.OPENAI_API_KEY
    try {
      delete process.env.OPENAI_API_KEY
      expect(hasProviderEnvKey('openai')).toBe(false)
      process.env.OPENAI_API_KEY = 'sk-test'
      expect(hasProviderEnvKey('openai')).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = saved
    }
  })
})
