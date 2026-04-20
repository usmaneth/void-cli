/**
 * `/model` picker — searchable list of available models. Consumes the
 * reusable `ListDialog` and the same model catalog surface used
 * elsewhere (`getModelOptions`).
 *
 * Picker-only concerns live here; writing the selection back to settings
 * is the caller's job (kept out of this component so Voidex can reuse).
 */
import * as React from 'react'
import { useEffect, useState } from 'react'
import { ListDialog, type ListDialogItem } from './ListDialog.js'

export type ModelEntry = {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly provider?: string
}

type Props = {
  readonly initial?: string | null
  readonly loadModels: () => Promise<readonly ModelEntry[]> | readonly ModelEntry[]
  readonly onSelect: (modelId: string) => void
  readonly onCancel: () => void
}

export function ModelPickerDialog({
  initial,
  loadModels,
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  const [items, setItems] = useState<readonly ListDialogItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const models = await loadModels()
      if (cancelled) return
      const mapped: ListDialogItem[] = models.map(m => ({
        id: m.id,
        label: m.label,
        description: m.description,
        searchText: m.provider ? [m.provider] : undefined,
      }))
      setItems(mapped)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadModels])

  return (
    <ListDialog
      title="Select model"
      subtitle={loading ? 'Loading models…' : initial ? `Current: ${initial}` : undefined}
      items={items}
      onSelect={item => onSelect(item.id)}
      onCancel={onCancel}
      placeholder="Search models by name, provider, or alias…"
      emptyMessage={loading ? 'Loading…' : 'No matching models'}
    />
  )
}
