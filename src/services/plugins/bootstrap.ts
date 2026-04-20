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
import { logForDebugging } from '../../utils/debug.js'
import { registerBundledSkill } from '../../skills/bundledSkills.js'
import type { AdapterLogger } from './adapter.js'
import {
  attachAll,
  getPluginSkills,
  runPluginInits,
  setAdapterLogger,
  setBuiltinSkillNames,
  setBuiltinToolNames,
} from './pluginAdapter.js'
import { loadPlugins, type LoadedPlugin, type LoadError } from './loader.js'

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
  /** Callback to register a skill into the host's bundled-skills registry.
   * Tests override to capture what would've been registered. */
  registerSkill?: typeof registerBundledSkill
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

  if (options.logger) setAdapterLogger(options.logger)
  if (options.builtinToolNames) setBuiltinToolNames(options.builtinToolNames)
  if (options.builtinSkillNames) setBuiltinSkillNames(options.builtinSkillNames)

  const loader = options.loader ?? loadPlugins
  const { loaded, errors } = await loader({ plugins: options.plugins })

  // Surface load errors prominently but continue booting — one bad plugin
  // shouldn't block the session. Users see these in debug logs; managed
  // consoles may pipe debug to Sentry/Honeycomb.
  for (const err of errors) {
    logForDebugging(
      `[plugin-runtime] Failed to load ${err.id} (${err.reason}): ${err.error.message}`,
    )
  }

  attachAll(loaded)

  // Register plugin skills into the host's bundled-skills registry so the
  // skill picker / SkillTool can find them without knowing plugins exist.
  const registerSkill = options.registerSkill ?? registerBundledSkill
  const registeredSkillNames: string[] = []
  for (const skill of getPluginSkills()) {
    try {
      registerSkill(skill)
      registeredSkillNames.push(skill.name)
    } catch (err) {
      logForDebugging(
        `[plugin-runtime] Failed to register skill ${skill.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  await runPluginInits()

  return {
    enabled: true,
    loaded,
    loadErrors: errors,
    attachedIds: loaded.map(p => p.id),
    registeredSkillNames,
  }
}
