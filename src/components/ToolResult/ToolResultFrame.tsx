/**
 * ToolResultFrame — the unified renderer for tool results.
 *
 * Consumes a {@link ToolResultView} produced by a tool's opt-in
 * `renderToolResultView` method and composes it into a ToolCard with
 * the right variant, subtitle, tag, and body.
 *
 * This is the single entry point that replaces the 4-way fork in
 * UserToolResultMessage (success/error/rejected/canceled) for tools
 * that have been migrated to the new schema. Non-migrated tools keep
 * using the legacy renderer; they can be converted piecemeal without
 * breaking anything.
 *
 * The fork is now inside the schema — `view.status` drives the card
 * variant, the subtitle/tag slots standardize header treatment, and
 * the body/footer slots keep per-tool rendering flexible.
 */
import * as React from 'react'
import { memo } from 'react'
import { Box } from '../../ink.js'
import {
  resolveToolCardType,
  ToolCard,
  type ToolCardVariant,
} from '../ToolCard.js'
import type {
  ToolResultStatus,
  ToolResultView,
} from './ToolResultView.js'

type Props = {
  /** Tool name (e.g. "Bash", "FileEdit") — used to pick the card icon/color. */
  toolName: string
  /** Human-readable label shown in the header. */
  label: string
  /** The schema produced by the tool. */
  view: ToolResultView
  /** Render in collapsed/condensed mode (single-line summary). */
  collapsed?: boolean
  /** Opt in to streaming body subscription. Passed through to ToolCard. */
  toolUseID?: string
}

const STATUS_TO_VARIANT: Record<ToolResultStatus, ToolCardVariant> = {
  success: 'success',
  error: 'error',
  warn: 'warn',
  rejected: 'rejected',
  canceled: 'canceled',
  running: 'running',
}

function ToolResultFrameImpl({
  toolName,
  label,
  view,
  collapsed = false,
  toolUseID,
}: Props): React.ReactNode {
  const cardType = resolveToolCardType(toolName)
  const variant = STATUS_TO_VARIANT[view.status]
  const tagLabel = view.tag?.label
  return (
    <ToolCard
      type={cardType}
      label={label}
      variant={variant}
      subtitle={view.subtitle}
      tag={tagLabel}
      collapsed={collapsed}
      toolUseID={toolUseID}
    >
      <Box flexDirection="column">
        {view.body ?? null}
        {view.footer && (
          <Box marginTop={view.body ? 1 : 0}>{view.footer}</Box>
        )}
      </Box>
    </ToolCard>
  )
}

export const ToolResultFrame = memo(ToolResultFrameImpl)
