/**
 * Voidex launcher — spawns the bundled Electron app at apps/voidex.
 *
 * The launcher is detached so the user can keep using the CLI while Voidex runs.
 * Context (mode, prompt, model) is passed via env vars and, for large payloads,
 * via a temp JSON file referenced by VOIDEX_HANDOFF.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type VoidexMode = 'chat' | 'swarm' | 'deliberate' | 'plan'

export interface VoidexLaunchOptions {
  mode?: VoidexMode
  prompt?: string
  model?: string
  models?: string[]
  rounds?: number
  cwd?: string
  sessionId?: string
  extra?: Record<string, unknown>
}

export interface VoidexLaunchResult {
  ok: boolean
  pid?: number
  error?: string
  electronBin?: string
  appPath: string
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/utils/ -> repo root is two levels up in src, or two from dist/utils/
  const up2 = resolve(here, '..', '..')
  // If running from dist/, jump out of dist too
  const up3 = resolve(here, '..', '..', '..')
  return existsSync(join(up2, 'apps', 'voidex', 'main.js'))
    ? up2
    : existsSync(join(up3, 'apps', 'voidex', 'main.js'))
      ? up3
      : up2
}

function findElectron(root: string): string | null {
  const candidates = [
    join(root, 'node_modules', '.bin', 'electron'),
    join(root, 'node_modules', '.bin', 'electron.cmd'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

export function launchVoidex(options: VoidexLaunchOptions = {}): VoidexLaunchResult {
  const root = repoRoot()
  const appPath = join(root, 'apps', 'voidex')
  if (!existsSync(join(appPath, 'main.js'))) {
    return {
      ok: false,
      error: `Voidex app not found at ${appPath}. Reinstall or clone the repo.`,
      appPath,
    }
  }

  const electron = findElectron(root)
  if (!electron) {
    return {
      ok: false,
      error:
        'electron is not installed. Run `bun install` (or `npm install`) in the repo root to install it, then try `/voidex` again.',
      appPath,
    }
  }

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (options.mode) env.VOIDEX_MODE = options.mode
  if (options.prompt) env.VOIDEX_PROMPT = options.prompt
  if (options.model) env.VOIDEX_MODEL = options.model
  if (options.models?.length) env.VOIDEX_MODELS = options.models.join(',')
  if (options.rounds) env.VOIDEX_ROUNDS = String(options.rounds)
  if (options.cwd) env.VOIDEX_CWD = options.cwd
  if (options.sessionId) env.VOIDEX_SESSION_ID = options.sessionId

  if (options.extra && Object.keys(options.extra).length) {
    try {
      const dir = join(tmpdir(), 'voidex')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `handoff-${Date.now()}-${process.pid}.json`)
      writeFileSync(file, JSON.stringify(options.extra))
      env.VOIDEX_HANDOFF = file
    } catch {}
  }

  const child = spawn(electron, [appPath], {
    cwd: options.cwd || root,
    env,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return { ok: true, pid: child.pid, electronBin: electron, appPath }
}
