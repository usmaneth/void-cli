/**
 * Stub: Claude.ai MCP proxy removed in Void CLI rebrand.
 * No-op exports retained to avoid breaking dependents.
 */

import type { ScopedMcpServerConfig } from './types.js'

export const fetchClaudeAIMcpConfigsIfEligible = async (): Promise<
  Record<string, ScopedMcpServerConfig>
> => ({})

export function clearClaudeAIMcpConfigsCache(): void {
  // no-op
}

export function markClaudeAiMcpConnected(_name: string): void {
  // no-op
}

export function hasClaudeAiMcpEverConnected(_name: string): boolean {
  return false
}

export function dedupClaudeAiMcpServers(
  _claudeaiConfigs: Record<string, ScopedMcpServerConfig>,
  _nonPluginConfigs: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  return { servers: {}, suppressed: [] }
}
