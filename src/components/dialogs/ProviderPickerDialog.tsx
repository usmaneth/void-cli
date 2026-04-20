/**
 * `/provider` picker — toggle which providers Void considers when routing
 * a request. Reuses `ListDialog` with a toggle handler; status is shown
 * inline so users can see at a glance which providers are missing keys.
 */
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Text } from '../../ink.js'
import {
  computeProviderRows,
  describeStatus,
  toggleProvider,
  type ProviderId,
  type ProviderRow,
} from '../../hooks/dialogs/useProviderList.js'
import { ListDialog, type ListDialogItem } from './ListDialog.js'

type Props = {
  readonly initialEnabled?: Readonly<Partial<Record<ProviderId, boolean>>>
  readonly oauthProbe?: (provider: ProviderId) => boolean
  readonly onCommit: (rows: readonly ProviderRow[]) => void
  readonly onCancel: () => void
}

type ProviderListItem = ListDialogItem & { readonly row: ProviderRow }

export function ProviderPickerDialog({
  initialEnabled,
  oauthProbe,
  onCommit,
  onCancel,
}: Props): React.ReactNode {
  const [rows, setRows] = useState<ProviderRow[]>(() =>
    computeProviderRows(initialEnabled, oauthProbe),
  )

  // Recompute periodically — keychain / env var state can change mid-session.
  useEffect(() => {
    const iv = setInterval(() => {
      setRows(prev =>
        computeProviderRows(
          Object.fromEntries(prev.map(r => [r.id, r.enabled])) as Partial<Record<ProviderId, boolean>>,
          oauthProbe,
        ),
      )
    }, 3_000)
    return () => clearInterval(iv)
  }, [oauthProbe])

  const items: readonly ProviderListItem[] = useMemo(
    () =>
      rows.map(r => ({
        id: r.id,
        label: r.label,
        description: `${r.description}  ·  ${describeStatus(r.status)}`,
        row: r,
        disabled: r.status === 'missing-key',
      })),
    [rows],
  )

  return (
    <ListDialog<ProviderListItem>
      title="Providers"
      subtitle="Toggle which providers Void uses for routing."
      items={items}
      isSelected={it => it.row.enabled}
      onToggle={it => setRows(prev => toggleProvider(prev, it.row.id))}
      onSelect={() => onCommit(rows)}
      onCancel={onCancel}
      placeholder="Filter providers…"
      footerHint={
        <Text dimColor>Missing keys? Run `/provider add &lt;name&gt; &lt;key&gt;` outside this dialog.</Text>
      }
    />
  )
}
