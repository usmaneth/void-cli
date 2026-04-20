/**
 * Pure provider-list helpers. Mirrors the data that
 * `src/commands/provider/provider.ts` exposes via text, but returns typed
 * rows suitable for the `/provider` picker.
 *
 * "Enabled" here means "Void will consider this provider when routing
 * requests" — stored in user settings as `providers[<name>].enabled`. The
 * actual key presence is a separate dimension ("connected" vs "missing
 * key"), kept as `status` so the picker can annotate rows.
 */
import { execFileSync } from 'child_process'
import { userInfo } from 'os'

export type ProviderId =
  | 'anthropic'
  | 'openrouter'
  | 'openai'
  | 'gemini'

export type ProviderStatus =
  | 'connected-env'
  | 'connected-keychain'
  | 'connected-oauth'
  | 'missing-key'

export type ProviderRow = {
  readonly id: ProviderId
  readonly label: string
  readonly description: string
  readonly status: ProviderStatus
  readonly enabled: boolean
}

const PROVIDER_CATALOG: readonly { id: ProviderId; label: string; description: string; envVar: string }[] = [
  { id: 'anthropic', label: 'Anthropic', description: 'Claude Opus / Sonnet / Haiku', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', description: 'Hundreds of models via one key', envVar: 'OPENROUTER_API_KEY' },
  { id: 'openai', label: 'OpenAI', description: 'GPT-5, GPT-5 Mini', envVar: 'OPENAI_API_KEY' },
  { id: 'gemini', label: 'Gemini', description: 'Gemini 3 Pro / Flash', envVar: 'GEMINI_API_KEY' },
]

function readKeychainKey(provider: ProviderId): string | null {
  if (process.platform !== 'darwin') return null
  const service = `Void-${provider}`
  const username = process.env.USER || userInfo().username
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', username, '-w'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Compute the current status for each provider. `enabled` defaults to true
 * for any provider with a connected key; callers override via settings.
 */
export function computeProviderRows(
  enabledMap: Readonly<Partial<Record<ProviderId, boolean>>> = {},
  oauthProbe: (provider: ProviderId) => boolean = () => false,
): ProviderRow[] {
  const rows: ProviderRow[] = []
  for (const entry of PROVIDER_CATALOG) {
    const envKey = !!process.env[entry.envVar]
    const kcKey = envKey ? null : readKeychainKey(entry.id)
    let status: ProviderStatus
    if (envKey) status = 'connected-env'
    else if (kcKey) status = 'connected-keychain'
    else if (oauthProbe(entry.id)) status = 'connected-oauth'
    else status = 'missing-key'

    const connected = status !== 'missing-key'
    const enabled = enabledMap[entry.id] ?? connected
    rows.push({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      status,
      enabled,
    })
  }
  return rows
}

export function describeStatus(status: ProviderStatus): string {
  switch (status) {
    case 'connected-env':
      return 'connected (env)'
    case 'connected-keychain':
      return 'connected (keychain)'
    case 'connected-oauth':
      return 'connected (OAuth)'
    case 'missing-key':
      return 'no key'
  }
}

export function toggleProvider(
  rows: readonly ProviderRow[],
  id: ProviderId,
): ProviderRow[] {
  return rows.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r))
}
