/**
 * ContextualSpinner — a wrapper around the loading state that adds
 * tool-type-specific context messages during tool execution.
 */
import * as React from 'react'
import { memo } from 'react'
import { Box, Text, useTheme } from '../ink.js'
import { resolveToolCardType, type ToolCardType } from './ToolCard.js'
import { CategorySpinner } from './ambientMotion/index.js'
import type { MotionCategory } from './ambientMotion/index.js'

function resolveMotionCategory(toolName: string): MotionCategory | undefined {
  switch (toolName) {
    case 'Bash':
      return 'bash'
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'Glob':
    case 'Grep':
      return 'fileEdit'
    case 'Agent':
      return 'subagent'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    default:
      return undefined
  }
}

const TOOL_MESSAGES: Record<string, string> = {
  Bash: 'Running command...',
  Edit: 'Editing file...',
  Read: 'Reading file...',
  Write: 'Writing file...',
  Glob: 'Searching files...',
  Grep: 'Searching content...',
  Agent: 'Delegating to agent...',
  WebFetch: 'Fetching page...',
  WebSearch: 'Searching web...',
}

/**
 * Returns a contextual loading message for a given tool invocation.
 *
 * @param toolName - The name of the tool being executed
 * @param input - Optional tool input parameters used to extract a summary target
 * @returns A human-readable loading message, optionally including the target
 */
export function getToolContextMessage(
  toolName: string,
  input?: Record<string, any>,
): string {
  const message = TOOL_MESSAGES[toolName] ?? 'Working...'
  const target = extractTarget(toolName, input)
  if (target) {
    return `${message} ${target}`
  }
  return message
}

/**
 * Extracts a short summary target from tool input (e.g., file path or command).
 */
function extractTarget(
  toolName: string,
  input?: Record<string, any>,
): string | undefined {
  if (!input) return undefined

  switch (toolName) {
    case 'Bash':
      return input.command ? truncate(String(input.command), 60) : undefined
    case 'Edit':
    case 'Read':
    case 'Write':
      return input.file_path ? String(input.file_path) : undefined
    case 'Glob':
      return input.pattern ? String(input.pattern) : undefined
    case 'Grep':
      return input.pattern ? String(input.pattern) : undefined
    case 'Agent':
      return input.prompt ? truncate(String(input.prompt), 60) : undefined
    case 'WebFetch':
      return input.url ? truncate(String(input.url), 80) : undefined
    case 'WebSearch':
      return input.query ? truncate(String(input.query), 60) : undefined
    default:
      return undefined
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

type ContextualSpinnerProps = {
  toolName: string
  input?: Record<string, any>
  isActive: boolean
}

function ContextualSpinnerImpl({
  toolName,
  input,
  isActive,
}: ContextualSpinnerProps): React.ReactNode {
  const [theme] = useTheme()

  if (!isActive) {
    return null
  }

  const message = TOOL_MESSAGES[toolName] ?? 'Working...'
  const target = extractTarget(toolName, input)
  const category = resolveMotionCategory(toolName)

  return (
    <Box>
      {category ? <CategorySpinner category={category} /> : <Text dimColor>⟳</Text>}
      <Text dimColor>{' ' + message}</Text>
      {target && (
        <>
          <Text> </Text>
          <Text>{target}</Text>
        </>
      )}
    </Box>
  )
}

export const ContextualSpinner = memo(ContextualSpinnerImpl)
