/**
 * Stub: Claude in Chrome removed in Void CLI rebrand.
 */

export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = 'claude-in-chrome'

export function isClaudeInChromeMCPServer(_name: string): boolean {
  return false
}

export function trackClaudeInChromeTabId(_tabId: number): void {
  // no-op
}

export function isTrackedClaudeInChromeTabId(_tabId: number): boolean {
  return false
}

export async function openInChrome(_url: string): Promise<boolean> {
  return false
}
