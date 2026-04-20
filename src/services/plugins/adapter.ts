/**
 * Plugin runtime adapter.
 *
 * Bridges `LoadedPlugin[]` (from ./loader.ts, which produces typed but
 * host-agnostic manifests) into the host's live registries:
 *
 *   - plugin.tools    → host `Tool[]` (merged in tools.ts via getPluginTools)
 *   - plugin.skills   → `BundledSkillDefinition[]` (via registerBundledSkill)
 *   - plugin.keybinds → keymap entries (via getPluginKeybinds)
 *   - plugin.hooks    → PreToolUse/PostToolUse/onMessage/onSessionStart/
 *                       onSessionEnd callback dispatch
 *
 * The adapter is the *single* module that mutates host state in response to
 * loader output. Everything else in the plugin pipeline is pure: the SDK
 * defines types, the loader produces LoadedPlugin[], this file wires it in.
 *
 * Design:
 *   - One module-level registry (`state.plugins`) keyed by plugin id.
 *   - `attach()` adds a plugin to the registry, translating its artifacts
 *     via injectable translators (default: ./adapterTranslators.ts, which
 *     depends on host types; tests swap these for pure stubs).
 *   - `detach()` removes a plugin (for hot-reload / user disabling it).
 *   - Conflict handling: plugin tool names that collide with ANY built-in or
 *     previously-registered plugin tool are dropped with a warning. Skills
 *     and keybinds follow the same last-writer-loses-with-warning rule.
 *   - Hook dispatch for PreToolUse short-circuits on first cancel; other
 *     hooks are fire-and-forget (errors logged, never thrown).
 *   - Caches (`cachedTools`, `cachedSkills`, `cachedKeybinds`) invalidate on
 *     attach/detach — callers don't pay re-translation cost per read.
 *
 * Why injectable translators: the SDK->host translation touches host
 * internals (zod/v4, Tool, BundledSkillDefinition). Keeping the translators
 * injectable lets us unit-test all conflict / hook / cache logic from the
 * plugin package's test suite without dragging in the host graph.
 */

import type { LoadedPlugin, PluginManifestShape } from './loader.js'

export type PluginToolShape = NonNullable<PluginManifestShape['tools']>[number]
export type PluginSkillShape = NonNullable<
  PluginManifestShape['skills']
>[number]
export type PluginKeybindShape = NonNullable<
  PluginManifestShape['keybinds']
>[number]

/**
 * Injected translator: wraps a plugin tool into whatever shape the host
 * registry expects. Adapter treats the output opaquely — it stores it and
 * returns it via getPluginTools(). Production value lives in
 * ./adapterTranslators.ts.
 */
export type ToolTranslator<HostTool> = (tool: PluginToolShape) => HostTool

/**
 * Injected translator: wraps a plugin skill into a host BundledSkillDefinition.
 * Same opacity rule as the tool translator.
 */
export type SkillTranslator<HostSkill> = (skill: PluginSkillShape) => HostSkill

/** Plugin hook event payloads (mirror @void-cli/plugin but decoupled). */
export type PreToolUseEvent = {
  toolName: string
  input: Record<string, unknown>
  sessionId: string
}
export type PostToolUseEvent = {
  toolName: string
  input: Record<string, unknown>
  output: unknown
  isError: boolean
  sessionId: string
}
export type MessageEvent = {
  role: 'user' | 'assistant'
  text: string
  sessionId: string
}
export type SessionEvent = {
  sessionId: string
  cwd: string
}

/** Result of a PreToolUse hook. */
export type PreToolUseResult = { cancel: boolean; reason?: string }

/** Simple logger the adapter uses for warnings. Injectable for tests. */
export type AdapterLogger = {
  debug: (msg: string) => void
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

const defaultLogger: AdapterLogger = {
  // eslint-disable-next-line no-console
  debug: msg => console.debug(`[plugin-adapter] ${msg}`),
  // eslint-disable-next-line no-console
  info: msg => console.info(`[plugin-adapter] ${msg}`),
  // eslint-disable-next-line no-console
  warn: msg => console.warn(`[plugin-adapter] ${msg}`),
  // eslint-disable-next-line no-console
  error: msg => console.error(`[plugin-adapter] ${msg}`),
}

/** Registration record for a single plugin. Internal shape, not exported. */
type Registered<HostTool, HostSkill> = {
  id: string
  manifest: PluginManifestShape
  tools: HostTool[]
  skills: HostSkill[]
  keybinds: Array<{
    pluginId: string
    key: string
    label: string
    when: 'repl' | 'input' | 'global'
    action: () => void | Promise<void>
  }>
}

/**
 * Adapter instance. The module-level singleton `state` holds the production
 * adapter (pointing at the host-coupled translators). Tests may construct
 * their own instance via `createAdapter()`.
 */
export function createAdapter<HostTool, HostSkill>(options: {
  toolTranslator: ToolTranslator<HostTool>
  skillTranslator: SkillTranslator<HostSkill>
  logger?: AdapterLogger
}) {
  const s = {
    plugins: new Map<string, Registered<HostTool, HostSkill>>(),
    builtinToolNames: new Set<string>(),
    builtinSkillNames: new Set<string>(),
    cachedTools: null as HostTool[] | null,
    cachedSkills: null as HostSkill[] | null,
    cachedKeybinds: null as Registered<HostTool, HostSkill>['keybinds'] | null,
    logger: options.logger ?? defaultLogger,
    toolTranslator: options.toolTranslator,
    skillTranslator: options.skillTranslator,
  }

  function setLogger(logger: AdapterLogger): void {
    s.logger = logger
  }
  function setBuiltinToolNames(names: Iterable<string>): void {
    s.builtinToolNames = new Set(names)
  }
  function setBuiltinSkillNames(names: Iterable<string>): void {
    s.builtinSkillNames = new Set(names)
  }

  function invalidateCaches(): void {
    s.cachedTools = null
    s.cachedSkills = null
    s.cachedKeybinds = null
  }

  function attach(plugin: LoadedPlugin): AttachResult {
    if (s.plugins.has(plugin.id)) {
      s.logger.debug(`Plugin already attached: ${plugin.id}; skipping.`)
      return emptyAttachResult()
    }

    const manifest = plugin.manifest
    const skippedToolNames: string[] = []
    const skippedSkillNames: string[] = []
    const skippedKeybindKeys: string[] = []

    // Tools
    const tools: HostTool[] = []
    const seenToolNames = new Set<string>()
    for (const other of s.plugins.values()) {
      // Intentionally iterate the host-translated list to capture renamings.
      // Translators are identity-on-name for the default production one, but
      // tests may transform — we key the collision check on the post-translation
      // name by re-reading manifest.tools.
      void other
    }
    // Build seen-names from the raw manifests, not translated tools — that's
    // what the plugin author asserted as the public name.
    for (const other of s.plugins.values()) {
      for (const t of other.manifest.tools ?? []) seenToolNames.add(t.name)
    }
    for (const t of manifest.tools ?? []) {
      if (s.builtinToolNames.has(t.name)) {
        s.logger.warn(
          `Plugin ${plugin.id} tool "${t.name}" collides with a built-in ` +
            `tool; skipping. Rename the plugin tool to avoid this.`,
        )
        skippedToolNames.push(t.name)
        continue
      }
      if (seenToolNames.has(t.name)) {
        s.logger.warn(
          `Plugin ${plugin.id} tool "${t.name}" collides with an already-` +
            `loaded plugin tool; skipping.`,
        )
        skippedToolNames.push(t.name)
        continue
      }
      tools.push(s.toolTranslator(t))
      seenToolNames.add(t.name)
    }

    // Skills
    const skills: HostSkill[] = []
    const seenSkillNames = new Set<string>()
    for (const other of s.plugins.values()) {
      for (const sk of other.manifest.skills ?? [])
        seenSkillNames.add(sk.name)
    }
    for (const sk of manifest.skills ?? []) {
      if (s.builtinSkillNames.has(sk.name)) {
        s.logger.warn(
          `Plugin ${plugin.id} skill "${sk.name}" collides with a built-in ` +
            `skill; skipping.`,
        )
        skippedSkillNames.push(sk.name)
        continue
      }
      if (seenSkillNames.has(sk.name)) {
        s.logger.warn(
          `Plugin ${plugin.id} skill "${sk.name}" collides with an already-` +
            `loaded plugin skill; skipping.`,
        )
        skippedSkillNames.push(sk.name)
        continue
      }
      skills.push(s.skillTranslator(sk))
      seenSkillNames.add(sk.name)
    }

    // Keybinds
    const keybinds: Registered<HostTool, HostSkill>['keybinds'] = []
    const seenKeys = new Set<string>()
    for (const other of s.plugins.values()) {
      for (const kb of other.keybinds) seenKeys.add(kb.key)
    }
    for (const kb of manifest.keybinds ?? []) {
      if (seenKeys.has(kb.key)) {
        s.logger.warn(
          `Plugin ${plugin.id} keybind "${kb.key}" collides with an already-` +
            `loaded plugin keybind; skipping.`,
        )
        skippedKeybindKeys.push(kb.key)
        continue
      }
      keybinds.push({
        pluginId: plugin.id,
        key: kb.key,
        label: kb.label,
        when: kb.when ?? 'global',
        action: kb.action,
      })
      seenKeys.add(kb.key)
    }

    s.plugins.set(plugin.id, {
      id: plugin.id,
      manifest,
      tools,
      skills,
      keybinds,
    })
    invalidateCaches()

    s.logger.info(
      `Attached plugin ${plugin.id}: ${tools.length} tool(s), ` +
        `${skills.length} skill(s), ${keybinds.length} keybind(s)`,
    )

    return {
      toolCount: tools.length,
      skillCount: skills.length,
      keybindCount: keybinds.length,
      skippedToolNames,
      skippedSkillNames,
      skippedKeybindKeys,
    }
  }

  function detach(pluginId: string): void {
    if (!s.plugins.has(pluginId)) return
    s.plugins.delete(pluginId)
    invalidateCaches()
    s.logger.info(`Detached plugin ${pluginId}`)
  }

  function attachAll(plugins: readonly LoadedPlugin[]): AttachResult[] {
    return plugins.map(p => attach(p))
  }
  function detachAll(): void {
    for (const id of [...s.plugins.keys()]) detach(id)
  }

  function getPluginTools(): readonly HostTool[] {
    if (s.cachedTools !== null) return s.cachedTools
    const out: HostTool[] = []
    for (const entry of s.plugins.values()) out.push(...entry.tools)
    s.cachedTools = out
    return out
  }

  function getPluginSkills(): readonly HostSkill[] {
    if (s.cachedSkills !== null) return s.cachedSkills
    const out: HostSkill[] = []
    for (const entry of s.plugins.values()) out.push(...entry.skills)
    s.cachedSkills = out
    return out
  }

  function getPluginKeybinds(): readonly Registered<
    HostTool,
    HostSkill
  >['keybinds'][number][] {
    if (s.cachedKeybinds !== null) return s.cachedKeybinds
    const out: Registered<HostTool, HostSkill>['keybinds'] = []
    for (const entry of s.plugins.values()) out.push(...entry.keybinds)
    s.cachedKeybinds = out
    return out
  }

  function getAttachedPluginIds(): string[] {
    return [...s.plugins.keys()]
  }

  // --- Hook dispatch -----------------------------------------------------

  async function firePreToolUse(
    event: PreToolUseEvent,
  ): Promise<PreToolUseResult> {
    for (const entry of s.plugins.values()) {
      const hook = entry.manifest.hooks?.onPreToolUse
      if (typeof hook !== 'function') continue
      try {
        const result = await Promise.resolve(
          (hook as (e: PreToolUseEvent) => unknown)(event),
        )
        if (result === false) {
          return { cancel: true, reason: `Cancelled by plugin ${entry.id}` }
        }
        if (
          result &&
          typeof result === 'object' &&
          (result as { cancel?: unknown }).cancel === true
        ) {
          const reason =
            (result as { reason?: unknown }).reason ??
            `Cancelled by plugin ${entry.id}`
          return { cancel: true, reason: String(reason) }
        }
      } catch (err) {
        s.logger.warn(
          `Plugin ${entry.id} onPreToolUse threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
    return { cancel: false }
  }

  async function firePostToolUse(event: PostToolUseEvent): Promise<void> {
    for (const entry of s.plugins.values()) {
      const hook = entry.manifest.hooks?.onPostToolUse
      if (typeof hook !== 'function') continue
      try {
        await Promise.resolve(
          (hook as (e: PostToolUseEvent) => unknown)(event),
        )
      } catch (err) {
        s.logger.warn(
          `Plugin ${entry.id} onPostToolUse threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  async function fireMessage(event: MessageEvent): Promise<void> {
    for (const entry of s.plugins.values()) {
      const hook = entry.manifest.hooks?.onMessage
      if (typeof hook !== 'function') continue
      try {
        await Promise.resolve(
          (hook as (e: MessageEvent) => unknown)(event),
        )
      } catch (err) {
        s.logger.warn(
          `Plugin ${entry.id} onMessage threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  async function fireSessionStart(event: SessionEvent): Promise<void> {
    for (const entry of s.plugins.values()) {
      for (const hook of [
        entry.manifest.hooks?.onSessionStart,
        entry.manifest.onSessionStart,
      ]) {
        if (typeof hook !== 'function') continue
        try {
          await Promise.resolve(
            (hook as (e: SessionEvent) => unknown)(event),
          )
        } catch (err) {
          s.logger.warn(
            `Plugin ${entry.id} onSessionStart threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }
    }
  }

  async function fireSessionEnd(event: SessionEvent): Promise<void> {
    for (const entry of s.plugins.values()) {
      const hook = entry.manifest.hooks?.onSessionEnd
      if (typeof hook !== 'function') continue
      try {
        await Promise.resolve(
          (hook as (e: SessionEvent) => unknown)(event),
        )
      } catch (err) {
        s.logger.warn(
          `Plugin ${entry.id} onSessionEnd threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  async function runPluginInits(): Promise<void> {
    for (const entry of s.plugins.values()) {
      const init = entry.manifest.init
      if (typeof init !== 'function') continue
      try {
        await Promise.resolve(
          init({ id: entry.id, loadedFrom: entry.id, logger: s.logger }),
        )
      } catch (err) {
        s.logger.warn(
          `Plugin ${entry.id} init threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  /** For tests: clear all state. */
  function resetForTesting(): void {
    s.plugins.clear()
    s.builtinToolNames.clear()
    s.builtinSkillNames.clear()
    invalidateCaches()
  }

  return {
    setLogger,
    setBuiltinToolNames,
    setBuiltinSkillNames,
    attach,
    detach,
    attachAll,
    detachAll,
    getPluginTools,
    getPluginSkills,
    getPluginKeybinds,
    getAttachedPluginIds,
    firePreToolUse,
    firePostToolUse,
    fireMessage,
    fireSessionStart,
    fireSessionEnd,
    runPluginInits,
    resetForTesting,
  }
}

export type Adapter<HostTool, HostSkill> = ReturnType<
  typeof createAdapter<HostTool, HostSkill>
>

export type AttachResult = {
  toolCount: number
  skillCount: number
  keybindCount: number
  skippedToolNames: string[]
  skippedSkillNames: string[]
  skippedKeybindKeys: string[]
}

function emptyAttachResult(): AttachResult {
  return {
    toolCount: 0,
    skillCount: 0,
    keybindCount: 0,
    skippedToolNames: [],
    skippedSkillNames: [],
    skippedKeybindKeys: [],
  }
}
