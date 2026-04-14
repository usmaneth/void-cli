/**
 * Direct Gemini API client for the Designer Agent.
 *
 * Uses Gemini's OpenAI-compatible endpoint for consistency with the
 * existing OpenAI shim, but wraps it with designer-specific defaults
 * (longer timeout for large generations, dedicated auth lookup).
 */

import { createOpenAIShimClient } from '../../services/api/openaiShim.js'

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'

const DESIGNER_TIMEOUT_MS = 120_000 // 2 min — design generations can be large

/**
 * Create a Gemini client configured for the designer agent.
 * Returns an Anthropic-compatible client via the OpenAI shim.
 */
export function createGeminiDesignerClient(apiKey: string) {
  return createOpenAIShimClient({
    apiKey,
    baseURL: process.env.GEMINI_BASE_URL ?? GEMINI_BASE_URL,
    defaultHeaders: {},
    timeout: DESIGNER_TIMEOUT_MS,
  })
}

/**
 * Resolve the Gemini API key from env var or macOS Keychain.
 */
export function getGeminiApiKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY
  if (envKey) return envKey

  if (process.platform === 'darwin') {
    try {
      const { execFileSync } = require('child_process')
      const username =
        process.env.USER || require('os').userInfo().username
      // Try with account first, then without (matches /provider keychain logic)
      for (const args of [
        ['find-generic-password', '-s', 'Void-gemini', '-a', username, '-w'],
        ['find-generic-password', '-s', 'Void-gemini', '-w'],
      ]) {
        try {
          const result = (
            execFileSync as typeof import('child_process').execFileSync
          )('security', args, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          const key = (result as string).trim()
          if (key) return key
        } catch {
          continue
        }
      }
    } catch {}
  }

  return null
}
