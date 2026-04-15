/**
 * Google Gemini direct provider — API client, auth, and keychain integration.
 *
 * Uses the native Gemini REST API (generateContent) for first-class
 * thought_signature support. Used by the designer agent and swarm workers.
 */

import { createGeminiShimClient } from '../services/api/geminiShim.js'

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Create a Gemini client via the native Gemini shim.
 * Returns an Anthropic-compatible client interface.
 */
export function createGeminiClient(apiKey: string, options?: { timeout?: number }) {
  return createGeminiShimClient({
    apiKey,
    baseURL: process.env.GEMINI_BASE_URL ?? undefined,
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
