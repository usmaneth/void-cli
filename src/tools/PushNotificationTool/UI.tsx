import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Text } from '../../ink.js'
import type { Input, Output } from './PushNotificationTool.js'

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  const msg = input.message ?? ''
  // Keep compact: show the push payload inline so the transcript reads like
  // "PushNotification: build failed: 2 auth tests".
  return msg
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  let summary: string
  if (output.disabledReason === 'config_off') {
    summary = 'Push not sent — mobile push is disabled in /config.'
  } else if (output.disabledReason === 'user_present') {
    if (output.hasFocus === true) {
      summary = 'Not sent — terminal has focus. Terminal + mobile suppressed.'
    } else {
      summary = `Not sent — user active (last activity ${output.idleSec ?? '<?'}s ago). Terminal + mobile suppressed.`
    }
  } else if (output.disabledReason === 'bridge_inactive') {
    summary = output.localSent
      ? 'Terminal notification sent. Mobile push not sent (Remote Control inactive).'
      : 'Mobile push not sent (Remote Control inactive).'
  } else if (output.pushSent) {
    summary = output.localSent
      ? 'Terminal and mobile notification sent.'
      : 'Mobile notification sent.'
  } else {
    summary = output.localSent
      ? 'Terminal notification sent.'
      : 'Push not sent.'
  }

  return (
    <MessageResponse>
      <Text>
        <Text dimColor>Pushed notification:</Text> {output.message}
        {'  '}
        <Text dimColor>({summary})</Text>
      </Text>
    </MessageResponse>
  )
}
