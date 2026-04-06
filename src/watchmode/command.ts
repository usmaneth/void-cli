/**
 * /watch slash command — watch files for AI trigger comments.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getWatchModeManager } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const mgr = getWatchModeManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  // ── start [dir] ──────────────────────────────────────────────────────────
  if (sub === 'start') {
    if (mgr.isWatching()) {
      return { type: 'text', value: 'Watch mode is already running.' }
    }
    const dir = parts[1] ?? process.cwd()
    mgr.start(dir)
    return {
      type: 'text',
      value: `Watch mode started.\nMonitoring: ${dir}\nLooking for AI! and AI? trigger comments.`,
    }
  }

  // ── stop ─────────────────────────────────────────────────────────────────
  if (sub === 'stop') {
    if (!mgr.isWatching()) {
      return { type: 'text', value: 'Watch mode is not running.' }
    }
    mgr.stop()
    return { type: 'text', value: 'Watch mode stopped.' }
  }

  // ── queue ────────────────────────────────────────────────────────────────
  if (sub === 'queue') {
    const queue = mgr.getQueue()
    if (queue.length === 0) {
      return { type: 'text', value: 'Trigger queue is empty.' }
    }
    const lines = ['Pending triggers:', '']
    for (const t of queue) {
      const typeLabel = t.type === 'action' ? 'AI!' : 'AI?'
      const time = new Date(t.timestamp).toLocaleTimeString()
      lines.push(`  ${t.id.slice(0, 8)} [${typeLabel}] ${t.file}:${t.line} — ${t.instruction || '(no instruction)'} (${time})`)
    }
    lines.push('', `${queue.length} trigger(s) pending.`)
    return { type: 'text', value: lines.join('\n') }
  }

  // ── clear ────────────────────────────────────────────────────────────────
  if (sub === 'clear') {
    const count = mgr.getQueue().length
    mgr.clearQueue()
    return { type: 'text', value: `Cleared ${count} trigger(s) from the queue.` }
  }

  // ── ignore <pattern> ────────────────────────────────────────────────────
  if (sub === 'ignore') {
    const pattern = parts[1]
    if (!pattern) {
      const patterns = mgr.getIgnorePatterns()
      const lines = ['Current ignore patterns:', '']
      for (const p of patterns) {
        lines.push(`  ${p}`)
      }
      return { type: 'text', value: lines.join('\n') }
    }
    mgr.addIgnorePattern(pattern)
    return { type: 'text', value: `Added ignore pattern: ${pattern}` }
  }

  // ── stats ────────────────────────────────────────────────────────────────
  if (sub === 'stats') {
    const s = mgr.getStats()
    const lines = [
      'Watch Mode Statistics:',
      `  Watching:            ${s.watching ? 'yes' : 'no'}`,
      `  Files watched:       ${s.filesWatched}`,
      `  Triggers detected:   ${s.triggersDetected}`,
      `  Triggers processed:  ${s.triggersProcessed}`,
      `  Queue depth:         ${mgr.getQueue().length}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  // ── default: show status ─────────────────────────────────────────────────
  const s = mgr.getStats()
  const queueLen = mgr.getQueue().length

  if (!s.watching) {
    return {
      type: 'text',
      value: [
        'Watch mode is not running.',
        '',
        'Usage:',
        '  /watch start [dir]    Start watching (default: cwd)',
        '  /watch stop           Stop watching',
        '  /watch queue          Show pending triggers',
        '  /watch clear          Clear trigger queue',
        '  /watch ignore [pat]   Add/show ignore patterns',
        '  /watch stats          Show statistics',
      ].join('\n'),
    }
  }

  return {
    type: 'text',
    value: [
      'Watch mode is active.',
      `  Files watched:       ${s.filesWatched}`,
      `  Triggers detected:   ${s.triggersDetected}`,
      `  Triggers processed:  ${s.triggersProcessed}`,
      `  Queue depth:         ${queueLen}`,
      '',
      'Subcommands: start, stop, queue, clear, ignore, stats',
    ].join('\n'),
  }
}

const watch = {
  type: 'local',
  name: 'watch',
  description: 'Watch files for AI trigger comments',
  argumentHint: '<start|stop|queue|clear|ignore|stats> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default watch
