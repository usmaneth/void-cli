/**
 * /contextsync slash command — shared workspace context materialization.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getContextSyncManager, type ContextFileType } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const mgr = getContextSyncManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'status') {
    const files = mgr.getStatus()
    const lines = ['Context Sync Status:', '']
    for (const f of files) {
      const fresh = f.generatedAt ? (mgr.isStale(f.type) ? '⚠ stale' : '✓ fresh') : '○ not generated'
      const size = f.sizeBytes > 0 ? `${(f.sizeBytes / 1024).toFixed(1)}KB` : '--'
      const age = f.generatedAt ? timeSince(new Date(f.generatedAt)) : '--'
      lines.push(`  ${fresh.padEnd(14)} ${f.type.padEnd(18)} ${size.padEnd(8)} ${age}`)
    }
    const cfg = mgr.getConfig()
    lines.push('', `Auto-refresh: ${cfg.autoRefresh ? 'on' : 'off'} (every ${cfg.refreshIntervalMs / 1000}s)`)
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'refresh') {
    const fileType = parts[1] as ContextFileType | undefined
    if (fileType) {
      const valid = ['repo-structure', 'recent-changes', 'open-issues', 'test-status', 'dependencies', 'error-log', 'agent-notes']
      if (!valid.includes(fileType)) return { type: 'text', value: `Unknown type: ${fileType}\nValid: ${valid.join(', ')}` }
      mgr.syncFile(fileType)
      return { type: 'text', value: `Refreshed: ${fileType}` }
    }
    const files = mgr.sync()
    return { type: 'text', value: `Synced ${files.length} context files.` }
  }

  if (sub === 'auto') {
    const toggle = parts[1]?.toLowerCase()
    if (toggle === 'on') { mgr.enableAutoRefresh(); return { type: 'text', value: 'Auto-refresh enabled.' } }
    if (toggle === 'off') { mgr.disableAutoRefresh(); return { type: 'text', value: 'Auto-refresh disabled.' } }
    return { type: 'text', value: `Usage: /contextsync auto <on|off>` }
  }

  if (sub === 'notes') {
    return { type: 'text', value: mgr.getNotes() }
  }

  if (sub === 'note') {
    const note = parts.slice(1).join(' ')
    if (!note) return { type: 'text', value: 'Usage: /contextsync note <text>' }
    mgr.addNote('user', note)
    return { type: 'text', value: 'Note added.' }
  }

  if (sub === 'clear') {
    mgr.cleanup()
    return { type: 'text', value: 'All context files cleared.' }
  }

  if (sub === 'read') {
    const fileType = parts[1] as ContextFileType | undefined
    if (!fileType) return { type: 'text', value: 'Usage: /contextsync read <type>' }
    return { type: 'text', value: mgr.getFile(fileType) }
  }

  // Default: sync all and show status
  mgr.sync()
  const files = mgr.getStatus()
  const lines = ['Context synced. Files:', '']
  for (const f of files) {
    const size = f.sizeBytes > 0 ? `${(f.sizeBytes / 1024).toFixed(1)}KB` : '--'
    lines.push(`  ✓ ${f.type.padEnd(18)} ${size}`)
  }
  return { type: 'text', value: lines.join('\n') }
}

function timeSince(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const contextsync = {
  type: 'local',
  name: 'contextsync',
  description: 'Shared workspace context materialization for agents',
  argumentHint: '<status|refresh|auto|notes|note|read|clear> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default contextsync
