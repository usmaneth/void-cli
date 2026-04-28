import { describe, expect, it } from 'vitest'
import { isSubscriptionProvider } from '../isSubscriptionProvider.js'

describe('isSubscriptionProvider', () => {
  it('chatgpt subscription models are subscription-billed', () => {
    expect(isSubscriptionProvider('gpt-5.5')).toBe(true)
    expect(isSubscriptionProvider('gpt-5.4')).toBe(true)
    expect(isSubscriptionProvider('gpt-5.4-codex')).toBe(true)
  })

  it('openai-prefixed models are API-billed (NOT subscription)', () => {
    expect(isSubscriptionProvider('openai/gpt-5.4')).toBe(false)
    expect(isSubscriptionProvider('openrouter/openai/gpt-5.4')).toBe(false)
  })

  it('claude models are API-billed (NOT subscription)', () => {
    expect(isSubscriptionProvider('claude-opus-4-7')).toBe(false)
    expect(isSubscriptionProvider('claude-sonnet-4-6')).toBe(false)
  })

  it('other providers are API-billed', () => {
    expect(isSubscriptionProvider('gemini-3-pro')).toBe(false)
    expect(isSubscriptionProvider('grok-4')).toBe(false)
    expect(isSubscriptionProvider('deepseek-v3')).toBe(false)
  })

  it('null/undefined/empty are NOT subscription', () => {
    expect(isSubscriptionProvider(null)).toBe(false)
    expect(isSubscriptionProvider(undefined)).toBe(false)
    expect(isSubscriptionProvider('')).toBe(false)
  })
})
