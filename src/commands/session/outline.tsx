import * as React from 'react'
import { useCallback } from 'react'
import { SessionOutline } from '../../components/SessionOutline.js'
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

/**
 * Expand collapsed pseudo-messages so the outline reflects the real tool
 * timeline, not the compressed transcript view.
 *
 * The message normalizer stashes the constituent messages on either `children`
 * (grouped_tool_use) or `items` (collapsed_read_search). We duck-type both —
 * sessionOutline itself is duck-typed, so we just forward whatever we find.
 */
function expandCollapsed(msg: unknown): unknown[] | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const anyMsg = msg as {
    children?: unknown[]
    items?: unknown[]
  }
  if (Array.isArray(anyMsg.children)) return anyMsg.children
  if (Array.isArray(anyMsg.items)) return anyMsg.items
  return undefined
}

function OutlineView({ onDone, messages }: Props): React.ReactNode {
  const onJump = useCallback(
    (m: Milestone) => {
      // TODO: wire transcript scroll once the scroll API can accept a
      // message index or uuid. For now, just log and dismiss — the outline
      // still serves as a navigational map even without a live jump.
      logForDebugging(
        `outline: jump requested (${m.kind} #${m.messageIndex} ${m.uuid ?? ''})`,
      )
      onDone()
    },
    [onDone],
  )

  const onClose = useCallback(() => {
    onDone()
  }, [onDone])

  return (
    <SessionOutline
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
  return <OutlineView onDone={onDone} messages={context.messages ?? []} />
}
