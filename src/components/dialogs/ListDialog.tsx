/**
 * Reusable `<ListDialog>` — powers the /model, /provider, and /mcp
 * pickers plus any future searchable-list UI. Pairs with the fuzzy
 * scorer in `src/utils/fuzzy` so every picker gets consistent ranking.
 *
 * Render logic is kept dumb: the caller supplies raw items + a `render`
 * function per row. Ranking happens here so callers don't duplicate the
 * boilerplate. State lives in a reducer that Voidex can reuse.
 */
import * as React from 'react'
import { useEffect, useMemo, useReducer } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import type { Key } from '../../ink.js'
import { fuzzyRank, type FuzzyMatch } from '../../utils/fuzzy/index.js'

export type ListDialogItem = {
  /** Stable identity used for keyed renders + selection callbacks. */
  readonly id: string
  /** Primary searchable text — shown on the left of each row. */
  readonly label: string
  /** Optional secondary text — shown dimmed on the right. */
  readonly description?: string
  /**
   * Hidden haystacks — folded into ranking but not displayed. Useful for
   * aliases, tags, or summaries.
   */
  readonly searchText?: readonly string[]
  /** When true the row is rendered but Enter is a no-op. */
  readonly disabled?: boolean
  /** Arbitrary extra payload — passed back to `onSelect`. */
  readonly meta?: unknown
}

export type ListDialogProps<T extends ListDialogItem = ListDialogItem> = {
  readonly title: string
  readonly subtitle?: string
  readonly items: readonly T[]
  readonly onSelect: (item: T) => void
  readonly onCancel: () => void
  /**
   * Toggle shortcut — when present, Space/Tab calls this and a checkbox is
   * rendered on each row. Used by /provider and /mcp.
   */
  readonly onToggle?: (item: T) => void
  readonly isSelected?: (item: T) => boolean
  readonly placeholder?: string
  /** Override the rank function (e.g. for the session picker). */
  readonly rank?: (items: readonly T[], query: string) => FuzzyMatch<T>[]
  /** Custom row renderer — defaults to "label  description". */
  readonly renderRow?: (item: T, isFocused: boolean, indexes: readonly number[]) => React.ReactNode
  /** Visible rows in the list viewport. */
  readonly pageSize?: number
  readonly emptyMessage?: string
  /** Extra footer line (e.g. "enter resume · shift+enter fork"). */
  readonly footerHint?: React.ReactNode
  /**
   * Called on every keystroke with the debounced query. Lets callers hook
   * in async refinement (e.g. the session picker's server-side search).
   */
  readonly onQueryChange?: (query: string) => void
  /** Extra key handler — invoked before the default handlers. Return true
   *  to consume. */
  readonly onKey?: (input: string, key: Key, focused: T | null) => boolean | void
}

type State = {
  query: string
  focusIndex: number
}

type Action =
  | { kind: 'setQuery'; value: string }
  | { kind: 'moveUp' }
  | { kind: 'moveDown' }
  | { kind: 'resetFocus' }

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case 'setQuery':
      return { ...state, query: action.value, focusIndex: 0 }
    case 'moveUp':
      return { ...state, focusIndex: Math.max(0, state.focusIndex - 1) }
    case 'moveDown':
      return { ...state, focusIndex: state.focusIndex + 1 }
    case 'resetFocus':
      return { ...state, focusIndex: 0 }
  }
}

export function ListDialog<T extends ListDialogItem>({
  title,
  subtitle,
  items,
  onSelect,
  onCancel,
  onToggle,
  isSelected,
  placeholder = 'Type to search…',
  rank,
  renderRow,
  pageSize = 8,
  emptyMessage = 'No matches',
  footerHint,
  onQueryChange,
  onKey,
}: ListDialogProps<T>): React.ReactNode {
  const [state, dispatch] = useReducer(reducer, { query: '', focusIndex: 0 })

  const ranked = useMemo(() => {
    if (rank) return rank(items, state.query)
    return fuzzyRank<T>(items, state.query, item => {
      const base = [item.label]
      if (item.description) base.push(item.description)
      if (item.searchText) base.push(...item.searchText)
      return base
    })
  }, [items, state.query, rank])

  useEffect(() => {
    onQueryChange?.(state.query)
  }, [state.query, onQueryChange])

  const clampedFocus = Math.min(state.focusIndex, Math.max(0, ranked.length - 1))
  const focused = ranked[clampedFocus]?.item ?? null

  useInput((input: string, key: Key) => {
    if (onKey && onKey(input, key, focused) === true) return

    if (key.escape) {
      onCancel()
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      dispatch({ kind: 'moveUp' })
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      dispatch({ kind: 'moveDown' })
      return
    }
    if (key.return) {
      if (focused && !focused.disabled) onSelect(focused)
      return
    }
    if ((input === ' ' || key.tab) && onToggle && focused && !focused.disabled) {
      onToggle(focused)
      return
    }
    if (key.backspace || key.delete) {
      dispatch({ kind: 'setQuery', value: state.query.slice(0, -1) })
      return
    }
    // Printable characters extend the query.
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      dispatch({ kind: 'setQuery', value: state.query + input })
    }
  })

  // Viewport slicing — keep the focused row visible.
  const startIdx = Math.max(
    0,
    Math.min(
      clampedFocus - Math.floor(pageSize / 2),
      Math.max(0, ranked.length - pageSize),
    ),
  )
  const endIdx = Math.min(ranked.length, startIdx + pageSize)
  const visible = ranked.slice(startIdx, endIdx)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="suggestion">
          {title}
        </Text>
        {subtitle ? <Text dimColor>{subtitle}</Text> : null}
      </Box>

      <Box marginBottom={1}>
        <Text>
          <Text dimColor>{'\u2315 '}</Text>
          <Text>{state.query}</Text>
          <Text dimColor>
            {state.query === '' ? placeholder : '_'}
          </Text>
        </Text>
      </Box>

      {ranked.length === 0 ? (
        <Box>
          <Text dimColor>{emptyMessage}</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.map((match, i) => {
            const absoluteIdx = startIdx + i
            const isFocused = absoluteIdx === clampedFocus
            const item = match.item
            const selected = isSelected?.(item) ?? false
            return (
              <Box key={item.id} flexDirection="row">
                <Text color={isFocused ? 'suggestion' : undefined}>
                  {isFocused ? '\u276f ' : '  '}
                </Text>
                {onToggle ? (
                  <Text color={selected ? 'success' : undefined}>
                    {selected ? '[x] ' : '[ ] '}
                  </Text>
                ) : null}
                {renderRow ? (
                  renderRow(item, isFocused, match.indexes)
                ) : (
                  <>
                    <Text color={isFocused ? 'suggestion' : undefined} dimColor={item.disabled}>
                      {item.label}
                    </Text>
                    {item.description ? (
                      <Text dimColor> {'\u2014 '}{item.description}</Text>
                    ) : null}
                  </>
                )}
              </Box>
            )
          })}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {`${ranked.length} result${ranked.length === 1 ? '' : 's'}`}
          {ranked.length > pageSize ? ` · showing ${startIdx + 1}-${endIdx}` : ''}
        </Text>
        {footerHint ? <Text dimColor>{footerHint}</Text> : null}
        <Text dimColor italic>
          {onToggle ? '↑↓ move · space toggle · enter confirm · esc cancel' : '↑↓ move · enter select · esc cancel'}
        </Text>
      </Box>
    </Box>
  )
}
