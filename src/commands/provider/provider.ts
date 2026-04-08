import { execFileSync } from 'child_process'
import { userInfo } from 'os'
import type { LocalCommandCall } from '../../types/command.js'

const SUPPORTED_PROVIDERS = ['openrouter'] as const
type ProviderName = (typeof SUPPORTED_PROVIDERS)[number]

const KEYCHAIN_SERVICE_PREFIX = 'Void'

function getKeychainService(provider: ProviderName): string {
  return `${KEYCHAIN_SERVICE_PREFIX}-${provider}`
}

function getUsername(): string {
  try {
    return process.env.USER || userInfo().username
  } catch {
    return 'void-cli-user'
  }
}

function readKeyFromKeychain(provider: ProviderName): string | null {
  if (process.platform !== 'darwin') return null
  try {
    const service = getKeychainService(provider)
    const username = getUsername()
    const result = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', username, '-w'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return result.trim() || null
  } catch {
    return null
  }
}

function storeKeyInKeychain(provider: ProviderName, key: string): boolean {
  if (process.platform !== 'darwin') return false
  try {
    const service = getKeychainService(provider)
    const username = getUsername()
    execFileSync(
      'security',
      ['add-generic-password', '-s', service, '-a', username, '-w', key, '-U'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return true
  } catch {
    return false
  }
}

function deleteKeyFromKeychain(provider: ProviderName): boolean {
  if (process.platform !== 'darwin') return false
  try {
    const service = getKeychainService(provider)
    const username = getUsername()
    execFileSync(
      'security',
      ['delete-generic-password', '-s', service, '-a', username],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return true
  } catch {
    return false
  }
}

function hasEnvKey(provider: ProviderName): boolean {
  switch (provider) {
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY
  }
}

function getProviderStatus(provider: ProviderName): string {
  const envKey = hasEnvKey(provider)
  const keychainKey = readKeyFromKeychain(provider)

  if (envKey) return 'connected (env var)'
  if (keychainKey) return 'connected (keychain)'
  return 'missing key'
}

function handleList(): string {
  const lines: string[] = ['Providers:', '']

  // Anthropic (always present as the default)
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const anthropicStatus = anthropicKey ? 'connected (env var)' : 'missing key'
  lines.push(`  anthropic    ${anthropicStatus}`)

  // Additional providers
  for (const provider of SUPPORTED_PROVIDERS) {
    const status = getProviderStatus(provider)
    lines.push(`  ${provider.padEnd(13)} ${status}`)
  }

  return lines.join('\n')
}

function handleAdd(
  providerArg: string | undefined,
  keyArg: string | undefined,
): string {
  if (!providerArg) {
    return (
      'Usage: /provider add <provider> <api-key>\nSupported providers: ' +
      SUPPORTED_PROVIDERS.join(', ')
    )
  }

  const provider = providerArg.toLowerCase() as ProviderName
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return `Unknown provider "${providerArg}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`
  }

  if (!keyArg) {
    return `Usage: /provider add ${provider} <api-key>\n\nGet your API key from:\n  openrouter: https://openrouter.ai/keys`
  }

  if (process.platform !== 'darwin') {
    return 'Keychain storage is only supported on macOS. Set the OPENROUTER_API_KEY environment variable instead.'
  }

  const success = storeKeyInKeychain(provider, keyArg)
  if (success) {
    return `Stored ${provider} API key in macOS keychain (service: ${getKeychainService(provider)})`
  }
  return `Failed to store ${provider} API key in keychain. Try setting OPENROUTER_API_KEY environment variable instead.`
}

function handleRemove(providerArg: string | undefined): string {
  if (!providerArg) {
    return (
      'Usage: /provider remove <provider>\nSupported providers: ' +
      SUPPORTED_PROVIDERS.join(', ')
    )
  }

  const provider = providerArg.toLowerCase() as ProviderName
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return `Unknown provider "${providerArg}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`
  }

  if (process.platform !== 'darwin') {
    return 'Keychain storage is only supported on macOS. Remove the OPENROUTER_API_KEY environment variable instead.'
  }

  const success = deleteKeyFromKeychain(provider)
  if (success) {
    return `Removed ${provider} API key from macOS keychain`
  }
  return `No ${provider} API key found in keychain (may not have been stored)`
}

function handleStatus(): string {
  const lines: string[] = ['Provider routing:', '']

  // Anthropic models
  lines.push('  claude-*             -> Anthropic')
  lines.push('  claude-sonnet-4-*    -> Anthropic')
  lines.push('  claude-opus-4-*      -> Anthropic')

  // OpenRouter models
  const orStatus = getProviderStatus('openrouter')
  const orAvailable = orStatus.startsWith('connected')
  lines.push('')
  lines.push(
    `  <vendor>/<model>     -> OpenRouter ${orAvailable ? '(ready)' : '(no key configured)'}`,
  )
  lines.push('    e.g. openai/gpt-4o, google/gemini-2.5-pro')

  if (!orAvailable) {
    lines.push('')
    lines.push('  To configure OpenRouter: /provider add openrouter <api-key>')
  }

  return lines.join('\n')
}

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase()

  if (!subcommand || subcommand === 'list') {
    return { type: 'text', value: handleList() }
  }

  switch (subcommand) {
    case 'add':
      return { type: 'text', value: handleAdd(parts[1], parts[2]) }
    case 'remove':
      return { type: 'text', value: handleRemove(parts[1]) }
    case 'status':
      return { type: 'text', value: handleStatus() }
    default:
      return {
        type: 'text',
        value: `Unknown subcommand "${subcommand}". Available: list, add, remove, status`,
      }
  }
}
