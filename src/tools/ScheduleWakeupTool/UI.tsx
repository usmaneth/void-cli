import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Text } from '../../ink.js'
import type { ScheduleWakeupOutput } from './ScheduleWakeupTool.js'

export function renderToolUseMessage(
  input: Partial<{ delaySeconds: number; reason: string }>,
): React.ReactNode {
  if (input.delaySeconds === undefined && !input.reason) return null
  const delay =
    input.delaySeconds !== undefined ? `${input.delaySeconds}s` : '?s'
  const reason = input.reason ? ` — ${input.reason}` : ''
  return `in ${delay}${reason}`
}

export function renderToolResultMessage(
  output: ScheduleWakeupOutput,
): React.ReactNode {
  if (output.scheduledFor === 0) {
    return (
      <MessageResponse>
        <Text dimColor>
          Wakeup not scheduled — /loop dynamic mode is disabled or the loop
          has ended.
        </Text>
      </MessageResponse>
    )
  }
  const when = new Date(output.scheduledFor).toTimeString().slice(0, 8)
  const remaining = Math.max(
    0,
    Math.round((output.scheduledFor - Date.now()) / 1000),
  )
  const clamped = output.wasClamped
    ? ` (clamped to ${output.clampedDelaySeconds}s)`
    : ''
  return (
    <MessageResponse>
      <Text>
        Next wakeup <Text bold>{when}</Text>{' '}
        <Text dimColor>
          (in {remaining}s){clamped}
        </Text>
      </Text>
    </MessageResponse>
  )
}
