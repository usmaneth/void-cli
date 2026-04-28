/**
 * The 5-row hero status panel. Composes:
 *   - heroSpaceModelName (Task A1)
 *   - ContextBar (Task A2)
 *   - EffortDot (Task A3)
 *   - isSubscriptionProvider (Task A4) — determines cost rendering
 *   - panelLayout resolver (Task A5) — auto-downgrades by terminal width
 *
 * Frame color = per-model accent from resolveModelAccent (Phase 0).
 *
 * Exports:
 *   - StatusPanel (React component) — for callers that have all the props
 *   - computePanelLines — pure layout computation, exposed for tests
 */
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getPalette, resolveModelAccent } from '../../theme/index.js'
import { ContextBar } from './ContextBar.js'
import { EffortDot } from './EffortDot.js'
import { heroSpaceModelName } from './heroSpaceModelName.js'
import { IdleDiamond } from '../ambientMotion/IdleDiamond.js'
import {
  resolvePanelLayout,
  type PanelLayoutMode,
  type PanelLayoutOverride,
} from './panelLayout.js'

export type PermissionsMode = 'normal' | 'bypass' | 'plan'

export type StatusPanelInput = {
  mode: PanelLayoutMode
  model: string
  isSubscription: boolean
  streamActive: boolean
  contextRatio: number
  inputTokens: number
  outputTokens: number
  cost: number
  sessionDurationMs: number
  cwd: string
  teamName?: string
  permissionsMode: PermissionsMode
  effortLabel: string
  cols: number
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(2)}m`
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h${m}m`
}

function formatPermissions(mode: PermissionsMode): string {
  switch (mode) {
    case 'bypass':
      return '⏵⏵ bypass perms'
    case 'plan':
      return '✎ plan'
    case 'normal':
      return '✓ normal'
  }
}

function formatCost(cost: number, isSubscription: boolean): string {
  if (isSubscription) return 'sub'
  return `$${cost.toFixed(2)}`
}

/**
 * Pure layout computation — returns the panel as plain string rows.
 * Snapshot-testable. The React component renders these rows with
 * coloring overlaid.
 */
export function computePanelLines(input: StatusPanelInput): string[] {
  if (input.mode === 'off') return []

  const heroName =
    input.cols >= 90
      ? heroSpaceModelName(input.model)
      : input.model
  const tier = input.isSubscription ? 'ChatGPT Plus/Pro' : ''
  const ctxPct = `${Math.round(input.contextRatio * 100)}%`
  const inTok = formatTokens(input.inputTokens)
  const outTok = formatTokens(input.outputTokens)
  const dur = formatDuration(input.sessionDurationMs)
  const cost = formatCost(input.cost, input.isSubscription)
  const perms = formatPermissions(input.permissionsMode)
  const cwdShort = input.cwd
  const team = input.teamName ?? ''

  if (input.mode === 'minimal') {
    const cwdDisplay = team ? `${cwdShort} · ${team}` : cwdShort
    return [
      `◆ ${input.model} · ${tier ? tier + ' · ' : ''}ctx ${ctxPct} · ↑${inTok} ↓${outTok} · ${dur} · ${cost} · ${input.effortLabel} · ${perms} · ${cwdDisplay}`,
    ]
  }

  if (input.mode === 'compact') {
    const top = `${heroName} ◆ ${tier || 'API'} ── ${input.effortLabel}`
    const stats = `ctx ${ctxPct} · ↑${inTok} ↓${outTok} · ${dur} · ${cost}`
    const teamPart = team ? ` · ${team}` : ''
    const bottom = `${perms} · ${cwdShort}${teamPart}`
    return [top, stats, bottom]
  }

  const top = `╭─ ${heroName} ◆ ${tier || 'API'} ────────── ● ${input.effortLabel} ─╮`
  const stats = `│   ctx ${ctxPct}    ↑ ${inTok}    ↓ ${outTok}    ·    ${dur}    ·    ${cost}      │`
  const teamPart = team ? ` · ${team}` : ''
  const bottom = `╰─ ${perms}      ${cwdShort}${teamPart}     session ${dur}  ─╯`
  const blank = '│' + ' '.repeat(Math.max(0, top.length - 2)) + '│'

  return [top, blank, stats, blank, bottom]
}

export type StatusPanelProps = {
  model: string
  isSubscription: boolean
  streamActive: boolean
  contextRatio: number
  inputTokens: number
  outputTokens: number
  cost: number
  sessionDurationMs: number
  cwd: string
  teamName?: string
  permissionsMode: PermissionsMode
  effortLabel: string
  cols: number
  override?: PanelLayoutOverride
}

export function StatusPanel(props: StatusPanelProps): React.ReactNode {
  const palette = getPalette()
  const accent = resolveModelAccent(props.model)
  const mode = resolvePanelLayout({ cols: props.cols, override: props.override })

  if (mode === 'off') return null

  if (mode === 'minimal') {
    const lines = computePanelLines({ ...props, mode })
    return <Text color={accent}>{lines[0]}</Text>
  }

  const tierLabel = props.isSubscription ? 'ChatGPT Plus/Pro' : 'API'
  const heroName = props.cols >= 90 ? heroSpaceModelName(props.model) : props.model
  const barWidth = Math.min(10, Math.max(4, Math.floor(props.cols / 10)))
  const teamPart = props.teamName ? ' · ' + props.teamName : ''

  return (
    <Box flexDirection="column">
      <Box>
        {mode === 'full' && <Text color={accent}>╭─ </Text>}
        <Text color={palette.state.confident}>{heroName}</Text>
        <Text color={accent}>{'  ◆ '}</Text>
        <Text color={palette.text.dim}>{tierLabel}</Text>
        <Text color={accent}>{mode === 'full' ? ' ─────────── ' : ' ── '}</Text>
        <EffortDot streamActive={props.streamActive} contextRatio={props.contextRatio} />
        <Text color={palette.text.dim}>{' ' + props.effortLabel}</Text>
        {mode === 'full' && <Text color={accent}> ─╮</Text>}
      </Box>

      {mode === 'full' && (
        <Text color={accent}>│{' '.repeat(Math.max(0, props.cols - 2))}│</Text>
      )}

      <Box>
        {mode === 'full' && <Text color={accent}>│   </Text>}
        <ContextBar ratio={props.contextRatio} width={barWidth} />
        <Text color={palette.state.confident}>{`  ${Math.round(props.contextRatio * 100)}%`}</Text>
        <Text color={palette.text.dim}>
          {`   ↑ ${formatTokens(props.inputTokens)}   ↓ ${formatTokens(props.outputTokens)}   ·   ${formatDuration(props.sessionDurationMs)}   ·   ${formatCost(props.cost, props.isSubscription)}`}
        </Text>
        {mode === 'full' && <Text color={accent}>     │</Text>}
      </Box>

      {mode === 'full' && (
        <Text color={accent}>│{' '.repeat(Math.max(0, props.cols - 2))}│</Text>
      )}

      <Box>
        {mode === 'full' && <Text color={accent}>╰─ </Text>}
        <Text color={palette.state.failure}>{formatPermissions(props.permissionsMode)}</Text>
        <Text color={palette.text.dim}>{`     ${props.cwd}${teamPart}`}</Text>
        {mode === 'full' && (
          <Text color={palette.text.dim}>{`    session ${formatDuration(props.sessionDurationMs)}`}</Text>
        )}
        {mode === 'full' && <Text color={accent}>  ─╯ </Text>}
        <IdleDiamond streamActive={props.streamActive} />
      </Box>
    </Box>
  )
}
