/**
 * Author-facing factory functions.
 *
 * These helpers are intentionally thin: they brand input objects with a
 * discriminator (`kind`) so the host loader can classify exports at runtime,
 * and they apply light validation so authoring mistakes surface early.
 *
 * No schema work is done here. Validation of arguments against the zod
 * schema happens at tool invocation time inside the host — we don't want
 * to duplicate that logic on the author side.
 */

import type { z } from 'zod'
import type {
  DefinePluginInput,
  PluginHooks,
  PluginKeybind,
  PluginManifest,
  PluginSkill,
  PluginSkillContent,
  PluginSkillContext,
  PluginTool,
  PluginToolContext,
  PluginToolResult,
} from './types.js'

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

function assertToolName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `[@void-cli/plugin] Invalid tool name: ${JSON.stringify(name)}. ` +
        `Tool names must match /^[A-Za-z_][A-Za-z0-9_-]*$/.`,
    )
  }
}

function assertSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `[@void-cli/plugin] Invalid skill name: ${JSON.stringify(name)}. ` +
        `Skill names must be lowercase, hyphenated, and start with a letter.`,
    )
  }
}

/**
 * Define a tool. Returns a frozen tool descriptor the host can register.
 *
 * @example
 * ```ts
 * import { defineTool, z } from '@void-cli/plugin'
 *
 * export const hello = defineTool({
 *   name: 'Hello',
 *   description: 'Say hello to someone.',
 *   parameters: z.object({ who: z.string() }),
 *   async execute({ who }) {
 *     return `Hello, ${who}!`
 *   },
 * })
 * ```
 */
export function defineTool<TSchema extends z.ZodTypeAny>(input: {
  name: string
  description: string
  parameters: TSchema
  execute(
    args: z.infer<TSchema>,
    context: PluginToolContext,
  ): Promise<PluginToolResult> | PluginToolResult
  readOnly?: boolean
}): PluginTool<TSchema> {
  assertToolName(input.name)
  if (!input.description || !input.description.trim()) {
    throw new Error(
      `[@void-cli/plugin] Tool ${input.name}: description is required.`,
    )
  }
  if (typeof input.execute !== 'function') {
    throw new Error(
      `[@void-cli/plugin] Tool ${input.name}: execute must be a function.`,
    )
  }
  return Object.freeze({
    kind: 'tool' as const,
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    execute: input.execute,
    readOnly: input.readOnly,
  })
}

/**
 * Define a skill. Skills produce prompt content that feeds into the model.
 *
 * @example
 * ```ts
 * export const standup = defineSkill({
 *   name: 'standup',
 *   description: 'Draft a daily standup update.',
 *   async handler({ args }) {
 *     return `Write a standup update for today. Extra context: ${args}`
 *   },
 * })
 * ```
 */
export function defineSkill(input: {
  name: string
  description: string
  whenToUse?: string
  aliases?: readonly string[]
  argumentHint?: string
  userInvocable?: boolean
  handler(
    context: PluginSkillContext,
  ): Promise<PluginSkillContent> | PluginSkillContent
}): PluginSkill {
  assertSkillName(input.name)
  if (!input.description || !input.description.trim()) {
    throw new Error(
      `[@void-cli/plugin] Skill ${input.name}: description is required.`,
    )
  }
  if (typeof input.handler !== 'function') {
    throw new Error(
      `[@void-cli/plugin] Skill ${input.name}: handler must be a function.`,
    )
  }
  if (input.aliases) {
    for (const alias of input.aliases) assertSkillName(alias)
  }
  return Object.freeze({
    kind: 'skill' as const,
    name: input.name,
    description: input.description,
    whenToUse: input.whenToUse,
    aliases: input.aliases ? Object.freeze([...input.aliases]) : undefined,
    argumentHint: input.argumentHint,
    userInvocable: input.userInvocable,
    handler: input.handler,
  })
}

/**
 * Define a keybind. The host registers the key chord at plugin load time
 * and invokes `action` when the user presses the key.
 *
 * @example
 * ```ts
 * export const clearBind = defineKeybind({
 *   key: 'ctrl+shift+c',
 *   label: 'Clear transcript',
 *   when: 'repl',
 *   action() {
 *     console.clear()
 *   },
 * })
 * ```
 */
export function defineKeybind(spec: {
  key: string
  label: string
  when?: 'repl' | 'input' | 'global'
  action(): void | Promise<void>
}): PluginKeybind {
  if (!spec.key || !spec.key.trim()) {
    throw new Error(`[@void-cli/plugin] Keybind: key is required.`)
  }
  if (!spec.label || !spec.label.trim()) {
    throw new Error(`[@void-cli/plugin] Keybind ${spec.key}: label is required.`)
  }
  if (typeof spec.action !== 'function') {
    throw new Error(
      `[@void-cli/plugin] Keybind ${spec.key}: action must be a function.`,
    )
  }
  return Object.freeze({
    kind: 'keybind' as const,
    key: spec.key,
    label: spec.label,
    when: spec.when,
    action: spec.action,
  })
}

/**
 * Define a plugin manifest. This is the canonical value to default-export
 * from a plugin entry module.
 *
 * @example
 * ```ts
 * import { definePlugin, defineTool, defineSkill, z } from '@void-cli/plugin'
 *
 * const sayHi = defineTool({ ... })
 * const greet = defineSkill({ ... })
 *
 * export default definePlugin({
 *   name: 'hello-void',
 *   version: '0.1.0',
 *   tools: [sayHi],
 *   skills: [greet],
 *   hooks: {
 *     onSessionStart({ sessionId }) {
 *       console.log('session:', sessionId)
 *     },
 *   },
 * })
 * ```
 */
export function definePlugin(input: DefinePluginInput = {}): PluginManifest {
  const tools = freezeAll(input.tools, 'tool')
  const skills = freezeAll(input.skills, 'skill')
  const keybinds = freezeAll(input.keybinds, 'keybind')
  const hooks: PluginHooks = input.hooks ? { ...input.hooks } : {}

  // Detect duplicate tool / skill / keybind names within the same plugin.
  assertUnique(tools, 'tool')
  assertUnique(skills, 'skill')
  assertUnique(
    keybinds.map(k => ({ name: `${k.when ?? 'global'}:${k.key}` })),
    'keybind',
  )

  return Object.freeze({
    kind: 'plugin' as const,
    name: input.name,
    version: input.version,
    tools,
    skills,
    keybinds,
    hooks,
    init: input.init,
    onSessionStart: input.onSessionStart,
  })
}

function freezeAll<T extends { kind: string }>(
  xs: readonly T[] | undefined,
  expectedKind: string,
): readonly T[] {
  if (!xs) return Object.freeze([])
  for (const x of xs) {
    if (!x || x.kind !== expectedKind) {
      throw new Error(
        `[@void-cli/plugin] definePlugin: expected a ${expectedKind} ` +
          `descriptor (use define${capitalize(expectedKind)}()), got: ${describe(x)}.`,
      )
    }
  }
  return Object.freeze([...xs])
}

function assertUnique<T extends { name: string }>(xs: readonly T[], kind: string) {
  const seen = new Set<string>()
  for (const x of xs) {
    if (seen.has(x.name)) {
      throw new Error(
        `[@void-cli/plugin] definePlugin: duplicate ${kind} name ` +
          `${JSON.stringify(x.name)}.`,
      )
    }
    seen.add(x.name)
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function describe(x: unknown): string {
  if (x === null || x === undefined) return String(x)
  if (typeof x === 'object' && 'kind' in (x as object)) {
    return `{ kind: ${JSON.stringify((x as { kind: unknown }).kind)} }`
  }
  return typeof x
}
