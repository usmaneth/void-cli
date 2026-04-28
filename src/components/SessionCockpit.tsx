/**
 * SessionCockpit — unified overlay that composes the three per-feature
 * session tools into a single dashboard:
 *   - Left: SessionOutline (milestones minimap)
 *   - Right top: validation history (recent lint/typecheck/test/build runs)
 *   - Right bottom: handoff summary (changed files, risks, next actions)
 *
 * All three data sources derive from the same messages array the REPL
 * passes to Messages — we don't maintain any internal store. Tab toggles
 * focus between outline (default, owns keybindings) and a dismiss-only
 * info pane. Esc closes.
 */
import * as React from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import type { Message } from '../types/message.js'
import type { Milestone } from '../utils/sessionOutline.js'
import { SessionOutline } from './SessionOutline.js'
import {
  getAllValidations,
  type ValidationRecord,
} from '../services/validation/validationStatus.js'
import {
  buildHandoff,
  type HandoffSummary,
} from '../commands/session/handoffData.js'
import { logForDebugging } from '../utils/debug.js'
import { getPalette } from '../theme/index.js'

type Props = {
  messages: readonly Message[]
  onJump?: (milestone: Milestone) => void
  onClose?: () => void
  expandCollapsed?: (msg: unknown) => unknown[] | undefined
}

/** Narrow-terminal breakpoint; below this we stack the panes vertically. */
const TWO_COLUMN_MIN_WIDTH = 100

function SessionCockpitImpl({
  messages,
  onJump,
  onClose,
  expandCollapsed,
}: Props): React.ReactNode {
  const { columns, rows } = useTerminalSize()
  const isTwoColumn = columns >= TWO_COLUMN_MIN_WIDTH
  const [focus, setFocus] = useState<'outline' | 'side'>('outline')

  useInput((input, key) => {
    if (key.tab) {
      setFocus(f => (f === 'outline' ? 'side' : 'outline'))
      return
    }
    if (focus === 'side' && (key.escape || (key.ctrl && input === 'c'))) {
      onClose?.()
    }
  })

  const validations = useMemo(
    () => getAllValidations(messages, { limit: 8 }),
    [messages],
  )

  const [handoff, setHandoff] = useState<HandoffSummary | null>(null)
  useEffect(() => {
    let cancelled = false
    buildHandoff(messages)
      .then(result => {
        if (!cancelled) setHandoff(result)
      })
      .catch(err => {
        logForDebugging(
          `cockpit: buildHandoff failed — ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    return () => {
      cancelled = true
    }
  }, [messages])

  // Dimension budgeting. We cap at terminal columns and leave room for the
  // outer frame + gap so the right pane never bleeds off-screen.
  const outlineWidth = isTwoColumn
    ? Math.max(40, Math.floor(columns * 0.55) - 2)
    : Math.min(columns, 120)
  const sideWidth = isTwoColumn
    ? Math.max(36, columns - outlineWidth - 3)
    : Math.min(columns, 120)
  // Leave space for the outer footer ("tab focus · esc close") and
  // the outline's own 5-row chrome.
  const outlineMaxRows = Math.max(8, rows - 8)

  return (
    <Box flexDirection="column">
      <Box flexDirection={isTwoColumn ? 'row' : 'column'} gap={1}>
        <Box flexDirection="column" width={outlineWidth}>
          <SessionOutline
            messages={messages}
            onJump={onJump}
            onClose={onClose}
            isActive={focus === 'outline'}
            expandCollapsed={expandCollapsed}
            title={focus === 'outline' ? '◆ Session outline' : 'Session outline'}
            maxRows={outlineMaxRows}
          />
        </Box>
        <Box flexDirection="column" width={sideWidth}>
          <ValidationHistory records={validations} />
          <HandoffSummaryCard summary={handoff} />
        </Box>
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>
          tab focus · ↑↓ jkgG move · enter jump · esc close
        </Text>
      </Box>
    </Box>
  )
}

function ValidationHistoryImpl({
  records,
}: {
  records: readonly ValidationRecord[]
}): React.ReactNode {
  const palette = getPalette()
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="subtle"
      paddingX={1}
    >
      <Box>
        <Text bold>Validation</Text>
        <Text dimColor> · {records.length ? records.length : 'none'}</Text>
      </Box>
      {records.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>
            No lint / typecheck / test / build runs in the last 200 messages.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {records.map((r, i) => {
            const color =
              r.state === 'pass'
                ? palette.state.success
                : r.state === 'fail'
                  ? palette.state.failure
                  : palette.state.warning
            const glyph =
              r.state === 'pass' ? '✓' : r.state === 'fail' ? '✗' : '⋯'
            return (
              <Box key={`${r.toolUseUuid ?? 'v'}-${i}`} flexDirection="row">
                <Text color={color}>{glyph}</Text>
                <Text> </Text>
                <Box width={10}>
                  <Text>{r.kind}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {r.command}
                </Text>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
const ValidationHistory = memo(ValidationHistoryImpl)

function HandoffSummaryCardImpl({
  summary,
}: {
  summary: HandoffSummary | null
}): React.ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="subtle"
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text bold>Handoff</Text>
        {summary ? (
          <Text dimColor>
            {' '}· {summary.changedFiles.length} changed ·{' '}
            {summary.validationCommands.length} validation cmd
            {summary.validationCommands.length === 1 ? '' : 's'} ·{' '}
            {summary.unresolvedRisks.length} risk
            {summary.unresolvedRisks.length === 1 ? '' : 's'}
          </Text>
        ) : (
          <Text dimColor> · loading…</Text>
        )}
      </Box>
      {summary && (
        <Box flexDirection="column" marginTop={1}>
          {summary.changedFiles.slice(0, 5).map((f, i) => (
            <Box key={`f-${i}`} flexDirection="row">
              <Box width={3}>
                <Text dimColor>{f.status}</Text>
              </Box>
              <Text wrap="truncate-end">{f.path}</Text>
            </Box>
          ))}
          {summary.changedFiles.length > 5 && (
            <Text dimColor>… and {summary.changedFiles.length - 5} more</Text>
          )}
          {summary.suggestedNextActions.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="ide">
                Next
              </Text>
              {summary.suggestedNextActions.slice(0, 3).map((a, i) => (
                <Text key={`a-${i}`} wrap="truncate-end">
                  • {a}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}
const HandoffSummaryCard = memo(HandoffSummaryCardImpl)

export const SessionCockpit = memo(SessionCockpitImpl)
