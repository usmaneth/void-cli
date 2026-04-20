/**
 * Lightweight event bus for MCP resource lifecycle notifications.
 *
 * Fires `mcp.resources.changed` when a connected server's resource list is
 * refreshed in response to a `resources/list_changed` notification or when
 * allowlist filtering invalidates the cache. Listeners can use this to
 * re-inject resource URIs into a running agent's context between turns.
 *
 * Intentionally a plain Node EventEmitter rather than the Ink-aware bus under
 * `src/ink/events/emitter.ts` — callers here are non-UI (client.ts, connection
 * manager, system prompt builder) and should not depend on Ink internals.
 */
import { EventEmitter } from 'events'
import type { ServerResource } from './types.js'

export type McpResourcesChangedEvent = {
  server: string
  resources: ServerResource[]
  /** When true, the server dropped its resources (list is empty intentionally). */
  cleared?: boolean
}

export const MCP_RESOURCES_CHANGED_EVENT = 'mcp.resources.changed'

// Module-level singleton — matches how the rest of the MCP layer treats
// connection state (memoized caches on module scope). Listeners are registered
// from the React effect layer (useManageMCPConnections) and from CLI
// entrypoints, neither of which have a cleaner place to put this.
export const mcpResourcesEmitter = new EventEmitter()

// Node default is 10 listeners. Every connected MCP server that subscribes
// for live updates, plus any agent tool context that wants to listen, pushes
// us past that limit — so bump to a practical ceiling.
mcpResourcesEmitter.setMaxListeners(100)

export function emitMcpResourcesChanged(
  event: McpResourcesChangedEvent,
): void {
  mcpResourcesEmitter.emit(MCP_RESOURCES_CHANGED_EVENT, event)
}

export function onMcpResourcesChanged(
  listener: (event: McpResourcesChangedEvent) => void,
): () => void {
  mcpResourcesEmitter.on(MCP_RESOURCES_CHANGED_EVENT, listener)
  return () => {
    mcpResourcesEmitter.off(MCP_RESOURCES_CHANGED_EVENT, listener)
  }
}
