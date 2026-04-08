import { execFileSync } from 'child_process'
import { userInfo } from 'os'
import type { LocalCommandCall } from '../../types/command.js'

const SUPPORTED_PROVIDERS = ['openrouter', 'local', 'runpod'] as const
type ProviderName = (typeof SUPPORTED_PROVIDERS)[number]

/** Default local models recommended per RAM tier */
const LOCAL_MODELS: Record<string, { ram: string; description: string }> = {
  'qwen2.5-coder:7b': { ram: '8 GB+', description: 'Lightweight coding model' },
  'qwen2.5-coder:14b': { ram: '16 GB+', description: 'Balanced coding model' },
  'qwen2.5-coder:32b': { ram: '24 GB+', description: 'Best local coding model' },
  'codestral:22b': { ram: '16 GB+', description: 'Strong code completion' },
  'deepseek-coder-v2:16b': { ram: '16 GB+', description: 'Capable coding model' },
}

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
    case 'local':
      return !!process.env.VOID_USE_LOCAL
    case 'runpod':
      return !!process.env.RUNPOD_API_KEY
  }
}

async function isOllamaRunning(): Promise<boolean> {
  const baseURL = process.env.VOID_LOCAL_BASE_URL || 'http://localhost:11434'
  try {
    const response = await fetch(`${baseURL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function listOllamaModels(): Promise<string[]> {
  const baseURL = process.env.VOID_LOCAL_BASE_URL || 'http://localhost:11434'
  try {
    const response = await fetch(`${baseURL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return []
    const data = (await response.json()) as any
    return (data.models ?? []).map((m: any) => m.name as string)
  } catch {
    return []
  }
}

function getProviderStatus(provider: ProviderName): string {
  if (provider === 'local') {
    if (process.env.VOID_USE_LOCAL) return 'enabled (env var)'
    return 'not enabled (set VOID_USE_LOCAL=1 or use /provider setup local)'
  }

  if (provider === 'runpod') {
    const envKey = !!process.env.RUNPOD_API_KEY
    const keychainKey = readKeyFromKeychain('runpod' as ProviderName)
    if (envKey) return 'connected (env var)'
    if (keychainKey) return 'connected (keychain)'
    return 'missing key (set RUNPOD_API_KEY or /provider add runpod <key>)'
  }

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

  if (provider === 'local') {
    return 'Local provider does not need an API key. Use /provider setup local to get started.'
  }

  if (!keyArg) {
    return `Usage: /provider add ${provider} <api-key>\n\nGet your API key from:\n  openrouter: https://openrouter.ai/keys\n  runpod:     https://www.runpod.io/console/user/settings`
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

async function handleSetupLocal(): Promise<string> {
  const lines: string[] = ['Local Model Setup (Ollama)', '']

  // Check if Ollama is running
  const running = await isOllamaRunning()
  if (!running) {
    lines.push('  Ollama is NOT running.')
    lines.push('')
    lines.push('  To get started:')
    lines.push('    1. Install Ollama: https://ollama.com/download')
    lines.push('    2. Start Ollama: ollama serve')
    lines.push('    3. Pull a model: ollama pull qwen2.5-coder:32b')
    lines.push('    4. Enable local provider: export VOID_USE_LOCAL=1')
    lines.push('    5. Set model: export VOID_LOCAL_MODEL=qwen2.5-coder:32b')
    lines.push('')
    lines.push('  Or use the model prefix: --model local:qwen2.5-coder:32b')
    return lines.join('\n')
  }

  lines.push('  Ollama is running.')
  lines.push('')

  // List installed models
  const models = await listOllamaModels()
  if (models.length > 0) {
    lines.push('  Installed models:')
    for (const m of models) {
      lines.push(`    - ${m}`)
    }
  } else {
    lines.push('  No models installed yet.')
  }

  lines.push('')
  lines.push('  Recommended models for your 24 GB Mac:')
  for (const [name, info] of Object.entries(LOCAL_MODELS)) {
    const installed = models.some(m => m.startsWith(name.split(':')[0]!))
    const tag = installed ? ' (installed)' : ''
    lines.push(`    ${name.padEnd(28)} ${info.ram.padEnd(8)} ${info.description}${tag}`)
  }

  lines.push('')
  lines.push('  Quick start:')
  lines.push('    ollama pull qwen2.5-coder:32b')
  lines.push('    export VOID_USE_LOCAL=1')
  lines.push('    void --model local:qwen2.5-coder:32b')

  return lines.join('\n')
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

  // RunPod (ephemeral GPU)
  const runpodStatus = getProviderStatus('runpod')
  const runpodReady = runpodStatus.startsWith('connected')
  lines.push('')
  lines.push(
    `  runpod:<model>        -> RunPod GPU Cloud ${runpodReady ? '(ready)' : '(no key)'}`,
  )
  lines.push('    e.g. runpod:glm-5.1-iq2, runpod:qwen2.5-coder:32b')
  lines.push('    Ephemeral pods — pay only when running, E2E encrypted')

  if (!runpodReady) {
    lines.push('    To configure: /provider add runpod <api-key>')
  }

  // Local models
  const localEnabled = !!process.env.VOID_USE_LOCAL
  const localBaseURL = process.env.VOID_LOCAL_BASE_URL || 'http://localhost:11434/v1'
  lines.push('')
  lines.push(
    `  local:<model>         -> Local (Ollama) ${localEnabled ? `(enabled @ ${localBaseURL})` : '(not enabled)'}`,
  )
  lines.push('    e.g. local:qwen2.5-coder:32b, local:codestral:22b')

  if (!localEnabled) {
    lines.push('    To enable: export VOID_USE_LOCAL=1 or /provider setup local')
  }

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

async function handleSetupRunPod(): Promise<string> {
  const lines: string[] = ['RunPod GPU Cloud Setup', '']

  const hasKey = !!process.env.RUNPOD_API_KEY || !!readKeyFromKeychain('runpod' as ProviderName)

  if (!hasKey) {
    lines.push('  No RunPod API key configured.')
    lines.push('')
    lines.push('  To get started:')
    lines.push('    1. Create account: https://www.runpod.io')
    lines.push('    2. Get API key: https://www.runpod.io/console/user/settings')
    lines.push('    3. Add key: /provider add runpod <api-key>')
    lines.push('')
    lines.push('  Pricing (on-demand, 1x GPU):')
    lines.push('    RTX 4090 (24 GB)   ~$0.69/hr  — good for 32B models')
    lines.push('    A100 80 GB         ~$1.99/hr  — good for 70B+ models')
    lines.push('    4x A100 80 GB      ~$7.96/hr  — required for GLM-5.1')
    lines.push('')
    lines.push('  Cost estimate (2 hrs/day):')
    lines.push('    RTX 4090:   ~$42/month')
    lines.push('    A100:       ~$120/month')
    lines.push('    4x A100:    ~$480/month (GLM-5.1)')
    lines.push('    Spot:       30-50% cheaper (interruptible)')
    return lines.join('\n')
  }

  lines.push('  RunPod API key: configured')
  lines.push('')

  try {
    const { loadRunPodConfig } = await import('../../services/runpod/client.js')
    const config = loadRunPodConfig()

    if (config?.activePodId) {
      const { getPod } = await import('../../services/runpod/client.js')
      try {
        const pod = await getPod(config.activePodId)
        lines.push(`  Active pod: ${pod.id}`)
        lines.push(`    Status: ${pod.status}`)
        lines.push(`    GPU: ${pod.gpuType}`)
        lines.push(`    Uptime: ${Math.round(pod.uptimeMs / 60000)} min`)
        if (pod.apiEndpoint) {
          lines.push(`    Endpoint: ${pod.apiEndpoint}`)
        }
      } catch {
        lines.push('  Active pod: not found (may have been terminated)')
      }
    } else {
      lines.push('  No active pod.')
    }
  } catch (e) {
    lines.push(`  Error checking pod status: ${e instanceof Error ? e.message : String(e)}`)
  }

  lines.push('')
  lines.push('  Quick start:')
  lines.push('    export VOID_USE_RUNPOD=1')
  lines.push('    void --model runpod:qwen2.5-coder:32b   # auto-creates pod')
  lines.push('')
  lines.push('  Commands:')
  lines.push('    /provider pod       — check active pod status')
  lines.push('    /provider stop      — stop active pod (saves volume)')
  lines.push('')
  lines.push('  All payloads are E2E encrypted (RSA-4096 + AES-256-GCM).')
  lines.push('  Your private key stays local. Pod never sees plaintext memory.')

  return lines.join('\n')
}

async function handleRunPodStop(): Promise<string> {
  try {
    const { stopActivePod, loadRunPodConfig } = await import('../../services/runpod/client.js')
    const config = loadRunPodConfig()
    if (!config?.activePodId) {
      return 'No active RunPod session to stop.'
    }
    await stopActivePod()
    return `Pod ${config.activePodId} stopped. Volume preserved for quick resume.\nTo terminate completely: use RunPod console.`
  } catch (e) {
    return `Failed to stop pod: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function handleRunPodStatus(): Promise<string> {
  try {
    const { getPod, loadRunPodConfig } = await import('../../services/runpod/client.js')
    const config = loadRunPodConfig()
    if (!config?.activePodId) {
      return 'No active RunPod pod. Start one with: void --model runpod:<model>'
    }
    const pod = await getPod(config.activePodId)
    const lines = [
      `Pod: ${pod.id}`,
      `  Name:     ${pod.name}`,
      `  Status:   ${pod.status}`,
      `  GPU:      ${pod.gpuCount}x ${pod.gpuType}`,
      `  Uptime:   ${Math.round(pod.uptimeMs / 60000)} min`,
      `  Endpoint: ${pod.apiEndpoint || 'not ready'}`,
      `  Cost:     ~$${pod.costPerHourUSD.toFixed(2)}/hr`,
    ]
    return lines.join('\n')
  } catch (e) {
    return `Failed to get pod status: ${e instanceof Error ? e.message : String(e)}`
  }
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
    case 'setup':
      if (parts[1]?.toLowerCase() === 'local') {
        return { type: 'text', value: await handleSetupLocal() }
      }
      if (parts[1]?.toLowerCase() === 'runpod') {
        return { type: 'text', value: await handleSetupRunPod() }
      }
      return { type: 'text', value: 'Usage: /provider setup <local|runpod>' }
    case 'stop':
      return { type: 'text', value: await handleRunPodStop() }
    case 'pod':
      return { type: 'text', value: await handleRunPodStatus() }
    case 'models':
      if (parts[1]?.toLowerCase() === 'local' || !parts[1]) {
        const models = await listOllamaModels()
        if (models.length === 0) {
          return { type: 'text', value: 'No local models found. Is Ollama running? (ollama serve)' }
        }
        return { type: 'text', value: `Local models:\n${models.map(m => `  - ${m}`).join('\n')}` }
      }
      return { type: 'text', value: 'Usage: /provider models local' }
    default:
      return {
        type: 'text',
        value: `Unknown subcommand "${subcommand}". Available: list, add, remove, status, setup, models, pod, stop`,
      }
  }
}
