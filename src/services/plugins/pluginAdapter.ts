/**
 * Production singleton plugin adapter.
 *
 * Thin module that instantiates `createAdapter()` once with the host-coupled
 * translators (./adapterTranslators.ts) and re-exports its methods. Host
 * code calls these — `getPluginTools()` from tools.ts, `firePreToolUse()`
 * from the tool-execution pipeline, etc.
 *
 * Tests for conflict / hook / caching logic use `createAdapter()` directly
 * with stub translators; they don't touch this module.
 */

import type { Tool } from '../../Tool.js'
import type { BundledSkillDefinition } from '../../skills/bundledSkills.js'
import { createAdapter } from './adapter.js'
import { skillTranslator, toolTranslator } from './adapterTranslators.js'

const adapter = createAdapter<Tool, BundledSkillDefinition>({
  toolTranslator,
  skillTranslator,
})

export const attach = adapter.attach
export const detach = adapter.detach
export const attachAll = adapter.attachAll
export const detachAll = adapter.detachAll

export const getPluginTools = adapter.getPluginTools
export const getPluginSkills = adapter.getPluginSkills
export const getPluginKeybinds = adapter.getPluginKeybinds
export const getAttachedPluginIds = adapter.getAttachedPluginIds

export const firePreToolUse = adapter.firePreToolUse
export const firePostToolUse = adapter.firePostToolUse
export const fireMessage = adapter.fireMessage
export const fireSessionStart = adapter.fireSessionStart
export const fireSessionEnd = adapter.fireSessionEnd

export const runPluginInits = adapter.runPluginInits

export const setAdapterLogger = adapter.setLogger
export const setBuiltinToolNames = adapter.setBuiltinToolNames
export const setBuiltinSkillNames = adapter.setBuiltinSkillNames

export const resetAdapterStateForTesting = adapter.resetForTesting
