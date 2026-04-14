import { execFileSync } from 'child_process'
import { userInfo } from 'os'
import type { LocalCommandCall } from '../../types/command.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'

const SUPPORTED_PROVIDERS = ['openrouter', 'openai', 'gemini'] as const
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
  const service = getKeychainService(provider)
  const username = getUsername()

  for (const args of [
    ['find-generic-password', '-s', service, '-a', username, '-w'],
    ['find-generic-password', '-s', service, '-w'],
  ]) {
    try {
      const result = execFileSync('security', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return result.trim() || null
    } catch {
      continue
    }
  }

  return null
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
    case 'openai':
      return !!process.env.OPENAI_API_KEY
    case 'gemini':
      return !!process.env.GEMINI_API_KEY
  }
}

function getProviderStatus(provider: ProviderName): string {
  const envKey = hasEnvKey(provider)
  const keychainKey = readKeyFromKeychain(provider)

  if (envKey) return 'connected (env var)'
  if (keychainKey) return 'connected (keychain)'
  return 'missing key'
}

async function handleList(): Promise<string> {
  const lines: string[] = ['Providers:', '']

  // Anthropic (check OAuth first, then API key)
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  let anthropicStatus: string
  if (anthropicKey) {
    anthropicStatus = 'connected (env var)'
  } else {
    const tokens = getClaudeAIOAuthTokens()
    anthropicStatus = tokens ? 'connected (OAuth)' : 'missing key'
  }
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
    return `Usage: /provider add ${provider} <api-key>\n\nGet your API key from:\n  openrouter: https://openrouter.ai/keys\n  openai:     https://platform.openai.com/api-keys\n  gemini:     https://aistudio.google.com/apikey`
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

  // Direct OpenAI models
  const openaiStatus = getProviderStatus('openai')
  const openaiAvailable = openaiStatus.startsWith('connected')
  lines.push('')
  lines.push(
    `  openai/*             -> OpenAI direct ${openaiAvailable ? '(ready)' : '(no key configured)'}`,
  )

  // Direct Gemini models
  const geminiStatus = getProviderStatus('gemini')
  const geminiAvailable = geminiStatus.startsWith('connected')
  lines.push(
    `  google/*             -> Gemini direct ${geminiAvailable ? '(ready)' : '(no key configured)'}`,
  )

  // OpenRouter models (fallback for all vendor/model patterns)
  const orStatus = getProviderStatus('openrouter')
  const orAvailable = orStatus.startsWith('connected')
  lines.push('')
  lines.push(
    `  <vendor>/<model>     -> OpenRouter ${orAvailable ? '(ready)' : '(no key configured)'}`,
  )
  lines.push('    Fallback for models without a direct provider key')

  const missingProviders: string[] = []
  if (!openaiAvailable) missingProviders.push('openai')
  if (!geminiAvailable) missingProviders.push('gemini')
  if (!orAvailable) missingProviders.push('openrouter')
  if (missingProviders.length > 0) {
    lines.push('')
    lines.push(
      `  To configure: /provider add <${missingProviders.join('|')}> <api-key>`,
    )
  }

  return lines.join('\n')
}

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase()

  if (!subcommand || subcommand === 'list') {
    return { type: 'text', value: await handleList() }
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
