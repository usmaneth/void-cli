import React from 'react'
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { Theme } from '../../utils/theme.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Byline } from './Byline.js'
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js'

type DialogProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  onCancel: () => void
  color?: keyof Theme
  hideInputGuide?: boolean
  hideBorder?: boolean
  inputGuide?: (exitState: ExitState) => React.ReactNode
  isCancelActive?: boolean
}

export function Dialog({
  title,
  subtitle,
  children,
  onCancel,
  color = 'permission',
  hideInputGuide,
  hideBorder,
  inputGuide,
  isCancelActive = true,
}: DialogProps): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings(undefined, undefined, isCancelActive)

  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: isCancelActive,
  })

  const defaultInputGuide = exitState.pending ? (
    <Text>Press {exitState.keyName} again to exit</Text>
  ) : (
    <Byline>
      <KeyboardShortcutHint shortcut="Enter" action="confirm" />
      <ConfigurableShortcutHint
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description="cancel"
      />
    </Byline>
  )

  const content = (
    <Box flexDirection="column" paddingX={hideBorder ? 0 : 2} paddingY={hideBorder ? 0 : 1} width="100%">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={color}>
          {title}
        </Text>
        {subtitle && <Text dimColor>{subtitle}</Text>}
      </Box>
      <Box flexDirection="column" gap={1}>
        {children}
      </Box>
      {!hideInputGuide && (
        <Box marginTop={1}>
          <Text dimColor italic>
            {inputGuide ? inputGuide(exitState) : defaultInputGuide}
          </Text>
        </Box>
      )}
    </Box>
  )

  if (hideBorder) {
    return content
  }

  return (
    <Box
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      alignItems="flex-start"
      alignSelf="flex-start"
    >
      {content}
    </Box>
  )
}
