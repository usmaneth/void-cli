/**
 * Pure MCP-list helpers. The `/mcp` picker enables/disables servers and
 * reflects their live connection status. This module deliberately does not
 * import the MCP connection manager — callers pass in the snapshot so the
 * module remains testable in isolation and reusable from Voidex.
 */

export type McpStatus =
  | 'connected'
  | 'connecting'
  | 'failed'
  | 'disabled'

export type McpRow = {
  readonly name: string
  readonly description: string
  readonly status: McpStatus
  readonly enabled: boolean
  readonly toolCount: number
  readonly lastError: string | null
}

/**
 * Mirrors the shape the MCPConnectionManager exposes (`state.mcp.clients`).
 * Only the fields we need are declared — this keeps the coupling one-way.
 */
export type McpClientSnapshot = {
  readonly name: string
  readonly type: 'connected' | 'pending' | 'failed' | 'disabled'
  readonly tools?: readonly unknown[]
  readonly error?: string | null
  readonly description?: string
}

export function toMcpRows(snapshots: readonly McpClientSnapshot[]): McpRow[] {
  const rows: McpRow[] = []
  for (const c of snapshots) {
    // The "ide" pseudo-server is an internal bridge — hide it from the
    // picker (same convention as the existing /mcp toggle command).
    if (c.name === 'ide') continue
    let status: McpStatus
    switch (c.type) {
      case 'connected':
        status = 'connected'
        break
      case 'pending':
        status = 'connecting'
        break
      case 'failed':
        status = 'failed'
        break
      case 'disabled':
        status = 'disabled'
        break
    }
    rows.push({
      name: c.name,
      description: c.description ?? '',
      status,
      enabled: status !== 'disabled',
      toolCount: c.tools?.length ?? 0,
      lastError: c.error ?? null,
    })
  }
  // Connected first, then connecting, failed, disabled. Stable sort.
  const order: Record<McpStatus, number> = {
    connected: 0,
    connecting: 1,
    failed: 2,
    disabled: 3,
  }
  return rows.sort((a, b) => order[a.status] - order[b.status])
}

export function describeMcpStatus(status: McpStatus): string {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'connecting':
      return 'connecting…'
    case 'failed':
      return 'failed'
    case 'disabled':
      return 'disabled'
  }
}
