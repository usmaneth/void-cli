/**
 * Built-in LSP Defaults — per-language lazy spawn manager.
 *
 * The pre-existing LSPServerManager is plugin-driven: without a plugin, no
 * language servers are configured. This module *supplements* that with a
 * zero-config default set so users get diagnostics out of the box when the
 * feature flag is on.
 *
 * Supported languages:
 *   - TypeScript / JavaScript  → typescript-language-server
 *   - Python                   → pyright-langserver, fallback pylsp
 *   - Rust                     → rust-analyzer
 *   - Go                       → gopls
 *
 * Availability is detected via `which` — we never claim a language we can't
 * actually serve. Spawns are *lazy*: we only register a server config in the
 * manager; the existing ensureServerStarted() logic starts the process on
 * first request for a matching file.
 *
 * Workspace roots are auto-detected by walking up from the touched file:
 *   tsconfig.json / package.json  → TS root
 *   pyproject.toml / setup.py     → Py root
 *   Cargo.toml                    → Rust root
 *   go.mod                        → Go root
 *
 * Crash isolation + auto-restart semantics are inherited from LSPServerInstance
 * (max 3 restart attempts via its maxRestarts config field).
 */

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import * as path from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { getCwd } from '../../utils/cwd.js'
import { isLspServerEnabled } from './diagnostics.js'
import {
  createLSPServerInstance,
  type LSPServerInstance,
} from './LSPServerInstance.js'

/**
 * Shape of a registered server config — matches the duck-typed fields that
 * LSPServerManager + LSPServerInstance read. Kept local so we don't depend
 * on the stubbed types.ts module.
 */
type BuiltinServerConfig = {
  command: string
  args?: string[]
  /** file extension (with leading dot) -> LSP languageId */
  extensionToLanguage: Record<string, string>
  workspaceFolder?: string
  env?: Record<string, string>
  /** Inherited crash-recovery limit (see LSPServerInstance.ts) */
  maxRestarts?: number
  /** Init options passed to server; empty object by default */
  initializationOptions?: Record<string, unknown>
  startupTimeout?: number
}

/** One built-in language definition. */
type BuiltinLang = {
  /** Stable server name used as manager key */
  name: string
  /** Ordered list of candidate commands to look up via `which` */
  candidates: Array<{
    command: string
    args?: string[]
    initializationOptions?: Record<string, unknown>
  }>
  /** File extensions mapped to LSP language IDs */
  extensionToLanguage: Record<string, string>
  /** Project-root markers walked up from the current file */
  rootMarkers: string[]
}

const BUILTIN_LANGS: BuiltinLang[] = [
  {
    name: 'typescript',
    candidates: [{ command: 'typescript-language-server', args: ['--stdio'] }],
    extensionToLanguage: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.mts': 'typescript',
      '.cts': 'typescript',
    },
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
  },
  {
    name: 'python',
    candidates: [
      { command: 'pyright-langserver', args: ['--stdio'] },
      { command: 'pylsp' },
    ],
    extensionToLanguage: { '.py': 'python', '.pyi': 'python' },
    rootMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile'],
  },
  {
    name: 'rust',
    candidates: [{ command: 'rust-analyzer' }],
    extensionToLanguage: { '.rs': 'rust' },
    rootMarkers: ['Cargo.toml'],
  },
  {
    name: 'go',
    candidates: [{ command: 'gopls' }],
    extensionToLanguage: { '.go': 'go' },
    rootMarkers: ['go.mod'],
  },
]

/**
 * Cache: languageName -> resolved LSPServerInstance (null = not available /
 * already failed probe, undefined = not yet probed).
 */
const instanceCache = new Map<string, LSPServerInstance | null>()

/**
 * Cache `which` probes so we don't fork for every file touch. A null entry
 * means "not installed" — we never retry during a session.
 */
const whichCache = new Map<string, string | null>()

/**
 * Look up a binary on PATH using `command -v` (posix) / `where` (win32).
 * Returns the first resolved path, or null when not found.
 *
 * We avoid a dependency on `which` or node:util.promisify(execFile) to keep
 * the cold path lean — this module is on the critical path of file reads.
 */
export function whichSync(binary: string): string | null {
  const cached = whichCache.get(binary)
  if (cached !== undefined) return cached

  let result: string | null = null
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', [binary], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim()
      result = out.split(/\r?\n/)[0] ?? null
    } else {
      const out = execFileSync('command', ['-v', binary], {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: '/bin/sh',
      })
        .toString()
        .trim()
      result = out || null
    }
  } catch {
    result = null
  }
  whichCache.set(binary, result)
  return result
}

/**
 * Walk up from `startDir` looking for any of `markers`. Stops at the
 * filesystem root or at `stopAt` (default: getCwd()).
 */
export function findWorkspaceRoot(
  startDir: string,
  markers: string[],
  stopAt?: string,
): string | undefined {
  const stop = stopAt ? path.resolve(stopAt) : path.resolve(getCwd())
  let dir = path.resolve(startDir)
  // Walk up at most 64 levels — belt-and-suspenders against symlink loops.
  for (let i = 0; i < 64; i++) {
    for (const marker of markers) {
      if (existsSync(path.join(dir, marker))) return dir
    }
    if (dir === stop) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Resolve the built-in language definition (if any) that covers this file
 * extension. Exported for tests and for the builtin manager.
 */
export function getLangForExtension(ext: string): BuiltinLang | undefined {
  const normalized = ext.toLowerCase()
  return BUILTIN_LANGS.find(l =>
    Object.prototype.hasOwnProperty.call(l.extensionToLanguage, normalized),
  )
}

/**
 * Build a BuiltinServerConfig for a file, or return undefined when either:
 *   - the language isn't supported by our built-in set
 *   - no candidate binary is installed
 *
 * Exported for the manager integration and for tests.
 */
export function resolveBuiltinConfigForFile(
  filePath: string,
): { lang: BuiltinLang; config: BuiltinServerConfig } | undefined {
  const ext = path.extname(filePath).toLowerCase()
  const lang = getLangForExtension(ext)
  if (!lang) return undefined

  // Find the first installed candidate
  let chosen: BuiltinLang['candidates'][number] | undefined
  for (const c of lang.candidates) {
    if (whichSync(c.command)) {
      chosen = c
      break
    }
  }
  if (!chosen) {
    logForDebugging(
      `[LSP BUILTIN] no binary found for ${lang.name}; tried: ${lang.candidates
        .map(c => c.command)
        .join(', ')}`,
    )
    return undefined
  }

  const fileDir = path.dirname(path.resolve(filePath))
  const root = findWorkspaceRoot(fileDir, lang.rootMarkers) ?? getCwd()

  const config: BuiltinServerConfig = {
    command: chosen.command,
    args: chosen.args,
    extensionToLanguage: lang.extensionToLanguage,
    workspaceFolder: root,
    initializationOptions: chosen.initializationOptions ?? {},
    maxRestarts: 3, // task: auto-restart with backoff, max 3 retries
  }

  return { lang, config }
}

/**
 * Lazily produce an LSPServerInstance for this file. Called by higher-level
 * integration code (e.g. a wrapper around getLspServerManager()). The returned
 * instance is cached per-language for the session.
 *
 * Returns undefined when:
 *   - the feature flag is off
 *   - the language isn't in our built-in set
 *   - no candidate binary is installed
 *
 * This never starts the process — callers invoke `.start()` (or the existing
 * manager routes the request through ensureServerStarted()).
 */
export function getBuiltinServerForFile(
  filePath: string,
): LSPServerInstance | undefined {
  if (!isLspServerEnabled()) return undefined

  const resolved = resolveBuiltinConfigForFile(filePath)
  if (!resolved) return undefined

  const { lang, config } = resolved
  const cached = instanceCache.get(lang.name)
  if (cached === null) return undefined
  if (cached) return cached

  try {
    // Cast to any for the duck-typed config — the underlying LSPServerInstance
    // reads only the fields we've set and types.ts is a stub (= any).
    const instance = createLSPServerInstance(
      `builtin:${lang.name}`,
      config as unknown as Parameters<typeof createLSPServerInstance>[1],
    )
    instanceCache.set(lang.name, instance)
    return instance
  } catch (err) {
    logForDebugging(
      `[LSP BUILTIN] failed to create instance for ${lang.name}: ${
        (err as Error).message
      }`,
    )
    instanceCache.set(lang.name, null)
    return undefined
  }
}

/**
 * Reset all caches — for tests. Stops any running instances.
 */
export async function _resetBuiltinsForTesting(): Promise<void> {
  for (const inst of instanceCache.values()) {
    if (inst) {
      try {
        await inst.stop()
      } catch {
        // ignore
      }
    }
  }
  instanceCache.clear()
  whichCache.clear()
}

/**
 * Snapshot of the current built-in language table for diagnostics/logging.
 */
export function listBuiltinLanguages(): Array<{
  name: string
  extensions: string[]
  available: boolean
}> {
  return BUILTIN_LANGS.map(l => ({
    name: l.name,
    extensions: Object.keys(l.extensionToLanguage),
    available: l.candidates.some(c => whichSync(c.command) !== null),
  }))
}
