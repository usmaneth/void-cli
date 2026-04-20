/**
 * Core types exposed to plugin authors.
 *
 * These are intentionally decoupled from the Void CLI internal `Tool` type
 * (src/Tool.ts) — that type has 30+ fields most of which are host-only UI
 * concerns (renderToolUseMessage, checkPermissions, etc.). Plugin authors
 * should not have to reason about them. The host loader adapts a
 * `PluginTool` into a full internal `Tool` with safe defaults.
 */

import type { z } from 'zod'

/**
 * A lightweight context passed to plugin tool `execute` handlers.
 * Intentionally narrow — we only expose what third-party code reasonably
 * needs. The host may supply an internal richer context under the hood.
 */
export interface PluginToolContext {
  /** Abort signal propagated from the user cancelling a turn. */
  readonly signal: AbortSignal
  /** Absolute path to the current working directory for this session. */
  readonly cwd: string
  /** Stable session identifier (scoped to the Void CLI instance). */
  readonly sessionId: string
  /**
   * Optional progress callback. Calling it streams a short status message
   * to the UI while the tool runs. No-op if the host chooses not to render.
   */
  progress?: (message: string) => void
}

/**
 * Result shape returned by a plugin tool's `execute` function.
 *
 * The string form is a convenience: `return 'ok'` is equivalent to
 * `return { output: 'ok' }`.
 */
export type PluginToolResult =
  | string
  | {
      /** Human-readable text output surfaced to the model. */
      output: string
      /** Optional structured metadata for SDK consumers / logs. */
      metadata?: Record<string, unknown>
    }

/**
 * A tool definition produced by `defineTool`. Consumed by the host loader.
 *
 * Using `z.ZodTypeAny` keeps the call site ergonomic while still tracking
 * the inferred input type through the `execute` callback.
 */
export interface PluginTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly kind: 'tool'
  /** Unique tool name. Must be a valid identifier: /^[A-Za-z_][A-Za-z0-9_-]*$/ */
  readonly name: string
  /** One-paragraph description shown to the model. */
  readonly description: string
  /** Zod schema defining the tool's input. Should be an object schema. */
  readonly parameters: TSchema
  /**
   * Execution callback. Receives the validated args and a context object.
   * Return a string (rendered verbatim) or a structured result.
   */
  execute(
    args: z.infer<TSchema>,
    context: PluginToolContext,
  ): Promise<PluginToolResult> | PluginToolResult
  /**
   * Optional. When true, the tool does not modify host state (read-only).
   * Hosts may use this to skip permission prompts for trusted plugins.
   */
  readonly readOnly?: boolean
}

/**
 * Context passed to skill handlers. Skills return text content that is
 * surfaced to the model as a prompt.
 */
export interface PluginSkillContext {
  /** Free-form arguments from the user, e.g. from `/my-skill arg text`. */
  readonly args: string
  /** Absolute path to the current working directory for this session. */
  readonly cwd: string
  readonly signal: AbortSignal
}

/**
 * Text content blocks returned by a skill. Compatible with Anthropic's
 * ContentBlockParam text shape, but intentionally kept minimal so the
 * plugin SDK has no SDK-level dependency.
 */
export type PluginSkillContent =
  | string
  | Array<{ type: 'text'; text: string }>

/**
 * A skill definition produced by `defineSkill`.
 */
export interface PluginSkill {
  readonly kind: 'skill'
  /** Skill slug. Lowercase, hyphenated. Invoked as `/<name>`. */
  readonly name: string
  /** Short description surfaced in the skill picker. */
  readonly description: string
  /** Optional long-form "when to use" hint for the model. */
  readonly whenToUse?: string
  /** Optional aliases — alternate invocation names. */
  readonly aliases?: readonly string[]
  /** Optional hint for the user on how to supply args. */
  readonly argumentHint?: string
  /** Whether the user can type `/<name>` directly. Defaults to true. */
  readonly userInvocable?: boolean
  /** Handler that returns prompt content. */
  handler(
    context: PluginSkillContext,
  ): Promise<PluginSkillContent> | PluginSkillContent
}

/**
 * A keybind specification. The host registers keybinds into its keymap at
 * plugin load time. When the key chord fires, the `action` callback runs.
 *
 * Key format: space-separated modifiers + key, e.g. `"ctrl+k"`, `"alt+p"`,
 * `"shift+enter"`. The host normalizes and validates.
 */
export interface PluginKeybind {
  readonly kind: 'keybind'
  readonly key: string
  /** Short label for in-app help surfaces. */
  readonly label: string
  /** Optional context — limits the keybind to a specific UI mode. */
  readonly when?: 'repl' | 'input' | 'global'
  /** Callback invoked when the key fires. */
  action(): void | Promise<void>
}

/**
 * Event payloads for plugin hooks. Kept minimal — hosts may pass richer
 * data internally, but this is the public contract.
 */
export interface PreToolUseEvent {
  readonly toolName: string
  readonly input: Record<string, unknown>
  readonly sessionId: string
}

export interface PostToolUseEvent {
  readonly toolName: string
  readonly input: Record<string, unknown>
  readonly output: unknown
  readonly isError: boolean
  readonly sessionId: string
}

export interface MessageEvent {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly sessionId: string
}

export interface SessionEvent {
  readonly sessionId: string
  readonly cwd: string
}

/**
 * Typed event hook callback type.
 *
 * Hooks may return `void`, a boolean, or an object. Returning `false` from
 * `onPreToolUse` cancels the tool call (host enforces). Other return values
 * are advisory and host-specific.
 */
export type HookResult = void | boolean | { cancel?: boolean; reason?: string }

export interface PluginHooks {
  onPreToolUse?: (event: PreToolUseEvent) => HookResult | Promise<HookResult>
  onPostToolUse?: (event: PostToolUseEvent) => void | Promise<void>
  onMessage?: (event: MessageEvent) => void | Promise<void>
  onSessionStart?: (event: SessionEvent) => void | Promise<void>
  onSessionEnd?: (event: SessionEvent) => void | Promise<void>
}

/**
 * Context passed to `definePlugin`'s `init` callback. Gives plugin authors
 * a controlled view of the host at load time.
 */
export interface PluginInitContext {
  /** Loader-assigned plugin id (usually the package name or file path). */
  readonly id: string
  /** Absolute path where the plugin was loaded from. */
  readonly loadedFrom: string
  /** Structured logger the plugin can use. */
  readonly logger: {
    debug: (msg: string) => void
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
}

/**
 * The fully-assembled plugin manifest returned by `definePlugin`.
 * This is the value a plugin module should default-export.
 */
export interface PluginManifest {
  readonly kind: 'plugin'
  readonly name?: string
  readonly version?: string
  readonly tools: readonly PluginTool[]
  readonly skills: readonly PluginSkill[]
  readonly keybinds: readonly PluginKeybind[]
  readonly hooks: PluginHooks
  init?: (context: PluginInitContext) => void | Promise<void>
  onSessionStart?: (event: SessionEvent) => void | Promise<void>
}

/**
 * Input accepted by `definePlugin`. All fields are optional — a plugin may
 * contribute only hooks, or only a single tool, etc.
 */
export interface DefinePluginInput {
  name?: string
  version?: string
  tools?: readonly PluginTool[]
  skills?: readonly PluginSkill[]
  keybinds?: readonly PluginKeybind[]
  hooks?: PluginHooks
  init?: (context: PluginInitContext) => void | Promise<void>
  onSessionStart?: (event: SessionEvent) => void | Promise<void>
}
