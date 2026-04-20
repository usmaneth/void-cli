/**
 * Plugin runtime boot integration.
 *
 * Called once at CLI startup (after settings load, before the REPL / SDK
 * query begins) to:
 *
 *   1. Check the VOID_PLUGINS=1 feature flag. If unset, do nothing.
 *   2. Enumerate built-in tool/skill names so the adapter can reject name
 *      collisions from plugins.
 *   3. Run the SDK loader (loader.ts) against settings.plugins.
 *   4. Attach every successfully-loaded plugin via the adapter.
 *   5. Run each plugin's `init()` exactly once.
 *
 * Keep this boot path slim. Long-running work (registering skills into the
 * bundled-skills registry, for example) happens inside `attachLoadedPlugins`
 * — the startup call just orchestrates it. That keeps tests for the boot
 * path small and lets the adapter carry the integration logic.
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import type { AdapterLogger } from './adapter.js'
import { loadPlugins, type LoadedPlugin, type LoadError } from './loader.js'

/**
 * Minimal interface the bootstrap needs from an adapter. The production
 * adapter (./pluginAdapter.ts) satisfies this; tests can pass a pure stub
 * without dragging in the host module graph.
 */
export type BootAdapter = {
  attachAll: (plugins: readonly LoadedPlugin[]) => unknown
  getPluginSkills: () => readonly unknown[]
  runPluginInits: () => Promise<void>
  setLogger?: (logger: AdapterLogger) => void
  setBuiltinToolNames?: (names: Iterable<string>) => void
  setBuiltinSkillNames?: (names: Iterable<string>) => void
}

/**
 * Minimal interface for the host skill registration. The production value is
 * `registerBundledSkill` from src/skills/bundledSkills.ts. Tests pass a
 * capturing stub.
 */
export type SkillRegistrar = (skill: unknown) => void

/**
 * Feature flag: set `VOID_PLUGINS=1` to enable the SDK plugin pipeline.
 * Defaults to OFF — the pipeline is opt-in while it stabilizes.
 */
export function isPluginRuntimeEnabled(): boolean {
  return isEnvTruthy(process.env.VOID_PLUGINS)
}

export type BootOptions = {
  /** Explicit plugin specifiers from settings.json `plugins` field. */
  plugins?: readonly string[]
  /** Built-in tool names — set so we reject plugin name collisions. */
  builtinToolNames?: Iterable<string>
  /** Built-in skill names — same purpose as builtinToolNames. */
  builtinSkillNames?: Iterable<string>
  /** Optional logger override. Defaults to a console-prefixed logger. */
  logger?: AdapterLogger
  /** Override loader injection for tests. */
  loader?: typeof loadPlugins
  /**
   * Adapter to wire plugins into. Defaults to the production singleton from
   * ./pluginAdapter.js. Tests pass a pure stub.
   */
  adapter?: BootAdapter
  /**
   * Callback that registers a plugin skill into the host's bundled-skills
   * registry. Defaults to `registerBundledSkill` from src/skills/bundledSkills.
   * Tests pass a capturing stub.
   */
  registerSkill?: SkillRegistrar
}

export type BootResult = {
  enabled: boolean
  loaded: LoadedPlugin[]
  loadErrors: LoadError[]
  attachedIds: string[]
  /** Names of plugin skills actually added to the bundled-skills registry. */
  registeredSkillNames: string[]
}

/**
 * Boot the plugin runtime. Safe to call even when disabled — returns early
 * with `enabled: false`. Never throws: plugin load failures are captured in
 * `loadErrors`.
 */
export async function bootPluginRuntime(
  options: BootOptions = {},
): Promise<BootResult> {
  if (!isPluginRuntimeEnabled()) {
    return {
      enabled: false,
      loaded: [],
      loadErrors: [],
      attachedIds: [],
      registeredSkillNames: [],
    }
  }

  // Resolve adapter + skill registrar. Lazy-import the production defaults
  // so this module stays test-friendly (the production defaults pull in the
  // host module graph via adapterTranslators → Tool.ts → bootstrap/state).
  const adapter: BootAdapter =
    options.adapter ?? (await import('./pluginAdapter.js'))
  const registerSkill: SkillRegistrar =
    options.registerSkill ??
    ((await import('../../skills/bundledSkills.js')).registerBundledSkill as SkillRegistrar)

  if (options.logger && adapter.setLogger) adapter.setLogger(options.logger)
  if (options.builtinToolNames && adapter.setBuiltinToolNames) {
    adapter.setBuiltinToolNames(options.builtinToolNames)
  }
  if (options.builtinSkillNames && adapter.setBuiltinSkillNames) {
    adapter.setBuiltinSkillNames(options.builtinSkillNames)
  }

  const loader = options.loader ?? loadPlugins
  const { loaded, errors } = await loader({ plugins: options.plugins })

  // Surface load errors prominently but continue booting — one bad plugin
  // shouldn't block the session. Users see these in debug logs; managed
  // consoles may pipe debug to Sentry/Honeycomb.
  for (const err of errors) {
    // Use the injected logger when available; fall back to the host's
    // logForDebugging in production paths.
    const msg = `[plugin-runtime] Failed to load ${err.id} (${err.reason}): ${err.error.message}`
    if (options.logger) options.logger.warn(msg)
    else {
      const { logForDebugging } = await import('../../utils/debug.js')
      logForDebugging(msg)
    }
  }

  adapter.attachAll(loaded)

  // Register plugin skills into the host's bundled-skills registry so the
  // skill picker / SkillTool can find them without knowing plugins exist.
  const registeredSkillNames: string[] = []
  for (const skill of adapter.getPluginSkills()) {
    const skillName = (skill as { name?: string }).name
    try {
      registerSkill(skill)
      if (skillName) registeredSkillNames.push(skillName)
    } catch (err) {
      const msg = `[plugin-runtime] Failed to register skill ${String(skillName)}: ${
        err instanceof Error ? err.message : String(err)
      }`
      if (options.logger) options.logger.warn(msg)
    }
  }

  await adapter.runPluginInits()

  return {
    enabled: true,
    loaded,
    loadErrors: errors,
    attachedIds: loaded.map(p => p.id),
    registeredSkillNames,
  }
}
