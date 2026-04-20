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
import type {
  CouncilEvent,
  CouncilMember,
  CouncilResponse,
  ConsensusResult,
} from './types.js'

// ── Member Colors ─────────────────────────────────────────────────────────

const MEMBER_COLORS: string[] = [
  'cyan',
  'magenta',
  'yellow',
  'green',
  'blue',
  'red',
]

function getMemberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length]!
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
  const { columns } = useTerminalSize()
  const width = Math.min(columns - 4, 100)
  const divider = '─'.repeat(width)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{divider}</Text>
      <Box>
        <Text bold color="cyan">
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
          const color = getMemberColor(i)
          return (
            <Box key={member.id}>
              <Text
                color={
                  status === 'error'
                    ? 'red'
                    : status === 'complete'
                      ? 'green'
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
          <Text color="green" bold>
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
        <Text color={isWinner ? undefined : 'gray'}>{preview}</Text>
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
  const { columns } = useTerminalSize()
  const width = Math.min(columns - 4, 100)
  const divider = '─'.repeat(width)

  const noConsensus = result.outcome === 'no-consensus'
  const headerLabel = noConsensus ? '⚠ NO CONSENSUS' : '✓ CONSENSUS'
  const headerColor = noConsensus ? 'yellow' : 'green'

  // Group votes by target for a tidy breakdown, only when votes exist.
  const voteBreakdown = new Map<string, { weight: number; count: number }>()
  for (const v of result.votes ?? []) {
    const prev = voteBreakdown.get(v.targetId) ?? { weight: 0, count: 0 }
    voteBreakdown.set(v.targetId, {
      weight: prev.weight + v.weight,
      count: prev.count + 1,
    })
  }
  const sortedVotes = [...voteBreakdown.entries()].sort(
    (a, b) => b[1].weight - a[1].weight,
  )

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{divider}</Text>
      <Box>
        <Text bold color={headerColor}>
          {headerLabel}
        </Text>
        <Text dimColor>
          {' · mode: '}
        </Text>
        <Text bold color="cyan">
          {result.method}
        </Text>
        <Text dimColor>
          {' · '}
          {result.responses.length} responses
          {' · '}
          {formatMs(result.totalLatencyMs)} total
          {' · '}
          {formatUSD(result.totalCostUSD)}
        </Text>
      </Box>

      {/* Winner */}
      <Box marginLeft={2}>
        <Text bold color={noConsensus ? 'yellow' : 'green'}>
          {noConsensus ? '⚠ ' : '★ '}
          {'winner: '}
          {result.winner.memberName}
        </Text>
        <Text dimColor>
          {' ('}
          {result.winner.memberId}
          {')'}
        </Text>
      </Box>

      {/* Tiebreaker / retries / outcome reason */}
      {result.tiebreaker && (
        <Box marginLeft={2}>
          <Text color="yellow">
            {'tiebreaker: '}
            {result.tiebreaker.kind}
          </Text>
          <Text dimColor>
            {' · '}
            {result.tiebreaker.reason}
          </Text>
        </Box>
      )}
      {typeof result.retries === 'number' && result.retries > 0 && (
        <Box marginLeft={2}>
          <Text color="yellow">
            {'retries: '}
            {result.retries}
          </Text>
        </Box>
      )}

      {/* Vote breakdown */}
      {sortedVotes.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>votes:</Text>
          {sortedVotes.map(([targetId, { weight, count }], i) => (
            <Box key={targetId} marginLeft={2}>
              <Text
                color={i === 0 && !noConsensus ? 'green' : undefined}
                bold={i === 0 && !noConsensus}
              >
                {i === 0 && !noConsensus ? '★' : ' '} {targetId}
              </Text>
              <Text dimColor>
                {' · weight: '}
                {weight.toFixed(2)}
                {' · '}
                {count} vote{count === 1 ? '' : 's'}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Scores */}
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>scores:</Text>
        {result.scores
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((score, i) => (
            <Box key={score.memberId} marginLeft={2}>
              <Text
                color={i === 0 && !noConsensus ? 'green' : undefined}
                bold={i === 0 && !noConsensus}
              >
                {i === 0 && !noConsensus ? '★' : ' '} {score.memberId}
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
          <Text color="red">
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
  const completed = Array.from(statuses.values()).filter(
    (s) => s === 'complete',
  ).length
  const errored = Array.from(statuses.values()).filter(
    (s) => s === 'error',
  ).length

  return (
    <Box>
      <Text bold color="cyan">
        {'⚡ Council'}
      </Text>
      <Text dimColor>
        {' '}
        {completed}/{members.length} complete
      </Text>
      {errored > 0 && (
        <Text color="red">
          {' '}
          ({errored} failed)
        </Text>
      )}
    </Box>
  )
}

export const CouncilStatusLine = memo(CouncilStatusLineImpl)
