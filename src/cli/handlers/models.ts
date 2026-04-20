/**
 * `void models list` subcommand handler — prints the discovered model catalog.
 * Dynamically imported only when the command runs to keep cold-start lean.
 */

import chalk from 'chalk'
import {
  type DiscoveryProvider,
  discoverModels,
  flattenCatalog,
  readCatalog,
} from '../../services/modelDiscovery/catalog.js'

const KNOWN_PROVIDERS: DiscoveryProvider[] = [
  'anthropic',
  'openai',
  'openrouter',
  'vercel',
  'gitlab',
  'gemini',
]

export interface ModelsListOptions {
  provider?: string
  refresh?: boolean
  json?: boolean
}

function isDiscoveryProvider(value: string): value is DiscoveryProvider {
  return (KNOWN_PROVIDERS as string[]).includes(value)
}

export async function modelsListHandler(opts: ModelsListOptions): Promise<void> {
  let targetProvider: DiscoveryProvider | undefined
  if (opts.provider) {
    if (!isDiscoveryProvider(opts.provider)) {
      process.stderr.write(
        `Unknown provider: ${opts.provider}. Known providers: ${KNOWN_PROVIDERS.join(', ')}\n`,
      )
      process.exit(1)
    }
    targetProvider = opts.provider
  }

  const { catalog, warnings } = await discoverModels({
    providers: targetProvider ? [targetProvider] : undefined,
    refresh: !!opts.refresh,
  })

  for (const warning of warnings) {
    process.stderr.write(chalk.yellow(`warning: ${warning}\n`))
  }

  if (opts.json) {
    const payload = targetProvider
      ? catalog.providers[targetProvider] ?? { provider: targetProvider, models: [] }
      : catalog
    // biome-ignore lint/suspicious/noConsole: intentional stdout output
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  const models = flattenCatalog(catalog, targetProvider)
  if (models.length === 0) {
    // biome-ignore lint/suspicious/noConsole: intentional stdout output
    console.log('No models found.')
    return
  }

  const byProvider = new Map<DiscoveryProvider, typeof models>()
  for (const m of models) {
    const arr = byProvider.get(m.provider) ?? []
    arr.push(m)
    byProvider.set(m.provider, arr)
  }

  const lines: string[] = []
  let total = 0
  for (const [provider, list] of byProvider) {
    const entry = catalog.providers[provider]
    const tag = entry?.fallback ? chalk.yellow(' (fallback)') : ''
    lines.push(chalk.bold(`${provider}${tag}: ${list.length} model(s)`))
    for (const m of list.sort((a, b) => a.id.localeCompare(b.id))) {
      const name = m.name ? chalk.dim(` — ${m.name}`) : ''
      const ctx = m.contextLength
        ? chalk.dim(` · ${Math.round(m.contextLength / 1000)}k ctx`)
        : ''
      lines.push(`  ${m.id}${name}${ctx}`)
      total++
    }
    lines.push('')
  }
  // biome-ignore lint/suspicious/noConsole: intentional stdout output
  console.log(`${total} model(s) across ${byProvider.size} provider(s)\n`)
  // biome-ignore lint/suspicious/noConsole: intentional stdout output
  console.log(lines.join('\n').trimEnd())
}

/**
 * Lightweight read-only view that just dumps the on-disk cache without hitting
 * the network. Exposed for diagnostics and tests.
 */
export function modelsCacheDump(): void {
  const catalog = readCatalog()
  // biome-ignore lint/suspicious/noConsole: intentional stdout output
  console.log(JSON.stringify(catalog, null, 2))
}
