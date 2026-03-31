/**
 * Stub: Void in Chrome removed in Void CLI rebrand.
 */

export function shouldEnableClaudeInChrome(_chromeFlag?: boolean): boolean {
  return false
}

export function shouldAutoEnableClaudeInChrome(): boolean {
  return false
}

export function setupClaudeInChrome(): {
  mcpServerConfigs: Record<string, unknown>
  mcpServerName: string
} {
  return { mcpServerConfigs: {}, mcpServerName: '' }
}

export async function isChromeExtensionInstalled(): Promise<boolean> {
  return false
}
