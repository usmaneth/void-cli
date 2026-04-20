/**
 * @void-cli/plugin — Typed SDK for Void CLI plugin authors.
 *
 * Public API surface:
 *   - definePlugin  — compose tools, skills, keybinds, and hooks into a manifest
 *   - defineTool    — typed tool with zod parameters + execute handler
 *   - defineSkill   — user-invocable / model-invocable prompt skill
 *   - defineKeybind — bind a key chord to an action
 *   - onPreToolUse, onPostToolUse, onMessage, onSessionStart, onSessionEnd
 *       — typed hook callback helpers
 *
 * Everything else exported here is a type — the runtime surface is
 * intentionally tiny and stable.
 */

export const PLUGIN_SDK_VERSION = '0.1.0'

export {
  defineKeybind,
  definePlugin,
  defineSkill,
  defineTool,
} from './define.js'

export {
  onMessage,
  onPostToolUse,
  onPreToolUse,
  onSessionEnd,
  onSessionStart,
} from './hooks.js'

export type {
  DefinePluginInput,
  HookResult,
  MessageEvent,
  PluginHooks,
  PluginInitContext,
  PluginKeybind,
  PluginManifest,
  PluginSkill,
  PluginSkillContent,
  PluginSkillContext,
  PluginTool,
  PluginToolContext,
  PluginToolResult,
  PostToolUseEvent,
  PreToolUseEvent,
  SessionEvent,
} from './types.js'
