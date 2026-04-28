/**
 * Council Renderer — React components for displaying council mode output.
 *
 * Shows real-time progress of parallel model queries, individual responses,
 * consensus results, and cost summaries.
 */
import * as React from 'react'
import { memo, useState, useEffect } from 'react'
import { Box, Text, useTheme } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { getPalette, resolveModelAccent } from '../theme/index.js'
import type {
  CouncilEvent,
  CouncilMember,
  CouncilResponse,
  ConsensusResult,
} from './types.js'

// ── Member Colors ─────────────────────────────────────────────────────────

/**
 * Council members are accented with their resolved model-family color when
 * a model id is available, falling back to a stable rotation across the
 * brand/role/state palette tokens for index-only callers.
 */
function memberRotation(palette: ReturnType<typeof getPalette>): string[] {
  return [
    palette.brand.diamond,
    palette.brand.accent,
    palette.role.voidWrite,
    palette.state.success,
    palette.role.voidProse,
    palette.state.failure,
  ]
}

function getMemberColor(index: number, member?: CouncilMember): string {
  if (member?.model) return resolveModelAccent(member.model)
  const rotation = memberRotation(getPalette())
  return rotation[index % rotation.length]!
}

// ── Status Indicators ─────────────────────────────────────────────────────

const STATUS_ICONS = {
  pending: '○',
  running: '◉',
  complete: '●',
  error: '✗',
} as const

type MemberStatus = keyof typeof STATUS_ICONS

// ── Format Helpers ────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(5)}`
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

// ── Council Header ────────────────────────────────────────────────────────

type CouncilHeaderProps = {
  members: CouncilMember[]
  statuses: Map<string, MemberStatus>
}

function CouncilHeaderImpl({
  members,
  statuses,
}: CouncilHeaderProps): React.ReactNode {
  const palette = getPalette()
  const { columns } = useTerminalSize()
  const width = Math.min(columns - 4, 100)
  const divider = '─'.repeat(width)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{divider}</Text>
      <Box>
        <Text bold color={palette.brand.diamond}>
          {'⚡ COUNCIL MODE'}
        </Text>
        <Text dimColor>
          {' · '}
          {members.length} members
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {members.map((member, i) => {
          const status = statuses.get(member.id) ?? 'pending'
          const icon = STATUS_ICONS[status]
          const color = getMemberColor(i, member)
          return (
            <Box key={member.id}>
              <Text
                color={
                  status === 'error'
                    ? palette.state.failure
                    : status === 'complete'
                      ? palette.state.success
                      : color
                }
              >
                {icon}
              </Text>
              <Text> </Text>
              <Text bold color={color}>
                {member.name}
              </Text>
              <Text dimColor>
                {' '}
                ({member.model})
              </Text>
              {member.role && (
                <Text dimColor>
                  {' · '}
                  {member.role}
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
      <Text dimColor>{divider}</Text>
    </Box>
  )
}

const CouncilHeader = memo(CouncilHeaderImpl)

// ── Member Response Card ──────────────────────────────────────────────────

type MemberResponseCardProps = {
  response: CouncilResponse
  memberIndex: number
  isWinner: boolean
  maxPreviewLines?: number
}

function MemberResponseCardImpl({
  response,
  memberIndex,
  isWinner,
  maxPreviewLines = 8,
}: MemberResponseCardProps): React.ReactNode {
  const palette = getPalette()
  const color = getMemberColor(memberIndex)
  const { columns } = useTerminalSize()
  const maxWidth = Math.min(columns - 6, 100)

  // Preview first N lines
  const lines = response.content.split('\n')
  const previewLines = lines.slice(0, maxPreviewLines)
  const hasMore = lines.length > maxPreviewLines
  const preview = previewLines
    .map((l) => truncate(l, maxWidth - 4))
    .join('\n')

  return (
    <Box flexDirection="column" paddingX={1} marginY={0}>
      {/* Header */}
      <Box>
        {isWinner && (
          <Text color={palette.state.success} bold>
            {'★ '}
          </Text>
        )}
        <Text bold color={color}>
          {response.memberName}
        </Text>
        <Text dimColor>
          {' · '}
          {formatMs(response.latencyMs)}
          {' · '}
          {formatTokens(response.tokens.input)}↑ {formatTokens(response.tokens.output)}↓
          {' · '}
          {formatUSD(response.costUSD)}
        </Text>
      </Box>

      {/* Response preview */}
      <Box marginLeft={2} flexDirection="column">
        <Text color={isWinner ? undefined : palette.text.dim}>{preview}</Text>
        {hasMore && (
          <Text dimColor>
            {'... '}
            {lines.length - maxPreviewLines} more lines
          </Text>
        )}
      </Box>
    </Box>
  )
}

const MemberResponseCard = memo(MemberResponseCardImpl)

// ── Consensus Summary ─────────────────────────────────────────────────────

type ConsensusSummaryProps = {
  result: ConsensusResult
}

function ConsensusSummaryImpl({
  result,
}: ConsensusSummaryProps): React.ReactNode {
  const palette = getPalette()
  const { columns } = useTerminalSize()
  const width = Math.min(columns - 4, 100)
  const divider = '─'.repeat(width)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{divider}</Text>
      <Box>
        <Text bold color={palette.state.success}>
          {'✓ CONSENSUS'}
        </Text>
        <Text dimColor>
          {' · method: '}
          {result.method}
          {' · '}
          {result.responses.length} responses
          {' · '}
          {formatMs(result.totalLatencyMs)} total
          {' · '}
          {formatUSD(result.totalCostUSD)}
        </Text>
      </Box>

      {/* Scores */}
      <Box flexDirection="column" marginLeft={2}>
        {result.scores
          .sort((a, b) => b.score - a.score)
          .map((score, i) => (
            <Box key={score.memberId}>
              <Text color={i === 0 ? palette.state.success : undefined} bold={i === 0}>
                {i === 0 ? '★' : ' '} {score.memberId}
              </Text>
              <Text dimColor>
                {' · score: '}
                {score.score.toFixed(2)}
                {' · '}
                {score.reason}
              </Text>
            </Box>
          ))}
      </Box>
      <Text dimColor>{divider}</Text>
    </Box>
  )
}

const ConsensusSummary = memo(ConsensusSummaryImpl)

// ── Main Council Display ──────────────────────────────────────────────────

type CouncilDisplayProps = {
  events: CouncilEvent[]
}

function CouncilDisplayImpl({
  events,
}: CouncilDisplayProps): React.ReactNode {
  const palette = getPalette()
  // Derive state from events
  const members: CouncilMember[] = []
  const statuses = new Map<string, MemberStatus>()
  const responses: CouncilResponse[] = []
  const errors = new Map<string, string>()
  let consensusResult: ConsensusResult | undefined

  for (const event of events) {
    switch (event.type) {
      case 'council_start':
        members.push(...event.members)
        for (const m of event.members) {
          statuses.set(m.id, 'pending')
        }
        break
      case 'member_start':
        statuses.set(event.memberId, 'running')
        break
      case 'member_complete':
        statuses.set(event.memberId, 'complete')
        responses.push(event.response)
        break
      case 'member_error':
        statuses.set(event.memberId, 'error')
        errors.set(event.memberId, event.error)
        break
      case 'consensus_complete':
      case 'council_complete':
        consensusResult = event.result
        break
    }
  }

  if (members.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column">
      <CouncilHeader members={members} statuses={statuses} />

      {/* Error messages */}
      {Array.from(errors.entries()).map(([id, error]) => (
        <Box key={id} paddingX={2}>
          <Text color={palette.state.failure}>
            {'✗ '}
            {id}: {error}
          </Text>
        </Box>
      ))}

      {/* Response cards */}
      {responses.map((response) => {
        const idx = members.findIndex((m) => m.id === response.memberId)
        const isWin = consensusResult?.winner.memberId === response.memberId
        return (
          <Box key={response.memberId} flexDirection="column">
            <MemberResponseCardImpl
              response={response}
              memberIndex={idx}
              isWinner={isWin ?? false}
            />
          </Box>
        )
      })}

      {/* Consensus summary */}
      {consensusResult && <ConsensusSummary result={consensusResult} />}
    </Box>
  )
}

export const CouncilDisplay = memo(CouncilDisplayImpl)

// ── Compact Council Status ────────────────────────────────────────────────

type CouncilStatusLineProps = {
  members: CouncilMember[]
  statuses: Map<string, MemberStatus>
}

function CouncilStatusLineImpl({
  members,
  statuses,
}: CouncilStatusLineProps): React.ReactNode {
  const palette = getPalette()
  const completed = Array.from(statuses.values()).filter(
    (s) => s === 'complete',
  ).length
  const errored = Array.from(statuses.values()).filter(
    (s) => s === 'error',
  ).length

  return (
    <Box>
      <Text bold color={palette.brand.diamond}>
        {'⚡ Council'}
      </Text>
      <Text dimColor>
        {' '}
        {completed}/{members.length} complete
      </Text>
      {errored > 0 && (
        <Text color={palette.state.failure}>
          {' '}
          ({errored} failed)
        </Text>
      )}
    </Box>
  )
}

export const CouncilStatusLine = memo(CouncilStatusLineImpl)
