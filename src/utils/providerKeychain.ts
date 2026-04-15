const cachedProviderKeys: Record<string, string | null | undefined> = {}

export type ProviderKeychainName = 'openrouter' | 'openai' | 'gemini'

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
  const username = process.env.USER || (await import('os')).userInfo().username

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
