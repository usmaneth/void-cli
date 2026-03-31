/**
 * Stub: Claude Code Guide agent removed in Void CLI rebrand.
 */

import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

export const CLAUDE_CODE_GUIDE_AGENT_TYPE = 'claude-code-guide'

export const CLAUDE_CODE_GUIDE_AGENT: BuiltInAgentDefinition = {
  type: CLAUDE_CODE_GUIDE_AGENT_TYPE,
  name: 'Void CLI Guide',
  description: 'Guide agent (disabled)',
  prompt: '',
  allowedTools: [],
  isEnabled: () => false,
} as unknown as BuiltInAgentDefinition
