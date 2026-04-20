/**
 * Typed event hook helpers.
 *
 * These are pure identity functions with strong types — the purpose is to
 * let plugin authors write standalone hook callbacks outside a plugin's
 * `hooks` block and still get the same type-checking. The host loader
 * accepts either a PluginManifest with a `hooks` object, or individually
 * exported hook callbacks discovered by naming convention.
 */

import type {
  HookResult,
  MessageEvent,
  PluginHooks,
  PostToolUseEvent,
  PreToolUseEvent,
  SessionEvent,
} from './types.js'

/**
 * Type-only identity helper for a PreToolUse hook.
 *
 * @example
 * ```ts
 * export const logBeforeBash = onPreToolUse(async event => {
 *   if (event.toolName === 'Bash') console.log('bash:', event.input)
 * })
 * ```
 */
export function onPreToolUse(
  fn: (event: PreToolUseEvent) => HookResult | Promise<HookResult>,
): NonNullable<PluginHooks['onPreToolUse']> {
  return fn
}

export function onPostToolUse(
  fn: (event: PostToolUseEvent) => void | Promise<void>,
): NonNullable<PluginHooks['onPostToolUse']> {
  return fn
}

export function onMessage(
  fn: (event: MessageEvent) => void | Promise<void>,
): NonNullable<PluginHooks['onMessage']> {
  return fn
}

export function onSessionStart(
  fn: (event: SessionEvent) => void | Promise<void>,
): NonNullable<PluginHooks['onSessionStart']> {
  return fn
}

export function onSessionEnd(
  fn: (event: SessionEvent) => void | Promise<void>,
): NonNullable<PluginHooks['onSessionEnd']> {
  return fn
}
