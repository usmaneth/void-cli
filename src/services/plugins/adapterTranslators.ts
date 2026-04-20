/**
 * Host-coupled translators used by the production plugin adapter.
 *
 * Split out from ./adapter.ts so adapter.ts's registry / conflict / hook
 * logic can be unit-tested without importing the host module graph. The
 * production adapter in ./pluginAdapter.ts injects these translators into
 * createAdapter(). Tests inject their own stub translators.
 *
 *   - toolTranslator: wraps a plugin tool descriptor (PluginToolShape) into
 *     a host `Tool` via `buildTool`. Handles readOnly → isReadOnly/checkPermissions
 *     auto-allow, bridges zod validation, and adapts the PluginToolContext.
 *   - skillTranslator: wraps a plugin skill into a `BundledSkillDefinition`
 *     so the skill picker / SkillTool find it.
 */

import type { z } from 'zod/v4'
import { buildTool, type Tool } from '../../Tool.js'
import type { BundledSkillDefinition } from '../../skills/bundledSkills.js'
import type { PermissionResult } from '../../types/permissions.js'
import type {
  PluginSkillShape,
  PluginToolShape,
} from './adapter.js'

/**
 * Translate a plugin tool descriptor into a host `Tool`.
 *
 * readOnly semantics:
 *   - readOnly: true → isReadOnly() returns true, checkPermissions auto-allows,
 *     isConcurrencySafe returns true (read-only ops are safe to parallelize)
 *   - readOnly: false/undefined → defer to the general permission system
 *     (default behavior from buildTool → prompts the user unless a rule
 *     allows the tool)
 *
 * The plugin's zod schema validates the args at call time. We use `safeParse`
 * so a malformed model call surfaces as a string error the model can retry,
 * not an unhandled exception.
 */
export function toolTranslator(tool: PluginToolShape): Tool {
  // parameters is zod v3 or v4 depending on the plugin's dep resolution. Cast
  // to the host's zod/v4 ZodType shape — the plugin's schema does its own
  // validation at runtime, so type-level precision isn't load-bearing here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = tool.parameters as any

  return buildTool({
    name: tool.name,
    description: async () => tool.description,
    inputSchema: schema as z.ZodType<{ [key: string]: unknown }>,
    maxResultSizeChars: 100_000,
    isReadOnly: () => tool.readOnly === true,
    isConcurrencySafe: () => tool.readOnly === true,
    checkPermissions: (
      input: { [key: string]: unknown },
    ): Promise<PermissionResult> => {
      if (tool.readOnly === true) {
        return Promise.resolve({ behavior: 'allow', updatedInput: input })
      }
      // Non-readOnly: defer to the general permission system. buildTool's
      // default is allow + updatedInput, which means the permission
      // middleware (alwaysAllow/alwaysAsk rules) takes over downstream.
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    },
    async call(args, ctx) {
      let parsed: unknown = args
      if (schema && typeof schema.safeParse === 'function') {
        const result = schema.safeParse(args)
        if (!result.success) {
          throw new Error(
            `[${tool.name}] Input validation failed: ${
              result.error?.message ?? 'unknown'
            }`,
          )
        }
        parsed = result.data
      }
      const result = await tool.execute(parsed, {
        signal: ctx.abortController.signal,
        cwd: process.cwd(),
        sessionId: '',
      } as unknown as Parameters<typeof tool.execute>[1])
      const output =
        typeof result === 'string'
          ? result
          : (result as { output: string }).output
      return { data: output }
    },
    async prompt() {
      return tool.description
    },
    renderToolUseMessage: () => null,
    mapToolResultToToolResultBlockParam: (content, toolUseID) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: typeof content === 'string' ? content : String(content),
    }),
    userFacingName: () => tool.name,
    toAutoClassifierInput: () => '',
  }) as unknown as Tool
}

/**
 * Translate a plugin skill into a host BundledSkillDefinition.
 *
 * Plugin skill handlers return either a plain string or an array of text
 * blocks (matches Anthropic ContentBlockParam shape minimally). We normalize
 * to a `[{ type: 'text', text }]` array because `getPromptForCommand` must
 * produce ContentBlockParam[].
 */
export function skillTranslator(
  skill: PluginSkillShape,
): BundledSkillDefinition {
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    argumentHint: skill.argumentHint,
    userInvocable: skill.userInvocable ?? true,
    async getPromptForCommand(args, ctx) {
      const content = await skill.handler({
        args,
        cwd: process.cwd(),
        signal: ctx.abortController.signal,
      } as unknown as Parameters<typeof skill.handler>[0])
      if (typeof content === 'string') {
        return [{ type: 'text' as const, text: content }]
      }
      // content is string | Array<{type:'text', text:string}> per SDK. Array
      // elements that are plain strings get boxed into text blocks; block-
      // form elements pass through.
      return (content as unknown[]).map(block =>
        typeof block === 'string'
          ? { type: 'text' as const, text: block }
          : {
              type: 'text' as const,
              text: (block as { text: string }).text,
            },
      )
    },
  }
}
