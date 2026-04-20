/**
 * Tests for env-var-based API provider routing.
 *
 * The `getAPIProvider()` function picks the upstream Anthropic-compatible
 * transport based on VOID_USE_* env vars. Priority matters: if a user sets
 * both VOID_USE_BEDROCK=1 and VOID_USE_VERTEX=1, Bedrock wins (it is checked
 * first). Breaking this priority would silently re-route enterprise traffic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../providers.js'

const ENV_VARS = [
  'VOID_USE_BEDROCK',
  'VOID_USE_VERTEX',
  'VOID_USE_FOUNDRY',
  'VOID_USE_OPENAI',
  'VOID_USE_GEMINI',
  'VOID_USE_OPENROUTER',
  'ANTHROPIC_BASE_URL',
  'USER_TYPE',
] as const

describe('getAPIProvider', () => {
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_VARS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
  })

  it('defaults to firstParty when no provider env vars are set', () => {
    expect(getAPIProvider()).toBe('firstParty')
  })

  it('routes to bedrock when VOID_USE_BEDROCK is truthy', () => {
    process.env.VOID_USE_BEDROCK = '1'
    expect(getAPIProvider()).toBe('bedrock')
  })

  it('routes to vertex when VOID_USE_VERTEX is truthy', () => {
    process.env.VOID_USE_VERTEX = 'true'
    expect(getAPIProvider()).toBe('vertex')
  })

  it('routes to foundry when VOID_USE_FOUNDRY is truthy', () => {
    process.env.VOID_USE_FOUNDRY = 'yes'
    expect(getAPIProvider()).toBe('foundry')
  })

  it('routes to openai when VOID_USE_OPENAI is truthy', () => {
    process.env.VOID_USE_OPENAI = 'on'
    expect(getAPIProvider()).toBe('openai')
  })

  it('routes to openrouter when VOID_USE_OPENROUTER is truthy', () => {
    process.env.VOID_USE_OPENROUTER = '1'
    expect(getAPIProvider()).toBe('openrouter')
  })

  it('prioritises bedrock over vertex when both are set', () => {
    process.env.VOID_USE_BEDROCK = '1'
    process.env.VOID_USE_VERTEX = '1'
    expect(getAPIProvider()).toBe('bedrock')
  })

  it('prioritises vertex over foundry when both are set', () => {
    process.env.VOID_USE_VERTEX = '1'
    process.env.VOID_USE_FOUNDRY = '1'
    expect(getAPIProvider()).toBe('vertex')
  })

  it('prioritises foundry over openrouter when both are set', () => {
    process.env.VOID_USE_FOUNDRY = '1'
    process.env.VOID_USE_OPENROUTER = '1'
    expect(getAPIProvider()).toBe('foundry')
  })

  it('treats falsy strings (0/false/off) as not set', () => {
    process.env.VOID_USE_BEDROCK = '0'
    process.env.VOID_USE_VERTEX = 'false'
    process.env.VOID_USE_OPENROUTER = 'off'
    expect(getAPIProvider()).toBe('firstParty')
  })
})

describe('isFirstPartyAnthropicBaseUrl', () => {
  let originalBaseUrl: string | undefined
  let originalUserType: string | undefined

  beforeEach(() => {
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalUserType = process.env.USER_TYPE
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.USER_TYPE
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
    if (originalUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = originalUserType
  })

  it('returns true when ANTHROPIC_BASE_URL is unset', () => {
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  it('returns true for api.anthropic.com', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  it('returns false for third-party proxy URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example.com'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
  })

  it('returns false for a malformed URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'not-a-valid-url'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
  })

  it('allows api-staging.anthropic.com only when USER_TYPE=ant', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api-staging.anthropic.com'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
    process.env.USER_TYPE = 'ant'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })
})
