import { execFileSync } from 'child_process'
import { userInfo } from 'os'

const cachedProviderKeys: Record<string, string | null | undefined> = {}

export type ProviderKeychainName = 'openrouter' | 'openai' | 'gemini'

export const PROVIDER_KEYCHAIN_NAMES: readonly ProviderKeychainName[] = [
  'openrouter',
  'openai',
  'gemini',
]

function getKeychainUsername(): string {
  try {
    return process.env.USER || userInfo().username
  } catch {
    return 'void-cli-user'
  }
}

function invalidateCache(provider: ProviderKeychainName): void {
  cachedProviderKeys[provider] = undefined
}

/**
 * Reads a provider API key from the macOS keychain using the same
 * Void-<provider> service names as the /provider command.
 */
export async function getProviderKeyFromKeychain(
  provider: ProviderKeychainName,
): Promise<string | null> {
  if (cachedProviderKeys[provider] !== undefined) {
    return cachedProviderKeys[provider]!
  }

  if (process.platform !== 'darwin') {
    cachedProviderKeys[provider] = null
    return null
  }

  const { execFileNoThrow } = await import('./execFileNoThrow.js')
  const username = getKeychainUsername()

  for (const args of [
    ['find-generic-password', '-s', `Void-${provider}`, '-a', username, '-w'],
    ['find-generic-password', '-s', `Void-${provider}`, '-w'],
  ]) {
    const result = await execFileNoThrow('security', args, {
      timeout: 5000,
      preserveOutputOnError: false,
      useCwd: false,
    })
    if (result.code === 0 && result.stdout.trim()) {
      const key = result.stdout.trim()
      cachedProviderKeys[provider] = key
      return key
    }
  }

  cachedProviderKeys[provider] = null
  return null
}

/**
 * Synchronous keychain read. Used by code paths that can't `await`
 * (e.g. provider.ts which runs synchronously today). Mirrors
 * getProviderKeyFromKeychain; keeps cache in sync.
 */
export function getProviderKeyFromKeychainSync(
  provider: ProviderKeychainName,
): string | null {
  if (cachedProviderKeys[provider] !== undefined) {
    return cachedProviderKeys[provider]!
  }
  if (process.platform !== 'darwin') {
    cachedProviderKeys[provider] = null
    return null
  }
  const username = getKeychainUsername()
  for (const args of [
    ['find-generic-password', '-s', `Void-${provider}`, '-a', username, '-w'],
    ['find-generic-password', '-s', `Void-${provider}`, '-w'],
  ]) {
    try {
      const out = execFileSync('security', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const trimmed = out.trim()
      if (trimmed) {
        cachedProviderKeys[provider] = trimmed
        return trimmed
      }
    } catch {
      // fall through to the next arg shape
    }
  }
  cachedProviderKeys[provider] = null
  return null
}

/**
 * Write a provider API key to the macOS keychain under service
 * `Void-<provider>`. Returns true on success.
 */
export function storeProviderKeyInKeychain(
  provider: ProviderKeychainName,
  key: string,
): boolean {
  if (process.platform !== 'darwin') return false
  try {
    const username = getKeychainUsername()
    execFileSync(
      'security',
      [
        'add-generic-password',
        '-s',
        `Void-${provider}`,
        '-a',
        username,
        '-w',
        key,
        '-U',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    invalidateCache(provider)
    return true
  } catch {
    return false
  }
}

/**
 * Delete a provider API key from the macOS keychain. Returns true if
 * an entry was removed.
 */
export function deleteProviderKeyFromKeychain(
  provider: ProviderKeychainName,
): boolean {
  if (process.platform !== 'darwin') return false
  try {
    const username = getKeychainUsername()
    execFileSync(
      'security',
      ['delete-generic-password', '-s', `Void-${provider}`, '-a', username],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    invalidateCache(provider)
    return true
  } catch {
    return false
  }
}

export function getProviderKeychainServiceName(
  provider: ProviderKeychainName,
): string {
  return `Void-${provider}`
}

/**
 * Env-var name a given provider uses. Keeps env-var lookups DRY
 * across auth-detection helpers and the /login router.
 */
export function getProviderEnvVarName(
  provider: ProviderKeychainName,
): string {
  switch (provider) {
    case 'openrouter':
      return 'OPENROUTER_API_KEY'
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'gemini':
      return 'GEMINI_API_KEY'
  }
}

export function hasProviderEnvKey(provider: ProviderKeychainName): boolean {
  return !!process.env[getProviderEnvVarName(provider)]
}

// -----------------------------------------------------------------------------
// Key-format validators. These are intentionally lenient — we reject obviously
// malformed input (wrong prefix, whitespace, too short) but stay permissive
// about length/suffix so rotated or alternate-tenant keys don't get blocked.
// -----------------------------------------------------------------------------

export type KeyValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateProviderKey(
  provider: ProviderKeychainName,
  raw: string,
): KeyValidationResult {
  const key = raw.trim()
  if (!key) return { ok: false, reason: 'Key is empty.' }
  if (/\s/.test(key)) return { ok: false, reason: 'Key contains whitespace.' }

  switch (provider) {
    case 'openrouter': {
      if (!key.startsWith('sk-or-v1-')) {
        return {
          ok: false,
          reason: 'OpenRouter keys start with "sk-or-v1-".',
        }
      }
      if (key.length < 20) {
        return { ok: false, reason: 'OpenRouter key looks too short.' }
      }
      return { ok: true }
    }
    case 'openai': {
      if (!key.startsWith('sk-')) {
        return {
          ok: false,
          reason: 'OpenAI keys start with "sk-".',
        }
      }
      // Explicitly disallow openrouter-prefixed keys sneaking into openai
      if (key.startsWith('sk-or-')) {
        return {
          ok: false,
          reason: 'That looks like an OpenRouter key. Run /login openrouter instead.',
        }
      }
      if (key.length < 20) {
        return { ok: false, reason: 'OpenAI key looks too short.' }
      }
      return { ok: true }
    }
    case 'gemini': {
      // Google AI Studio keys are 39 alphanumeric chars (optionally hyphen/underscore).
      if (!/^[A-Za-z0-9_-]+$/.test(key)) {
        return {
          ok: false,
          reason: 'Gemini keys are alphanumeric (hyphen/underscore allowed).',
        }
      }
      if (key.length < 30) {
        return {
          ok: false,
          reason: 'Gemini key looks too short (expected ~39 chars).',
        }
      }
      return { ok: true }
    }
  }
}
