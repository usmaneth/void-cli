import * as React from 'react'
import { BLACK_CIRCLE } from '../constants/figures.js'
import { Box, Text } from '../ink.js'
import type { Screen } from '../screens/REPL.js'
import type { NormalizedUserMessage } from '../types/message.js'
import { getUserMessageText } from '../utils/messages.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { MessageResponse } from './MessageResponse.js'

type Props = {
  message: NormalizedUserMessage
  screen: Screen
}

export function CompactSummary({ message, screen }: Props): React.ReactNode {
  const isTranscriptMode = screen === 'transcript'
  const textContent = getUserMessageText(message) || ''
  const metadata = (message as any).summarizeMetadata

  // "Summarize from here" with metadata
  if (metadata) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box
          flexDirection="row"
          borderStyle="round"
          borderColor="subtle"
          paddingX={1}
          paddingY={0}
        >
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color="suggestion">◨</Text>
              <Text bold color="subtle">Summarized conversation</Text>
              {!isTranscriptMode && (
                <Text dimColor>
                  <ConfigurableShortcutHint
                    action="app:toggleTranscript"
                    context="Global"
                    fallback="ctrl+o"
                    description="expand history"
                    parens
                  />
                </Text>
              )}
            </Box>
            {!isTranscriptMode && (
              <Box flexDirection="column" marginLeft={3} marginTop={1}>
                <Text dimColor>
                  Summarized {metadata.messagesSummarized} messages{' '}
                  {metadata.direction === 'up_to'
                    ? 'up to this point'
                    : 'from this point'}
                </Text>
                {metadata.userContext && (
                  <Text dimColor italic>
                    Context: “{metadata.userContext}”
                  </Text>
                )}
              </Box>
            )}
          </Box>
        </Box>
        {isTranscriptMode && (
          <MessageResponse>
            <Text>{textContent}</Text>
          </MessageResponse>
        )}
      </Box>
    )
  }

  // Default compact summary (auto-compact)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="row"
        borderStyle="round"
        borderColor="subtle"
        paddingX={1}
        paddingY={0}
        alignItems="center"
      >
        <Box flexDirection="row" gap={1}>
          <Text color="suggestion">⋯</Text>
          <Text bold color="subtle">
            Compact summary
          </Text>
          {!isTranscriptMode && (
            <Text dimColor>
              {' '}
              <ConfigurableShortcutHint
                action="app:toggleTranscript"
                context="Global"
                fallback="ctrl+o"
                description="expand"
                parens
              />
            </Text>
          )}
        </Box>
      </Box>
      {isTranscriptMode && (
        <MessageResponse>
          <Text>{textContent}</Text>
        </MessageResponse>
      )}
    </Box>
  )
}
