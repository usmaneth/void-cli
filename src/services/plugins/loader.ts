/**
 * SDK plugin loader.
 *
 * Discovers plugins authored against @void-cli/plugin from three sources:
 *   1. `~/.void/plugins/*.{ts,js,mjs,cjs}`  — user-wide plugins
 *   2. `./.void/plugins/*`                  — project-local plugins
 *   3. npm packages listed in settings.plugins and either named
 *      `void-plugin-*`, scoped as `@<scope>/void-plugin-*`, or provided as
 *      explicit paths.
 *
 * This loader is intentionally isolated from the existing marketplace plugin
 * flow (see pluginOperations.ts). That flow handles discoverability through
 * a signed marketplace. This loader is for zero-ceremony local and npm
 * plugins authored against the SDK workspace package.
 *
 * The loader is pure — it does NOT mutate any global registry by itself.
 * The caller (startup wiring) decides whether to register tools/skills/
 * keybinds into host registries. This makes the loader easy to test.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Shape of a single loaded plugin entry.
 *
 * We intentionally type the manifest with minimal structural types here
 * instead of depending on @void-cli/plugin's exported PluginManifest. This
 * keeps the host decoupled from a specific SDK version — a plugin built
 * against v0.1 still loads on host v0.2 as long as the shape matches.
 */
export type LoadedPlugin = {
  /** Source identifier: package name, absolute file path, or dir path. */
  id: string
  /** Where the plugin came from (used for error messages / logging). */
  loadedFrom: string
  /** Which discovery channel surfaced it. */
  source: 'user' | 'project' | 'npm'
  /** The plugin manifest object (default export of the module). */
  manifest: PluginManifestShape
}

/**
 * A failed load attempt. Kept separate so callers can log all failures
 * without aborting on the first one.
 */
export type LoadError = {
  id: string
  loadedFrom: string
  source: 'user' | 'project' | 'npm'
  error: Error
  reason: 'import_failed' | 'invalid_manifest' | 'missing_default_export'
}

export type LoadResult = {
  loaded: LoadedPlugin[]
  errors: LoadError[]
}

/**
 * Structural plugin-manifest shape. Must stay in sync with
 * packages/plugin/src/types.ts PluginManifest. See the note above on why
 * this isn't a direct import.
 */
export type PluginManifestShape = {
  kind: 'plugin'
  name?: string
  version?: string
  tools?: readonly PluginToolShape[]
  skills?: readonly PluginSkillShape[]
  keybinds?: readonly PluginKeybindShape[]
  hooks?: Record<string, unknown>
  init?: (context: unknown) => void | Promise<void>
  onSessionStart?: (event: unknown) => void | Promise<void>
}

export type PluginToolShape = {
  kind: 'tool'
  name: string
  description: string
  parameters: unknown
  execute: (args: unknown, ctx: unknown) => unknown
  readOnly?: boolean
}

export type PluginSkillShape = {
  kind: 'skill'
  name: string
  description: string
  whenToUse?: string
  aliases?: readonly string[]
  argumentHint?: string
  userInvocable?: boolean
  handler: (ctx: unknown) => unknown
}

export type PluginKeybindShape = {
  kind: 'keybind'
  key: string
  label: string
  when?: 'repl' | 'input' | 'global'
  action: () => void | Promise<void>
}

export type LoaderOptions = {
  /** Working directory used to resolve `./.void/plugins` and npm deps. */
  cwd?: string
  /** Home directory — override for tests. */
  home?: string
  /** Explicit list from settings.json. Package names or absolute paths. */
  plugins?: readonly string[]
  /** File system stub — overridable for tests. */
  fs?: {
    readdir: typeof readdir
    stat: typeof stat
  }
  /** Dynamic import function — overridable for tests. Must return the
   * module namespace object (same shape as `await import(specifier)`). */
  importer?: (specifier: string) => Promise<Record<string, unknown>>
}

const DEFAULT_IMPORTER = (specifier: string): Promise<Record<string, unknown>> =>
  import(specifier) as Promise<Record<string, unknown>>
const DEFAULT_FS = { readdir, stat }
const PLUGIN_FILE_EXTS = ['.ts', '.mts', '.mjs', '.js', '.cjs']

/**
 * Discover and load all plugins from the configured sources.
 * Never throws — failures are aggregated into `errors`.
 */
export async function loadPlugins(
  options: LoaderOptions = {},
): Promise<LoadResult> {
  const cwd = options.cwd ?? process.cwd()
  const home = options.home ?? homedir()
  const fs = options.fs ?? DEFAULT_FS
  const importer = options.importer ?? DEFAULT_IMPORTER

  const loaded: LoadedPlugin[] = []
  const errors: LoadError[] = []

  // User-wide directory
  const userDir = join(home, '.void', 'plugins')
  for (const file of await listPluginFiles(userDir, fs)) {
    await tryLoad(file, file, 'user', importer, loaded, errors)
  }

  // Project-local directory
  const projectDir = join(cwd, '.void', 'plugins')
  for (const file of await listPluginFiles(projectDir, fs)) {
    await tryLoad(file, file, 'project', importer, loaded, errors)
  }

  // Explicit npm/path list from settings.
  for (const spec of options.plugins ?? []) {
    await tryLoadSpec(spec, cwd, importer, loaded, errors)
  }

  return { loaded, errors }
}

async function listPluginFiles(
  dir: string,
  fs: NonNullable<LoaderOptions['fs']>,
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    let s
    try {
      s = await fs.stat(full)
    } catch {
      continue
    }
    if (s.isFile() && PLUGIN_FILE_EXTS.some(ext => name.endsWith(ext))) {
      out.push(full)
    } else if (s.isDirectory()) {
      // Directory-form plugin: load the dir's package.json main or index.
      for (const candidate of ['index.mjs', 'index.js', 'index.cjs']) {
        const p = join(full, candidate)
        try {
          const st = await fs.stat(p)
          if (st.isFile()) {
            out.push(p)
            break
          }
        } catch {
          // continue to next candidate
        }
      }
    }
  }
  return out.sort()
}

async function tryLoadSpec(
  spec: string,
  cwd: string,
  importer: NonNullable<LoaderOptions['importer']>,
  loaded: LoadedPlugin[],
  errors: LoadError[],
): Promise<void> {
  const isPath = spec.startsWith('.') || spec.startsWith('/') || isAbsolute(spec)
  if (isPath) {
    const abs = resolve(cwd, spec)
    await tryLoad(abs, abs, 'npm', importer, loaded, errors)
    return
  }
  // npm package — must match the naming conventions. Otherwise still try
  // to load it; the settings list is user-controlled.
  await tryLoad(spec, spec, 'npm', importer, loaded, errors)
}

async function tryLoad(
  id: string,
  loadedFrom: string,
  source: LoadedPlugin['source'],
  importer: NonNullable<LoaderOptions['importer']>,
  loaded: LoadedPlugin[],
  errors: LoadError[],
): Promise<void> {
  let mod: Record<string, unknown>
  try {
    // Local paths need a file URL for Windows compat. Bare specifiers pass
    // through untouched so node's resolver finds npm packages.
    const specifier = isAbsolute(loadedFrom)
      ? pathToFileURL(loadedFrom).href
      : loadedFrom
    mod = await importer(specifier)
  } catch (e) {
    errors.push({
      id,
      loadedFrom,
      source,
      error: e instanceof Error ? e : new Error(String(e)),
      reason: 'import_failed',
    })
    return
  }

  const raw = mod.default ?? mod.plugin
  if (raw === undefined || raw === null) {
    errors.push({
      id,
      loadedFrom,
      source,
      error: new Error(
        `Plugin ${id} has no default export. Did you forget ` +
          `\`export default definePlugin({ ... })\`?`,
      ),
      reason: 'missing_default_export',
    })
    return
  }

  const manifest = validateManifest(raw)
  if (manifest.ok === false) {
    errors.push({
      id,
      loadedFrom,
      source,
      error: new Error(manifest.reason),
      reason: 'invalid_manifest',
    })
    return
  }

  loaded.push({ id, loadedFrom, source, manifest: manifest.value })
}

type ValidateResult =
  | { ok: true; value: PluginManifestShape }
  | { ok: false; reason: string }

/**
 * Shallow structural validation. Rejects plainly malformed objects but
 * does not try to deep-check every tool's zod schema — the host does that
 * at tool invocation time.
 */
export function validateManifest(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Plugin default export must be an object.' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.kind !== 'plugin') {
    return {
      ok: false,
      reason:
        'Plugin default export must be the result of `definePlugin(...)` ' +
        `(missing kind: 'plugin'). Got kind=${JSON.stringify(obj.kind)}.`,
    }
  }
  const tools = obj.tools ?? []
  const skills = obj.skills ?? []
  const keybinds = obj.keybinds ?? []
  if (!Array.isArray(tools)) return { ok: false, reason: 'tools must be an array.' }
  if (!Array.isArray(skills)) return { ok: false, reason: 'skills must be an array.' }
  if (!Array.isArray(keybinds))
    return { ok: false, reason: 'keybinds must be an array.' }

  for (const t of tools) {
    if (!t || (t as { kind?: unknown }).kind !== 'tool') {
      return { ok: false, reason: `tools[] entry is not a defineTool() result.` }
    }
    const tt = t as Record<string, unknown>
    if (typeof tt.name !== 'string')
      return { ok: false, reason: `tool is missing a string name.` }
    if (typeof tt.description !== 'string')
      return { ok: false, reason: `tool ${tt.name} is missing a description.` }
    if (typeof tt.execute !== 'function')
      return { ok: false, reason: `tool ${tt.name}.execute must be a function.` }
  }
  for (const s of skills) {
    if (!s || (s as { kind?: unknown }).kind !== 'skill') {
      return { ok: false, reason: `skills[] entry is not a defineSkill() result.` }
    }
    const ss = s as Record<string, unknown>
    if (typeof ss.name !== 'string')
      return { ok: false, reason: `skill is missing a string name.` }
    if (typeof ss.handler !== 'function')
      return { ok: false, reason: `skill ${ss.name}.handler must be a function.` }
  }
  for (const k of keybinds) {
    if (!k || (k as { kind?: unknown }).kind !== 'keybind') {
      return { ok: false, reason: `keybinds[] entry is not a defineKeybind() result.` }
    }
    const kk = k as Record<string, unknown>
    if (typeof kk.key !== 'string' || !kk.key)
      return { ok: false, reason: `keybind is missing a key.` }
    if (typeof kk.action !== 'function')
      return { ok: false, reason: `keybind ${kk.key}.action must be a function.` }
  }

  return { ok: true, value: raw as PluginManifestShape }
}
