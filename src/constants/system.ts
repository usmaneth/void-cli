// Critical system constants extracted to break circular dependencies

function feature(_name: string): boolean { return false }
import { logForDebugging } from '../utils/debug.js'
import { getWorkload } from '../utils/workloadContext.js'

const DEFAULT_PREFIX = `You are Void, an infinite dev agent.`
const AGENT_SDK_VOID_PRESET_PREFIX = `You are Void, an infinite dev agent, running within the Void Agent SDK.`
const AGENT_SDK_PREFIX = `You are a Void agent, built on the Void Agent SDK.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_VOID_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_VOID_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

/**
 * Get attribution header for API requests.
 * Returns empty string — attribution disabled for Void.
 */
export function getAttributionHeader(_fingerprint: string): string {
  return ''
}
