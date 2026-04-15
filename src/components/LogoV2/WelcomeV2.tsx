import React from 'react';
import { Box, Text } from 'src/ink.js';

const VOID_LOGO = `
  ┌─────────────────────────────────┐
  │                                 │
  │   ▀▄   ▄▀  ▄▀▀▀▄  █  ▄▀▀▀▄    │
  │    ▀▄ ▄▀   █   █  █  █   █    │
  │     ▀█▀    ▀▄▄▄▀  █  ▀▄▄▄▀    │
  │                                 │
  │         ░▒▓ V O I D ▓▒░        │
  │                                 │
  └─────────────────────────────────┘
`.trimEnd();

const SEPARATOR_LEFT = '━━━━━━━━━━━━━━━━';
const SEPARATOR_RIGHT = '━━━━━━━━━━━━━━━━';
const SEPARATOR_DIAMOND = '◆';

declare const MACRO: { VERSION: string };

export function WelcomeV2() {
  const version = typeof MACRO !== 'undefined' ? MACRO.VERSION : '';

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={1}>
      <Text color="claude">{VOID_LOGO}</Text>
      <Box marginTop={1}>
        <Text bold color="claude">void</Text>
        {version ? <Text dimColor> v{version}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{SEPARATOR_LEFT}</Text>
        <Text color="claude"> {SEPARATOR_DIAMOND} </Text>
        <Text dimColor>{SEPARATOR_RIGHT}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor italic>your infinite dev agent</Text>
      </Box>
    </Box>
  );
}
