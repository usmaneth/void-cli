import { describe, expect, it } from 'vitest'
import { MODEL_ACCENTS, resolveModelAccent } from '../modelAccents.js'

describe('modelAccents', () => {
  it('maps each AccentFamily to a hex color', () => {
    expect(MODEL_ACCENTS.anthropic).toBe('#7dcfff')
    expect(MODEL_ACCENTS.chatgptSubscription).toBe('#bb9af7')
    expect(MODEL_ACCENTS.openaiApi).toBe('#9ece6a')
    expect(MODEL_ACCENTS.gemini).toBe('#7aa2f7')
    expect(MODEL_ACCENTS.xai).toBe('#ff7eb6')
    expect(MODEL_ACCENTS.deepseek).toBe('#ff9e64')
    expect(MODEL_ACCENTS.eastasian).toBe('#e0af68')
    expect(MODEL_ACCENTS.local).toBe('#9aa5ce')
  })

  it('resolveModelAccent returns the right accent for each model id', () => {
    expect(resolveModelAccent('claude-opus-4-7')).toBe('#7dcfff')
    expect(resolveModelAccent('gpt-5.5')).toBe('#bb9af7') // bare → subscription
    expect(resolveModelAccent('openai/gpt-5.4')).toBe('#9ece6a') // prefix → api
    expect(resolveModelAccent('openrouter/openai/gpt-5.4')).toBe('#9ece6a') // nested prefix → api
    expect(resolveModelAccent('gemini-3-pro')).toBe('#7aa2f7')
    expect(resolveModelAccent('grok-4')).toBe('#ff7eb6')
    expect(resolveModelAccent('deepseek-v3')).toBe('#ff9e64')
    expect(resolveModelAccent('qwen2.5-coder')).toBe('#e0af68')
    expect(resolveModelAccent('kimi-k2')).toBe('#e0af68')
    expect(resolveModelAccent('glm-4.6')).toBe('#e0af68')
  })

  it('detects local-runner models', () => {
    expect(resolveModelAccent('llama3-local')).toBe('#9aa5ce')
    expect(resolveModelAccent('ollama/llama3')).toBe('#9aa5ce')
    expect(resolveModelAccent('lmstudio/qwen-coder')).toBe('#9aa5ce')
    expect(resolveModelAccent('local/custom-model')).toBe('#9aa5ce')
  })

  it('falls back to anthropic accent for unknown models', () => {
    expect(resolveModelAccent('completely-unknown-model')).toBe('#7dcfff')
    expect(resolveModelAccent(null)).toBe('#7dcfff')
    expect(resolveModelAccent(undefined)).toBe('#7dcfff')
    expect(resolveModelAccent('')).toBe('#7dcfff')
  })
})
