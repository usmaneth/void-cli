/**
 * /compress slash command for managing the output compression system.
 *
 * Usage:
 *   /compress           — show current compression config
 *   /compress on|off    — toggle compression
 *   /compress strategy <truncate|smart|summary> — set strategy
 *   /compress test <text>  — test compression on given text
 *   /compress stats     — show compression stats from current session
 */

import type { Command, LocalCommandCall } from '../types/command.js'
import {
  getDefaultCompressor,
  OutputCompressor,
  setDefaultCompressor,
} from './index.js'

const call: LocalCommandCall = async (args: string) => {
  const compressor = getDefaultCompressor()
  const trimmed = args.trim()

  // No args: show current config
  if (!trimmed) {
    return { type: 'text', value: formatConfig(compressor) }
  }

  const parts = trimmed.split(/\s+/)
  const subcommand = parts[0]!.toLowerCase()

  switch (subcommand) {
    case 'on': {
      compressor.config.enabled = true
      return { type: 'text', value: 'Output compression enabled.' }
    }

    case 'off': {
      compressor.config.enabled = false
      return { type: 'text', value: 'Output compression disabled.' }
    }

    case 'strategy': {
      const strategy = parts[1]?.toLowerCase()
      if (
        strategy !== 'truncate' &&
        strategy !== 'smart' &&
        strategy !== 'summary'
      ) {
        return {
          type: 'text',
          value:
            'Invalid strategy. Choose one of: truncate, smart, summary.\n' +
            'Usage: /compress strategy <truncate|smart|summary>',
        }
      }
      compressor.config.strategy = strategy
      return {
        type: 'text',
        value: `Compression strategy set to "${strategy}".`,
      }
    }

    case 'test': {
      const text = trimmed.slice('test'.length).trim()
      if (!text) {
        return {
          type: 'text',
          value:
            'No text provided.\nUsage: /compress test <text to compress>',
        }
      }
      // Temporarily ensure compression is enabled for test
      const wasEnabled = compressor.config.enabled
      compressor.config.enabled = true
      const result = compressor.compress(text)
      compressor.config.enabled = wasEnabled

      const lines = [
        '=== Compression Test ===',
        `Strategy: ${result.strategy}`,
        `Original lines: ${result.originalLines}`,
        `Compressed lines: ${result.compressedLines}`,
        `Estimated tokens: ${result.tokensEstimate}`,
        `Was compressed: ${result.wasCompressed}`,
        '--- Output ---',
        result.content,
        '=== End ===',
      ]
      return { type: 'text', value: lines.join('\n') }
    }

    case 'stats': {
      const stats = compressor.getStats()
      const lines = [
        '=== Compression Stats ===',
        `Total compressions: ${stats.totalCalls}`,
        `Total lines in: ${stats.totalLinesIn}`,
        `Total lines out: ${stats.totalLinesOut}`,
        `Lines saved: ${stats.totalLinesIn - stats.totalLinesOut}`,
        `Tokens saved: ${stats.totalTokensSaved}`,
      ]

      const strategies = Object.entries(stats.byStrategy)
      if (strategies.length > 0) {
        lines.push('', 'By strategy:')
        for (const [name, count] of strategies) {
          lines.push(`  ${name}: ${count} uses`)
        }
      }

      if (stats.totalCalls > 0) {
        const ratio = (
          (1 - stats.totalLinesOut / stats.totalLinesIn) *
          100
        ).toFixed(1)
        lines.push('', `Average reduction: ${ratio}%`)
      }

      lines.push('=== End Stats ===')
      return { type: 'text', value: lines.join('\n') }
    }

    case 'reset': {
      const fresh = new OutputCompressor()
      setDefaultCompressor(fresh)
      return { type: 'text', value: 'Compression config and stats reset to defaults.' }
    }

    default: {
      return {
        type: 'text',
        value: [
          `Unknown subcommand: "${subcommand}"`,
          '',
          'Usage:',
          '  /compress           — show current config',
          '  /compress on|off    — toggle compression',
          '  /compress strategy <truncate|smart|summary>',
          '  /compress test <text>',
          '  /compress stats     — show session stats',
          '  /compress reset     — reset to defaults',
        ].join('\n'),
      }
    }
  }
}

function formatConfig(compressor: OutputCompressor): string {
  const c = compressor.config
  return [
    '=== Compression Config ===',
    `Enabled:            ${c.enabled}`,
    `Strategy:           ${c.strategy}`,
    `Max output lines:   ${c.maxOutputLines}`,
    `Max output tokens:  ${c.maxOutputTokens}`,
    `Preserve errors:    ${c.preserveErrors}`,
    `Preserve structure: ${c.preserveStructure}`,
    '=== End Config ===',
  ].join('\n')
}

const compress = {
  type: 'local',
  name: 'compress',
  description: 'Manage LM-optimized output compression settings',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default compress
