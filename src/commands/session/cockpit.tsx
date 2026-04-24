import * as React from 'react'
import { useCallback } from 'react'
import { SessionCockpit } from '../../components/SessionCockpit.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type { Message } from '../../types/message.js'
import type { Milestone } from '../../utils/sessionOutline.js'
import { logForDebugging } from '../../utils/debug.js'

type Props = {
  onDone: LocalJSXCommandOnDone
  messages: readonly Message[]
}

function expandCollapsed(msg: unknown): unknown[] | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const anyMsg = msg as { children?: unknown[]; items?: unknown[] }
  if (Array.isArray(anyMsg.children)) return anyMsg.children
  if (Array.isArray(anyMsg.items)) return anyMsg.items
  return undefined
}

function CockpitView({ onDone, messages }: Props): React.ReactNode {
  const onJump = useCallback(
    (m: Milestone) => {
      logForDebugging(
        `cockpit: jump requested (${m.kind} #${m.messageIndex} ${m.uuid ?? ''})`,
      )
      onDone()
    },
    [onDone],
  )
  const onClose = useCallback(() => onDone(), [onDone])

  return (
    <SessionCockpit
      messages={messages}
      onJump={onJump}
      onClose={onClose}
      expandCollapsed={expandCollapsed}
    />
  )
}

export const call: LocalJSXCommandCall = async (
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> => {
  return <CockpitView onDone={onDone} messages={context.messages ?? []} />
}
