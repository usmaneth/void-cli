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
import { spawn, spawnSync } from 'node:child_process'
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

function hasCommand(cmd: string): boolean {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    stdio: 'ignore',
  })
  return result.status === 0
}

/**
 * First-use bootstrap: run `bun install` (or `npm install`) in apps/voidex
 * to pull down electron on demand. Blocks the caller; streams output to the
 * parent terminal so users see progress. Safe to call repeatedly — a noop
 * once electron is resolvable, and skipped if a prior attempt recorded a
 * permanent failure in `node_modules/.voidex-bootstrap-failed`.
 */
function bootstrapVoidex(root: string, appPath: string): { ok: boolean; error?: string } {
  const failMarker = join(root, 'node_modules', '.voidex-bootstrap-failed')
  if (existsSync(failMarker)) {
    return {
      ok: false,
      error: `Previous bootstrap attempt failed. Delete ${failMarker} to retry, or install manually with \`bun install\` at the repo root.`,
    }
  }

  const tool = hasCommand('bun') ? 'bun' : hasCommand('npm') ? 'npm' : null
  if (!tool) {
    return { ok: false, error: 'Neither `bun` nor `npm` found on PATH — install one to bootstrap Voidex.' }
  }

  // User-visible progress. Keep stderr streaming so install errors are legible.
  process.stderr.write(`\n[voidex] first-time setup — installing electron via ${tool}…\n`)
  const result = spawnSync(tool, ['install'], {
    cwd: appPath,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    try {
      mkdirSync(dirname(failMarker), { recursive: true })
      writeFileSync(failMarker, new Date().toISOString())
    } catch {}
    return { ok: false, error: `${tool} install failed with exit code ${result.status}. Check the output above and retry.` }
  }

  process.stderr.write(`[voidex] bootstrap complete\n\n`)
  return { ok: true }
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

  let electron = findElectron(root)
  if (!electron) {
    // First-use: try to install electron automatically. Blocks until install
    // finishes; stdio is inherited so the user sees progress live.
    const boot = bootstrapVoidex(root, appPath)
    if (!boot.ok) {
      return { ok: false, error: boot.error, appPath }
    }
    electron = findElectron(root)
    if (!electron) {
      return {
        ok: false,
        error: `Bootstrap ran but electron is still missing at ${appPath}/node_modules/.bin/electron. Run \`bun install\` manually to diagnose.`,
        appPath,
      }
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
