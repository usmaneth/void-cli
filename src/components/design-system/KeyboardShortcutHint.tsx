import React from 'react'
import Text from '../../ink/components/Text.js'

type Props = {
  key?: React.Key
  /** The key or chord to display (e.g., "ctrl+o", "Enter", "↑/↓") */
  shortcut: string
  /** The action the key performs (e.g., "expand", "select", "navigate") */
  action: string
  /** Whether to wrap the hint in parentheses. Default: false */
  parens?: boolean
  /** Whether to render the shortcut in bold. Default: false */
  bold?: boolean
}

export function KeyboardShortcutHint({
  shortcut,
  action,
  parens = false,
  bold = false,
}: Props): React.ReactNode {
  const shortcutText = (
    <Text color="suggestion" bold>
      {shortcut}
    </Text>
  )

  if (parens) {
    return (
      <Text>
        ({shortcutText} {action})
      </Text>
    )
  }
  return (
    <Text>
      {shortcutText} {action}
    </Text>
  )
}
