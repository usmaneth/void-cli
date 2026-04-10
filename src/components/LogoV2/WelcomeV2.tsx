import React from 'react';
import { Box, Text } from 'src/ink.js';

const VOID_LOGO = `
 ╔══════════════════════════════╗
 ║  ░▒▓  V · O · I · D  ▓▒░   ║
 ╚══════════════════════════════╝
`.trimEnd();

const SEPARATOR = '─'.repeat(40);

declare const MACRO: { VERSION: string };

export function WelcomeV2() {
  const version = typeof MACRO !== 'undefined' ? MACRO.VERSION : '';

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={1}>
      <Text color="cyan">{VOID_LOGO}</Text>
      <Box marginTop={1}>
        <Text bold>Welcome to Void</Text>
        {version ? <Text dimColor> v{version}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{SEPARATOR}</Text>
      </Box>
    </Box>
  );
}
