import React from 'react';
import { Box, Text } from '../../ink.js';

const VOID_LOGO = `
    ▲                 ▲                 ▲
    │                 │                 │
    │   ▀▄   ▄▀  ▄▀▀▀▄  █  ▄▀▀▀▄    │
    │    ▀▄ ▄▀   █   █  █  █   █    │
    │     ▀█▀    ▀▄▄▄▀  █  ▀▄▄▄▀    │
    │                 │                 │
    ▼                 ▼                 ▼
             ▲  V O I D  ▲
`.trimEnd();

const SEPARATOR_LEFT = '━━━━━━━━━━━━━━━━';
const SEPARATOR_RIGHT = '━━━━━━━━━━━━━━━━';
const SEPARATOR_DIAMOND = '◆';

declare const MACRO: { VERSION: string };

const TIPS = [
  "Tip: Type / to explore available commands",
  "Tip: Use Tab and Shift+Tab to navigate panels",
  "Tip: Press Ctrl+O to expand the focused message",
  "Tip: Type @ to mention files or folders in your prompt",
  "Tip: Void can read images and PDFs directly",
];

export function WelcomeV2() {
  const version = typeof MACRO !== 'undefined' ? MACRO.VERSION : '';
  const randomTip = TIPS[Math.floor(Math.random() * TIPS.length)];

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={2}>
      <Text color="claude" bold>{VOID_LOGO}</Text>
      
      <Box marginTop={1} flexDirection="row">
        <Text bold color="claude">v o i d</Text>
        {version ? <Text dimColor> v{version}</Text> : null}
      </Box>

      <Box marginTop={1} flexDirection="row">
        <Text dimColor>{SEPARATOR_LEFT}</Text>
        <Text color="claude"> {SEPARATOR_DIAMOND} </Text>
        <Text dimColor>{SEPARATOR_RIGHT}</Text>
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor italic>{randomTip}</Text>
      </Box>

      <Box marginTop={2} borderStyle="round" borderColor="promptBorder" paddingX={2} paddingY={1} width={46}>
        <Box flexDirection="column" width="100%">
          <Text bold color="ide" marginBottom={1}>⌨  Essential Shortcuts</Text>
          
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>Command menu</Text>
            <Text color="suggestion" bold>/</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>Mention files</Text>
            <Text color="suggestion" bold>@</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>Navigate layout</Text>
            <Text color="suggestion" bold>Tab / Shift+Tab</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>Expand message</Text>
            <Text color="suggestion" bold>Ctrl+O</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>Exit Void</Text>
            <Text color="suggestion" bold>Ctrl+C</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
