/**
 * Voidex launcher — spawns the Electron app at apps/voidex.
 *
 * The launcher is detached so the user keeps a working terminal while the
 * desktop app runs. Context (mode, prompt, model) is passed via env vars
 * and a temp JSON file referenced by VOIDEX_HANDOFF.
 *
 * Two spawn modes are supported:
 *
 *   1. Source tree (default): runs `electron apps/voidex/out/main/index.js`
 *      if the app has been built (electron-vite), otherwise falls back to
 *      `electron apps/voidex` for the dev shell.
 *   2. Packaged binary: set VOIDEX_BIN to an absolute path to the installed
 *      Voidex executable (/Applications/Voidex.app/Contents/MacOS/Voidex or
 *      similar). The launcher will exec that instead.
 *
 * Ported from PR #56 (claude/build-voidex-app-47ZMJ) — the flag parsing and
 * handoff file format are intentionally preserved so upstream /voidex users
 * don't see a breaking change.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
  // src/utils/ when running from source; dist/utils/ when installed.
  for (const up of [resolve(here, '..', '..'), resolve(here, '..', '..', '..')]) {
    if (existsSync(join(up, 'apps', 'voidex', 'package.json'))) return up
  }
  return resolve(here, '..', '..')
}

function findElectron(root: string): string | null {
  const candidates = [
    join(root, 'node_modules', '.bin', 'electron'),
    join(root, 'node_modules', '.bin', 'electron.cmd'),
    join(root, 'apps', 'voidex', 'node_modules', '.bin', 'electron'),
    join(root, 'apps', 'voidex', 'node_modules', '.bin', 'electron.cmd'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

function resolveAppTarget(root: string): { electronArg: string; mode: 'built' | 'dev' } {
  // Prefer built bundle if available (fastest, matches production path).
  const built = join(root, 'apps', 'voidex', 'out', 'main', 'index.js')
  if (existsSync(built)) return { electronArg: built, mode: 'built' }
  // Fall back to the app directory so electron picks up its package.json main.
  return { electronArg: join(root, 'apps', 'voidex'), mode: 'dev' }
}

export function launchVoidex(options: VoidexLaunchOptions = {}): VoidexLaunchResult {
  const root = repoRoot()
  const appPath = join(root, 'apps', 'voidex')
  if (!existsSync(join(appPath, 'package.json'))) {
    return {
      ok: false,
      error: `Voidex app not found at ${appPath}. Reinstall or clone the repo.`,
      appPath,
    }
  }

  // Env-driven packaged binary path for installed users.
  const packaged = process.env.VOIDEX_BIN
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (options.mode) env.VOIDEX_MODE = options.mode
  if (options.prompt) env.VOIDEX_PROMPT = options.prompt
  if (options.model) env.VOIDEX_MODEL = options.model
  if (options.models?.length) env.VOIDEX_MODELS = options.models.join(',')
  if (options.rounds) env.VOIDEX_ROUNDS = String(options.rounds)
  if (options.cwd) env.VOIDEX_CWD = options.cwd
  if (options.sessionId) env.VOIDEX_SESSION_ID = options.sessionId
  // Feature flag: opt-in the SQLite session backend for Voidex handoffs.
  env.VOID_USE_SQLITE_SESSIONS = env.VOID_USE_SQLITE_SESSIONS ?? '1'

  if (options.extra && Object.keys(options.extra).length) {
    try {
      const dir = join(tmpdir(), 'voidex')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `handoff-${Date.now()}-${process.pid}.json`)
      writeFileSync(file, JSON.stringify(options.extra))
      env.VOIDEX_HANDOFF = file
    } catch {}
  }

  if (packaged && existsSync(packaged)) {
    const child = spawn(packaged, [], {
      cwd: options.cwd || root,
      env,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true, pid: child.pid, appPath }
  }

  const electron = findElectron(root)
  if (!electron) {
    return {
      ok: false,
      error:
        'electron is not installed. Run `bun install` at the repo root (workspaces will install apps/voidex), then try again. Alternatively set VOIDEX_BIN to an installed Voidex.app.',
      appPath,
    }
  }

  const { electronArg } = resolveAppTarget(root)
  const child = spawn(electron, [electronArg], {
    cwd: options.cwd || root,
    env,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return { ok: true, pid: child.pid, electronBin: electron, appPath }
}
