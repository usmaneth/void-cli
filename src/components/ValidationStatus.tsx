/**
 * ValidationStatus — a compact SessionHUD segment showing the latest
 * validation command/result derived from the transcript.
 *
 * Render format:
 *   "· typecheck: pass · lint: running"   (happy path)
 *   "· test: fail (vitest run src/...)"   (attention)
 *
 * Colors:
 *   pass    → green
 *   fail    → red
 *   running → yellow
 *
 * The segment is hidden when no validation command has been detected in the
 * recent transcript window. State is derived on every render from the
 * messages prop — there is no store and no subscription, matching the
 * lightweight-derivation constraint of this feature.
 */
import * as React from 'react'
import { memo } from 'react'
import { Box, Text } from '../ink.js'
import { getPalette } from '../theme/index.js'
import type { Message } from '../types/message.js'
import {
  getLatestValidation,
  type ValidationKind,
  type ValidationRecord,
  type ValidationState,
} from '../services/validation/validationStatus.js'

type Props = {
  /** Transcript messages — same shape REPL passes to PromptInputFooter. */
  messages: readonly Message[]
}

function stateColor(
  state: ValidationState,
  palette: ReturnType<typeof getPalette>,
): string {
  switch (state) {
    case 'pass':
      return palette.state.success
    case 'running':
      return palette.state.warning
    case 'fail':
      return palette.state.failure
  }
}

const STATE_GLYPH: Record<ValidationState, string> = {
  pass: 'ok',
  running: '...',
  fail: 'fail',
}

const KIND_LABEL: Record<ValidationKind, string> = {
  lint: 'lint',
  typecheck: 'typecheck',
  test: 'test',
  build: 'build',
}

function ValidationStatusImpl({ messages }: Props): React.ReactNode {
  const latest = getLatestValidation(messages)
  if (!latest) return null
  return <ValidationChip record={latest} />
}

/**
 * The chip itself. Split out so memoization can be keyed on the narrow
 * derived ValidationRecord shape instead of the whole messages array —
 * parent re-renders on every message append, but our record only changes
 * when a validation run starts or finishes.
 */
function ValidationChipImpl({
  record,
}: {
  record: ValidationRecord
}): React.ReactNode {
  const palette = getPalette()
  const color = stateColor(record.state, palette)
  const glyph = STATE_GLYPH[record.state]
  const label = KIND_LABEL[record.kind]

  // Show the short command tail only when attention is warranted (fail or
  // running) so the happy-path chip stays terse.
  const showDetail = record.state !== 'pass'
  const detail = showDetail ? record.command : undefined
  // Transcript ref: short UUID prefix the user can look up with ctrl-r or
  // scrollback — an inline "#abcdef0" breadcrumb. Kept minimal so we don't
  // need to wire a click-to-scroll plumbing path through ScrollChromeContext.
  const refUuid = record.toolResultUuid ?? record.toolUseUuid
  const refTag =
    showDetail && typeof refUuid === 'string' && refUuid.length >= 7
      ? `#${refUuid.slice(0, 7)}`
      : undefined

  return (
    <Box>
      <Text dimColor>{' · '}</Text>
      <Text dimColor>{label + ':'}</Text>
      <Text color={color}>{' ' + glyph}</Text>
      {detail && (
        <Text dimColor>
          {' ('}
          {detail}
          {')'}
        </Text>
      )}
      {refTag && <Text dimColor>{' ' + refTag}</Text>}
    </Box>
  )
}

const ValidationChip = memo(ValidationChipImpl)

export const ValidationStatus = memo(ValidationStatusImpl)
