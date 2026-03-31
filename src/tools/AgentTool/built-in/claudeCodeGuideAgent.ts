/**
 * Stub: Void Guide agent removed in Void CLI rebrand.
 */

import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

export const VOID_GUIDE_AGENT_TYPE = 'claude-code-guide'

export const VOID_GUIDE_AGENT: BuiltInAgentDefinition = {
  type: VOID_GUIDE_AGENT_TYPE,
  name: 'Void CLI Guide',
  description: 'Guide agent (disabled)',
  prompt: '',
  allowedTools: [],
  isEnabled: () => false,
} as unknown as BuiltInAgentDefinition
