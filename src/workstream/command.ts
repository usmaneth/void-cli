/**
 * /workstream slash command — manage concurrent agent workstreams.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getWorkstreamManager } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const mgr = getWorkstreamManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'new' || sub === 'create') {
    const name = parts[1]
    if (!name) return { type: 'text', value: 'Usage: /workstream new <name> <instruction>' }
    const instruction = parts.slice(2).join(' ')
    if (!instruction) return { type: 'text', value: 'Usage: /workstream new <name> <instruction>' }
    const ws = mgr.create(name, instruction)
    return { type: 'text', value: `Workstream "${ws.name}" created (${ws.id})\nStatus: ${ws.status}\nInstruction: ${ws.instruction}` }
  }

  if (sub === 'list') {
    const all = mgr.list()
    if (all.length === 0) return { type: 'text', value: 'No workstreams. Use /workstream new <name> <instruction> to create one.' }
    const focused = mgr.getFocused()
    const lines = ['Workstreams:', '']
    lines.push('  ID     Name           Status     Steps       Tokens')
    lines.push('  ' + '─'.repeat(55))
    for (const ws of all) {
      const focus = focused?.id === ws.id ? '→' : ' '
      const stepsTotal = ws.steps.length
      const stepsDone = ws.steps.filter(s => s.status === 'completed').length
      lines.push(`${focus} ${ws.id.slice(0, 6)} ${ws.name.padEnd(14).slice(0, 14)} ${ws.status.padEnd(10)} ${stepsDone}/${stepsTotal}`.padEnd(47) + ` ${ws.tokenUsage.toLocaleString()}`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'switch') {
    const id = parts[1]
    if (!id) return { type: 'text', value: 'Usage: /workstream switch <id>' }
    try { mgr.switchFocus(id); return { type: 'text', value: `Switched focus to workstream ${id}` } }
    catch (e: any) { return { type: 'text', value: e.message } }
  }

  if (sub === 'pause') {
    const id = parts[1]
    if (!id) return { type: 'text', value: 'Usage: /workstream pause <id>' }
    try { mgr.pause(id); return { type: 'text', value: `Workstream ${id} paused.` } }
    catch (e: any) { return { type: 'text', value: e.message } }
  }

  if (sub === 'resume') {
    const id = parts[1]
    if (!id) return { type: 'text', value: 'Usage: /workstream resume <id>' }
    try { mgr.resume(id); return { type: 'text', value: `Workstream ${id} resumed.` } }
    catch (e: any) { return { type: 'text', value: e.message } }
  }

  if (sub === 'kill') {
    const id = parts[1]
    if (!id) return { type: 'text', value: 'Usage: /workstream kill <id>' }
    try { mgr.kill(id); return { type: 'text', value: `Workstream ${id} killed.` } }
    catch (e: any) { return { type: 'text', value: e.message } }
  }

  if (sub === 'logs') {
    const id = parts[1]
    if (!id) return { type: 'text', value: 'Usage: /workstream logs <id> [lines]' }
    const tail = parts[2] ? parseInt(parts[2], 10) : 20
    try {
      const logs = mgr.getLogs(id, tail)
      if (logs.length === 0) return { type: 'text', value: `No logs for workstream ${id}` }
      return { type: 'text', value: logs.map(s => `  [${s.status}] ${s.description}`).join('\n') }
    } catch (e: any) { return { type: 'text', value: e.message } }
  }

  if (sub === 'status') {
    const stats = mgr.getStatus()
    return { type: 'text', value: `Workstream Status:\n  Running: ${stats.running}\n  Paused: ${stats.paused}\n  Completed: ${stats.completed}\n  Failed: ${stats.failed}\n  Total: ${stats.running + stats.paused + stats.completed + stats.failed}` }
  }

  if (sub === 'config') {
    const key = parts[1]
    const val = parts[2]
    if (!key) {
      const cfg = mgr.getConfig()
      return { type: 'text', value: `Workstream Config:\n  maxConcurrent: ${cfg.maxConcurrent}\n  isolateGit: ${cfg.isolateGit}\n  autoBranch: ${cfg.autoBranch}` }
    }
    if (!val) return { type: 'text', value: `Usage: /workstream config <key> <value>` }
    const cfg = mgr.getConfig()
    if (key === 'maxConcurrent') cfg.maxConcurrent = parseInt(val, 10)
    else if (key === 'isolateGit') cfg.isolateGit = val === 'true'
    else if (key === 'autoBranch') cfg.autoBranch = val === 'true'
    else return { type: 'text', value: `Unknown config key: ${key}` }
    mgr.setConfig(cfg)
    return { type: 'text', value: `Config updated: ${key} = ${val}` }
  }

  // Default: overview
  const all = mgr.list()
  if (all.length === 0) return { type: 'text', value: 'No active workstreams.\nUse /workstream new <name> <instruction> to create one.' }
  const stats = mgr.getStatus()
  const lines = [
    `Workstreams: ${all.length} total (${stats.running} running, ${stats.paused} paused)`,
    '',
  ]
  for (const ws of all.slice(0, 5)) {
    const icon = ws.status === 'running' ? '●' : ws.status === 'paused' ? '◐' : ws.status === 'completed' ? '○' : '✗'
    lines.push(`  ${icon} ${ws.name} (${ws.id.slice(0, 6)}) — ${ws.status}`)
  }
  if (all.length > 5) lines.push(`  ... and ${all.length - 5} more`)
  return { type: 'text', value: lines.join('\n') }
}

const workstream = {
  type: 'local',
  name: 'workstream',
  description: 'Manage concurrent agent workstreams',
  argumentHint: '<new|list|switch|pause|resume|kill|logs|status|config> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default workstream
