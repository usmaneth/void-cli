/**
 * `/mcp` picker — enable/disable MCP servers with live connection status.
 *
 * The caller passes in a snapshot of MCP clients (matching the existing
 * `state.mcp.clients` shape) and a `toggleServer` callback. This keeps
 * the picker decoupled from the global MCPConnectionManager so it can be
 * reused headlessly (e.g. from Voidex or tests).
 */
import * as React from 'react'
import { useMemo } from 'react'
import { Text } from '../../ink.js'
import {
  describeMcpStatus,
  toMcpRows,
  type McpClientSnapshot,
  type McpRow,
} from '../../hooks/dialogs/useMcpList.js'
import { ListDialog, type ListDialogItem } from './ListDialog.js'

type Props = {
  readonly clients: readonly McpClientSnapshot[]
  readonly toggleServer: (name: string) => void
  readonly onDone: () => void
}

type McpListItem = ListDialogItem & { readonly row: McpRow }

export function McpPickerDialog({ clients, toggleServer, onDone }: Props): React.ReactNode {
  const rows = useMemo(() => toMcpRows(clients), [clients])

  const items: readonly McpListItem[] = useMemo(
    () =>
      rows.map(r => ({
        id: r.name,
        label: r.name,
        description:
          `${describeMcpStatus(r.status)} · ${r.toolCount} tool${r.toolCount === 1 ? '' : 's'}` +
          (r.lastError ? ` · ${r.lastError.slice(0, 40)}` : ''),
        row: r,
        disabled: r.status === 'failed',
      })),
    [rows],
  )

  return (
    <ListDialog<McpListItem>
      title="MCP servers"
      subtitle="Enable / disable Model Context Protocol servers."
      items={items}
      isSelected={it => it.row.enabled}
      onToggle={it => toggleServer(it.row.name)}
      onSelect={() => onDone()}
      onCancel={onDone}
      placeholder="Filter MCP servers…"
      emptyMessage="No MCP servers configured. Add one with `/mcp add`."
      footerHint={
        <Text dimColor>
          Failed servers show their error — run `/mcp reconnect &lt;name&gt;` to retry.
        </Text>
      }
    />
  )
}
