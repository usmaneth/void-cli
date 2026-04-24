/**
 * SessionOutline — keyboard/scroll-friendly compact minimap of the current
 * session's milestones (user prompts, assistant/tool activity, file edits,
 * failures, approvals, validation-like commands).
 *
 * Designed to coexist with the existing Messages/MessageRow/FullscreenLayout
 * pipeline — it consumes the SAME message array REPL passes to Messages and
 * derives a parallel view without re-rendering or replacing the transcript.
 *
 * The outline is rendered as a bordered box that can be shown:
 *   - inside the FullscreenLayout `overlay` slot (below scrollback)
 *   - OR as a standalone transcript-panel when hosted by a container
 *
 * Navigation is keyboard-driven: ↑/↓ (or k/j) move the cursor, Enter reports
 * the selected milestone's messageIndex/uuid to the parent so it can scroll
 * the transcript. Esc signals close. Ink's scrollbox handles wheel/PageUp/
 * PageDown for us when the list overflows.
 */
import * as React from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import {
  buildSessionOutline,
  type Milestone,
  milestoneColor,
  milestoneMarker,
} from '../utils/sessionOutline.js'

type Props = {
  /** The same messages array REPL passes to <Messages />. Accepts either
   *  raw or normalized messages (duck-typed). */
  messages: readonly unknown[]
  /** Called when the user hits Enter on a milestone. Receives the source
   *  message index + uuid so the caller can jump into the transcript. */
  onJump?: (milestone: Milestone) => void
  /** Called when the user presses Esc / ctrl+c to dismiss the outline. */
  onClose?: () => void
  /** When false, disables keyboard capture (but still renders). Useful when
   *  the outline is inline and another dialog owns focus. */
  isActive?: boolean
  /** Optional expansion hook for collapsed pseudo-messages
   *  ('grouped_tool_use', 'collapsed_read_search'). */
  expandCollapsed?: (msg: unknown) => unknown[] | undefined
  /** Optional title to override the default. */
  title?: string
  /** Max rows to display at once. Defaults to terminal height - 6. */
  maxRows?: number
}

// Minimum row budget so the header/footer don't dominate on short terminals.
const MIN_LIST_ROWS = 6

function SessionOutlineImpl({
  messages,
  onJump,
  onClose,
  isActive = true,
  expandCollapsed,
  title = 'Session outline',
  maxRows,
}: Props): React.ReactNode {
  const { rows: terminalRows, columns } = useTerminalSize()
  const milestones = useMemo(
    () => buildSessionOutline(messages, { expandCollapsed }),
    [messages, expandCollapsed],
  )

  const [cursor, setCursor] = useState(() => Math.max(0, milestones.length - 1))

  // Keep cursor in range when milestones grow/shrink. When new milestones
  // arrive and the cursor was at the end, follow the tail — otherwise leave
  // the user's position alone.
  useEffect(() => {
    if (milestones.length === 0) {
      setCursor(0)
      return
    }
    setCursor(prev => {
      if (prev >= milestones.length) return milestones.length - 1
      if (prev < 0) return 0
      return prev
    })
  }, [milestones.length])

  const listRows = Math.max(
    MIN_LIST_ROWS,
    Math.min(maxRows ?? terminalRows - 6, terminalRows - 6),
  )

  // Window around the cursor so we always show the selected row.
  const { startIndex, visible } = useMemo(() => {
    if (milestones.length === 0) return { startIndex: 0, visible: [] }
    const half = Math.floor(listRows / 2)
    let start = Math.max(0, cursor - half)
    const maxStart = Math.max(0, milestones.length - listRows)
    if (start > maxStart) start = maxStart
    const end = Math.min(milestones.length, start + listRows)
    return {
      startIndex: start,
      visible: milestones.slice(start, end),
    }
  }, [milestones, cursor, listRows])

  const move = useCallback(
    (delta: number) => {
      setCursor(prev => {
        if (milestones.length === 0) return 0
        const next = prev + delta
        if (next < 0) return 0
        if (next >= milestones.length) return milestones.length - 1
        return next
      })
    },
    [milestones.length],
  )

  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 'c')) {
        onClose?.()
        return
      }
      if (key.return) {
        const m = milestones[cursor]
        if (m) onJump?.(m)
        return
      }
      if (key.upArrow || input === 'k') {
        move(-1)
        return
      }
      if (key.downArrow || input === 'j') {
        move(1)
        return
      }
      if (key.pageUp || (key.ctrl && input === 'u')) {
        move(-Math.max(1, Math.floor(listRows / 2)))
        return
      }
      if (key.pageDown || (key.ctrl && input === 'd')) {
        move(Math.max(1, Math.floor(listRows / 2)))
        return
      }
      if (input === 'g') {
        setCursor(0)
        return
      }
      if (input === 'G') {
        setCursor(Math.max(0, milestones.length - 1))
        return
      }
    },
    { isActive },
  )

  const width = Math.min(columns, 120)
  const labelColWidth = Math.max(20, width - 14) // marker+index+padding

  if (milestones.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="subtle"
        paddingX={1}
        width={width}
      >
        <Box>
          <Text bold>{title}</Text>
          <Text dimColor> · (empty)</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            No milestones yet — start chatting or run a tool to populate.
          </Text>
        </Box>
        {isActive && (
          <Box marginTop={1}>
            <Text dimColor>esc to close</Text>
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="subtle"
      paddingX={1}
      width={width}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text bold>{title}</Text>
          <Text dimColor>
            {' '}· {cursor + 1}/{milestones.length}
          </Text>
        </Box>
        {isActive && (
          <Text dimColor>
            ↑↓ move · enter jump · esc close
          </Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((m, idx) => {
          const absoluteIdx = startIndex + idx
          const selected = absoluteIdx === cursor
          const marker = milestoneMarker(m.kind)
          const color = milestoneColor(m.kind)
          return (
            <Box key={`${m.uuid ?? 'm'}-${absoluteIdx}`} flexDirection="row">
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {selected ? '▸' : ' '}
              </Text>
              <Text> </Text>
              <Text color={color ?? (m.isError ? 'red' : undefined)} bold={m.isError || m.kind === 'validation'}>
                {marker}
              </Text>
              <Text> </Text>
              <Box width={labelColWidth}>
                <Text
                  color={selected ? 'white' : undefined}
                  bold={selected}
                  wrap="truncate-end"
                >
                  {m.label}
                </Text>
              </Box>
              {m.detail && !selected && (
                <Text dimColor wrap="truncate-end">
                  {' '}
                  {m.detail}
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
      {/* Footer: shows total count if there are more items than fit. */}
      {milestones.length > visible.length && (
        <Box marginTop={1}>
          <Text dimColor>
            showing {startIndex + 1}–{startIndex + visible.length} of{' '}
            {milestones.length}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export const SessionOutline = memo(SessionOutlineImpl)
