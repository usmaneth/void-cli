/**
 * `/sessions` dialog — full-screen list of saved sessions with live fuzzy
 * search over title + summary + first message. Debounced at 150ms so
 * typing-while-searching doesn't re-rank on every keystroke.
 *
 *   Enter            resume the focused session
 *   Shift+Enter      fork it (creates a new session tagged parent:<id>)
 *   Ctrl+D           delete (shows an inline confirmation row)
 *
 * The ranking / loading / fork helpers live in
 * `src/hooks/dialogs/useSessionList.ts` — keep this file focused on the
 * render layer so Voidex can ship the exact same UX without importing
 * Ink.
 */
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text } from '../../ink.js'
import type { Key } from '../../ink.js'
import {
  formatLastActivity,
  rankSessions,
  type SessionRow,
} from '../../hooks/dialogs/useSessionList.js'
import { makeDebouncer } from '../../utils/fuzzy/index.js'
import { ListDialog, type ListDialogItem } from './ListDialog.js'

type Props = {
  readonly rows: readonly SessionRow[]
  readonly onResume: (row: SessionRow) => void
  readonly onFork: (row: SessionRow) => void
  readonly onDelete: (row: SessionRow) => void
  readonly onCancel: () => void
  readonly debounceMs?: number
}

type SessionListItem = ListDialogItem & { readonly row: SessionRow }

export function SessionListDialog({
  rows,
  onResume,
  onFork,
  onDelete,
  onCancel,
  debounceMs = 150,
}: Props): React.ReactNode {
  const [rawQuery, setRawQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const debouncer = useRef(
    makeDebouncer<[string]>(q => setDebouncedQuery(q), debounceMs),
  )
  useEffect(() => () => debouncer.current.cancel(), [])

  const items: readonly SessionListItem[] = useMemo(
    () =>
      rows.map(row => ({
        id: row.id,
        label: row.title || '(untitled)',
        description: row.summary || row.firstMessage || '',
        row,
      })),
    [rows],
  )

  const rankFn = useMemo(
    () =>
      (input: readonly SessionListItem[], _query: string) => {
        // ListDialog passes its own live query — we ignore it and use the
        // debounced one so fuzzy work happens at most every 150ms.
        const ranked = rankSessions(
          input.map(it => it.row),
          debouncedQuery,
        )
        const byId = new Map(input.map(it => [it.row.id, it]))
        return ranked
          .map(m => {
            const item = byId.get(m.item.id)
            if (!item) return null
            return { item, score: m.score, indexes: m.indexes }
          })
          .filter((x): x is { item: SessionListItem; score: number; indexes: number[] } => x !== null)
      },
    [debouncedQuery],
  )

  return (
    <Box flexDirection="column">
      <ListDialog<SessionListItem>
        title={pendingDeleteId ? 'Delete session? Press Enter to confirm, Esc to cancel.' : 'Sessions'}
        subtitle={`${rows.length} session${rows.length === 1 ? '' : 's'}${debouncedQuery ? ` · filter: "${debouncedQuery}"` : ''}`}
        items={items}
        rank={rankFn}
        placeholder="Search by title, summary, or first message…"
        onQueryChange={q => {
          setRawQuery(q)
          debouncer.current.call(q)
        }}
        pageSize={12}
        renderRow={(item, isFocused) => (
          <SessionRowRender row={item.row} isFocused={isFocused} pendingDelete={pendingDeleteId === item.row.id} />
        )}
        onSelect={item => {
          if (pendingDeleteId === item.row.id) {
            onDelete(item.row)
            setPendingDeleteId(null)
            return
          }
          onResume(item.row)
        }}
        onCancel={() => {
          if (pendingDeleteId) {
            setPendingDeleteId(null)
            return
          }
          onCancel()
        }}
        onKey={(input: string, key: Key, focused) => {
          if (!focused) return false
          if (key.ctrl && input === 'd') {
            setPendingDeleteId(focused.row.id)
            return true
          }
          if (key.shift && key.return) {
            onFork(focused.row)
            return true
          }
          return false
        }}
        footerHint={
          <Text dimColor>
            enter resume · shift+enter fork · ctrl+d delete · esc close
          </Text>
        }
      />
      {rawQuery !== debouncedQuery ? (
        <Box marginTop={1}>
          <Text dimColor>Filtering…</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function SessionRowRender({
  row,
  isFocused,
  pendingDelete,
}: {
  row: SessionRow
  isFocused: boolean
  pendingDelete: boolean
}): React.ReactNode {
  const ageStr = formatLastActivity(row.lastActivity)
  const msgStr = `${row.messageCount} msg${row.messageCount === 1 ? '' : 's'}`
  const forkMark = row.parentId ? ' ⎇' : ''
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={pendingDelete ? 'warning' : isFocused ? 'suggestion' : undefined}>
          {(row.title || '(untitled)') + forkMark}
        </Text>
        <Text dimColor>{'  '}</Text>
        <Text dimColor>{`${msgStr} · ${ageStr}`}</Text>
      </Box>
      {row.summary || row.firstMessage ? (
        <Box paddingLeft={2}>
          <Text dimColor>{(row.summary || row.firstMessage).slice(0, 100)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
