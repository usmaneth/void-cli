/**
 * OpenAI direct provider — API client, auth, and keychain integration.
 *
 * Used by swarm workers and direct model routing when the user has an
 * OpenAI API key configured (via env var or macOS Keychain).
 */

import { createOpenAIShimClient } from '../services/api/openaiShim.js'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Create an OpenAI client via the OpenAI-compatible shim.
 * Returns an Anthropic-compatible client interface.
 */
export function createOpenAIClient(apiKey: string, options?: { timeout?: number }) {
  return createOpenAIShimClient({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL ?? OPENAI_BASE_URL,
    defaultHeaders: {},
    timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
  })
}

/**
 * Resolve the OpenAI API key from env var or macOS Keychain.
 */
export function getOpenAIApiKey(): string | null {
  const envKey = process.env.OPENAI_API_KEY
  if (envKey) return envKey

  if (process.platform === 'darwin') {
    try {
      const { execFileSync } = require('child_process')
      const username =
        process.env.USER || require('os').userInfo().username
      for (const args of [
        ['find-generic-password', '-s', 'Void-openai', '-a', username, '-w'],
        ['find-generic-password', '-s', 'Void-openai', '-w'],
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
