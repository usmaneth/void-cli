import * as React from 'react'
import { useEffect, useState } from 'react'
import { Pane } from '../../components/design-system/Pane.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  buildHandoff,
  type HandoffSummary,
} from './handoffData.js'

type Props = {
  onDone: LocalJSXCommandOnDone
  messages: Message[]
}

function renderFileList(
  files: HandoffSummary['changedFiles'],
  max = 10,
): React.ReactNode {
  if (files.length === 0) {
    return <Text dimColor>(none)</Text>
  }
  const shown = files.slice(0, max)
  const remaining = files.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map((f, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text dimColor>{f.status}</Text>
          <Text>{f.path}</Text>
        </Box>
      ))}
      {remaining > 0 ? (
        <Text dimColor>… and {remaining} more</Text>
      ) : null}
    </Box>
  )
}

function renderStringList(
  items: readonly string[],
  emptyText: string,
  max = 8,
): React.ReactNode {
  if (items.length === 0) {
    return <Text dimColor>{emptyText}</Text>
  }
  const shown = items.slice(0, max)
  const remaining = items.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map((item, i) => (
        <Text key={i}>• {item}</Text>
      ))}
      {remaining > 0 ? (
        <Text dimColor>… and {remaining} more</Text>
      ) : null}
    </Box>
  )
}

function HandoffView({ onDone, messages }: Props): React.ReactNode {
  const [summary, setSummary] = useState<HandoffSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    buildHandoff(messages)
      .then(result => {
        if (!cancelled) setSummary(result)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          logForDebugging('Handoff build failed', err)
        }
      })
    return () => {
      cancelled = true
    }
  }, [messages])

  useKeybinding('confirm:no', () => onDone(), { context: 'Confirmation' })

  if (error) {
    return (
      <Pane color="warning">
        <Text color="warning">Could not build session handoff.</Text>
        <Text dimColor>{error}</Text>
        <Text dimColor>(press esc to close)</Text>
      </Pane>
    )
  }

  if (!summary) {
    return (
      <Pane>
        <Text dimColor>Building session handoff…</Text>
      </Pane>
    )
  }

  const usedGitFallback = summary.filesSource === 'git-status'

  return (
    <Pane>
      <Box marginBottom={1}>
        <Text bold>Session handoff</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="ide">
          Changed files
          {usedGitFallback ? ' (from git status)' : ''}
        </Text>
        {renderFileList(summary.changedFiles)}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="ide">
          Tests & validation commands
        </Text>
        {renderStringList(
          summary.validationCommands,
          'No tests or validation commands observed this session.',
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="warning">
          Unresolved risks / placeholders
        </Text>
        {renderStringList(
          summary.unresolvedRisks,
          'No TODO/FIXME/XXX markers flagged.',
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="permission">
          Suggested next actions
        </Text>
        {renderStringList(
          summary.suggestedNextActions,
          'No follow-ups identified.',
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>(press esc to close)</Text>
      </Box>
    </Pane>
  )
}

export const call: LocalJSXCommandCall = async (
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> => {
  return <HandoffView onDone={onDone} messages={context.messages ?? []} />
}
