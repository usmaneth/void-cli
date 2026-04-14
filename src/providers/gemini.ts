/**
 * Google Gemini direct provider — API client, auth, and keychain integration.
 *
 * Uses Gemini's OpenAI-compatible endpoint for consistency with the
 * existing shim layer. Used by the designer agent and swarm workers.
 */

import { createOpenAIShimClient } from '../services/api/openaiShim.js'

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Create a Gemini client via the OpenAI-compatible shim.
 * Returns an Anthropic-compatible client interface.
 */
export function createGeminiClient(apiKey: string, options?: { timeout?: number }) {
  return createOpenAIShimClient({
    apiKey,
    baseURL: process.env.GEMINI_BASE_URL ?? GEMINI_BASE_URL,
    defaultHeaders: {},
    timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
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
