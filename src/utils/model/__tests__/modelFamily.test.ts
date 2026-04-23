/**
 * Tests for model-family resolution used by the per-family system-prompt
 * prefix. The goal is to lock down the mapping so that a model string
 * like `openrouter/anthropic/claude-sonnet-4-6` keeps resolving to
 * `anthropic` even as OpenRouter shuffles slug layouts.
 */
import { describe, expect, it } from 'vitest'
import { resolveModelFamily } from '../modelFamily.js'

describe('resolveModelFamily', () => {
  it('defaults to anthropic for null, undefined, and empty input', () => {
    expect(resolveModelFamily(null)).toBe('anthropic')
    expect(resolveModelFamily(undefined)).toBe('anthropic')
    expect(resolveModelFamily('')).toBe('anthropic')
  })

  it('resolves Claude variants to anthropic', () => {
    expect(resolveModelFamily('claude-opus-4-7')).toBe('anthropic')
    expect(resolveModelFamily('claude-sonnet-4-6')).toBe('anthropic')
    expect(resolveModelFamily('claude-haiku-4-5-20251001')).toBe('anthropic')
    expect(resolveModelFamily('CLAUDE-OPUS-4-7')).toBe('anthropic')
  })

  it('resolves GPT and o-series variants to openai', () => {
    expect(resolveModelFamily('gpt-5.4-high')).toBe('openai')
    expect(resolveModelFamily('gpt-4o')).toBe('openai')
    expect(resolveModelFamily('o1-preview')).toBe('openai')
    expect(resolveModelFamily('o3-mini')).toBe('openai')
    expect(resolveModelFamily('codex-high')).toBe('openai')
  })

  it('resolves Gemini variants to gemini', () => {
    expect(resolveModelFamily('gemini-2.5-pro')).toBe('gemini')
    expect(resolveModelFamily('gemini-3.1-pro')).toBe('gemini')
  })

  it('resolves Grok variants to xai', () => {
    expect(resolveModelFamily('grok-4')).toBe('xai')
    expect(resolveModelFamily('grok-code-fast-1')).toBe('xai')
  })

  it('resolves DeepSeek variants to deepseek', () => {
    expect(resolveModelFamily('deepseek-v3')).toBe('deepseek')
    expect(resolveModelFamily('deepseek-r1')).toBe('deepseek')
    expect(resolveModelFamily('deepseek-coder-v2')).toBe('deepseek')
  })

  it('resolves Qwen and QwQ variants to qwen', () => {
    expect(resolveModelFamily('qwen2.5-coder-32b')).toBe('qwen')
    expect(resolveModelFamily('qwq-32b-preview')).toBe('qwen')
  })

  it('strips org prefixes from OpenRouter-style slugs', () => {
    expect(resolveModelFamily('anthropic/claude-sonnet-4-6')).toBe('anthropic')
    expect(resolveModelFamily('openai/gpt-5.4')).toBe('openai')
    expect(resolveModelFamily('google/gemini-2.5-pro')).toBe('gemini')
    expect(resolveModelFamily('xai/grok-4')).toBe('xai')
    expect(resolveModelFamily('deepseek/deepseek-v3')).toBe('deepseek')
    expect(resolveModelFamily('qwen/qwen2.5-coder-32b')).toBe('qwen')
  })

  it('handles triple-nested gateway slugs', () => {
    expect(
      resolveModelFamily('openrouter/anthropic/claude-sonnet-4-6'),
    ).toBe('anthropic')
    expect(resolveModelFamily('vercel/openai/gpt-5.4-high')).toBe('openai')
  })

  it('falls back to anthropic for unknown model IDs', () => {
    expect(resolveModelFamily('llama-3-70b')).toBe('anthropic')
    expect(resolveModelFamily('mistral-large')).toBe('anthropic')
    expect(resolveModelFamily('some-future-model')).toBe('anthropic')
  })
})
