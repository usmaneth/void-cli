/**
 * Wires the layered instructions loader into the settings system and the
 * base system prompt.
 *
 * Responsibilities:
 *   - Pull per-source settings (user, project, local) from the settings
 *     module so each layer's file paths resolve relative to the right root.
 *   - Call `loadLayeredInstructions` and format the merged block.
 *   - Log which layers contributed (name + entry count only; no paths).
 */

import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

import {
  formatInstructionsBlock,
  loadLayeredInstructions,
  type LoadedInstructions,
} from './loader.js'

/**
 * Load the layered instructions for the current session. Callers that want
 * the formatted string should use `getMergedInstructionsPrompt()` instead.
 */
export function loadSessionInstructions(): LoadedInstructions {
  const warnings: string[] = []
  const loaded = loadLayeredInstructions({
    userLayer: {
      rootDir: getClaudeConfigHomeDir(),
      settings: getSettingsForSource('userSettings'),
    },
    workspaceLayer: {
      rootDir: getCwd(),
      settings: getSettingsForSource('projectSettings'),
    },
    localLayer: {
      rootDir: getCwd(),
      settings: getSettingsForSource('localSettings'),
    },
    onWarn: msg => warnings.push(msg),
  })

  // Surface warnings and the per-layer contribution summary via the debug
  // logger. We deliberately do NOT include resolved file paths — only the
  // layer name and entry count. Missing-file warnings already use the
  // basename (not absolute path).
  if (loaded.contributingLayers.length > 0) {
    const summary = loaded.contributingLayers
      .map(l => `${l}=${loaded.layerCounts[l]}`)
      .join(', ')
    logForDebugging(`[instructions] layers contributed: ${summary}`)
  } else {
    logForDebugging('[instructions] no layers contributed')
  }
  for (const w of warnings) logForDebugging(`[instructions] ${w}`)

  return loaded
}

/**
 * Return the merged instruction block, ready to append to the base system
 * prompt, or `null` if no layer contributed anything.
 */
export function getMergedInstructionsPrompt(): string | null {
  const loaded = loadSessionInstructions()
  return formatInstructionsBlock(loaded)
}
