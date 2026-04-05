/**
 * Slash command handler for /notify.
 *
 * Subcommands:
 *   /notify              — Show notification status and config
 *   /notify on           — Enable notifications
 *   /notify off          — Disable notifications
 *   /notify test         — Send a test notification
 *   /notify history      — Show notification history
 *   /notify config <key> <value> — Configure settings
 *   /notify clear        — Clear notification history
 */

import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import type { Command } from '../commands.js'
import { getNotificationManager } from './index.js'

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''
  const rest = parts.slice(1)
  const manager = getNotificationManager()

  switch (subcommand) {
    case '':
      return { type: 'text', value: statusOutput() }

    case 'on': {
      manager.enable()
      return { type: 'text', value: 'Desktop notifications enabled.' }
    }

    case 'off': {
      manager.disable()
      return { type: 'text', value: 'Desktop notifications disabled.' }
    }

    case 'test': {
      const entry = manager.notify(
        'Void Test Notification',
        'If you see this, notifications are working!',
        'task_complete',
      )
      if (entry) {
        return { type: 'text', value: 'Test notification sent.' }
      }
      return {
        type: 'text',
        value: 'Notifications are disabled. Run /notify on first.',
      }
    }

    case 'history': {
      const history = manager.getHistory()
      if (history.length === 0) {
        return { type: 'text', value: 'No notification history.' }
      }
      const lines: string[] = [`Notification history (${history.length}):`, '']
      for (const entry of history) {
        const ts = entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z')
        lines.push(`  [${entry.trigger}] ${ts}`)
        lines.push(`    ${entry.title}: ${entry.body}`)
      }
      return { type: 'text', value: lines.join('\n') }
    }

    case 'config': {
      const key = rest[0]?.toLowerCase()
      const value = rest[1]

      if (!key) {
        return { type: 'text', value: configOutput() }
      }

      if (!value) {
        return {
          type: 'text',
          value: `Usage: /notify config <key> <value>\n\nKeys: sound (true|false), minDuration (ms), triggers (comma-separated)`,
        }
      }

      switch (key) {
        case 'sound':
          manager.configure({ sound: value === 'true' })
          return { type: 'text', value: `Sound ${value === 'true' ? 'enabled' : 'disabled'}.` }

        case 'minduration': {
          const ms = parseInt(value, 10)
          if (Number.isNaN(ms) || ms < 0) {
            return { type: 'text', value: 'Invalid duration. Provide a non-negative number in milliseconds.' }
          }
          manager.configure({ minDurationMs: ms })
          return { type: 'text', value: `Minimum duration set to ${ms}ms.` }
        }

        case 'triggers': {
          const triggers = value.split(',').map(t => t.trim())
          manager.configure({ triggers: triggers as any })
          const config = manager.getConfig()
          return { type: 'text', value: `Triggers set to: ${config.triggers.join(', ')}` }
        }

        default:
          return {
            type: 'text',
            value: `Unknown config key "${key}". Valid keys: sound, minDuration, triggers`,
          }
      }
    }

    case 'clear': {
      manager.clearHistory()
      return { type: 'text', value: 'Notification history cleared.' }
    }

    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand "${subcommand}".`,
          '',
          'Usage: /notify <on|off|test|history|config|clear>',
          '',
          '  /notify              Show status and config',
          '  /notify on           Enable notifications',
          '  /notify off          Disable notifications',
          '  /notify test         Send a test notification',
          '  /notify history      Show notification history',
          '  /notify config       Show/update configuration',
          '  /notify clear        Clear notification history',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusOutput(): string {
  const manager = getNotificationManager()
  const config = manager.getConfig()
  const stats = manager.getStats()

  const lines: string[] = [
    `Desktop notifications: ${config.enabled ? 'ON' : 'OFF'}`,
    `  Platform : ${stats.platform}`,
    `  Sound    : ${config.sound ? 'on' : 'off'}`,
    `  Triggers : ${config.triggers.join(', ') || '(none)'}`,
    `  Min delay: ${config.minDurationMs}ms`,
    `  History  : ${stats.totalSent} notification${stats.totalSent !== 1 ? 's' : ''}`,
  ]

  if (stats.lastNotification) {
    lines.push(`  Last sent: ${stats.lastNotification}`)
  }

  return lines.join('\n')
}

function configOutput(): string {
  const config = getNotificationManager().getConfig()
  return [
    'Current notification config:',
    '',
    `  enabled     : ${config.enabled}`,
    `  sound       : ${config.sound}`,
    `  minDuration : ${config.minDurationMs}ms`,
    `  triggers    : ${config.triggers.join(', ')}`,
    '',
    'Update with: /notify config <key> <value>',
    '  Keys: sound (true|false), minDuration (ms), triggers (comma-separated)',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const notify = {
  type: 'local',
  name: 'notify',
  description: 'Desktop notifications for task events',
  argumentHint: '<on|off|test|history|config|clear>',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default notify
