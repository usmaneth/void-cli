/**
 * /bg slash command — manage background processes.
 *
 * Subcommands:
 *   /bg                     — list all background processes
 *   /bg start <command>     — start a command in the background
 *   /bg stop <id>           — stop a background process
 *   /bg stopall             — stop all background processes
 *   /bg logs <id> [lines]   — show stdout (default 50 lines)
 *   /bg errors <id>         — show stderr
 *   /bg clean               — remove exited processes
 */

import type { Command, LocalCommandModule } from '../types/command.js'
import type { LocalCommandResult } from '../types/command.js'
import {
  getBackgroundProcessManager,
  type BgProcess,
} from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

function pad(s: string, n: number): string {
  return s.padEnd(n)
}

function formatList(processes: BgProcess[]): string {
  if (processes.length === 0) {
    return 'No background processes.'
  }

  const lines: string[] = [`Background Processes (${processes.length}):`, '']

  // Header
  lines.push(
    `  ${pad('ID', 7)}${pad('PID', 7)}${pad('Status', 9)}${pad('Command', 27)}Started`,
  )

  for (const p of processes) {
    const pidStr = p.pid != null ? String(p.pid) : '--'
    let statusCmd = p.command
    if (p.status === 'exited' && p.exitCode != null) {
      statusCmd = `${p.command} (exit: ${p.exitCode})`
    }
    lines.push(
      `  ${pad(p.id, 7)}${pad(pidStr, 7)}${pad(p.status, 9)}${pad(statusCmd, 27)}${relativeTime(p.startedAt)}`,
    )
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// call()
// ---------------------------------------------------------------------------

const call: LocalCommandModule['call'] = async (
  args: string,
): Promise<LocalCommandResult> => {
  const mgr = getBackgroundProcessManager()
  const trimmed = args.trim()
  const parts = trimmed.split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  // /bg (no args) — list
  if (!sub) {
    return { type: 'text', value: formatList(mgr.list()) }
  }

  // /bg start <command>
  if (sub === 'start') {
    const cmd = trimmed.slice('start'.length).trim()
    if (!cmd) {
      return { type: 'text', value: 'Usage: /bg start <command>' }
    }
    const id = mgr.start(cmd)
    const proc = mgr.getProcess(id)
    const pidStr = proc?.pid != null ? ` (PID ${proc.pid})` : ''
    return {
      type: 'text',
      value: `Started background process ${id}${pidStr}: ${cmd}`,
    }
  }

  // /bg stop <id>
  if (sub === 'stop') {
    const id = parts[1]
    if (!id) {
      return { type: 'text', value: 'Usage: /bg stop <id>' }
    }
    const proc = mgr.getProcess(id)
    if (!proc) {
      return { type: 'text', value: `No process found with id "${id}".` }
    }
    const stopped = await mgr.stop(id)
    return {
      type: 'text',
      value: stopped
        ? `Stopped process ${id}.`
        : `Process ${id} could not be stopped (may have already exited).`,
    }
  }

  // /bg stopall
  if (sub === 'stopall') {
    const running = mgr.list().filter(p => p.status === 'running')
    if (running.length === 0) {
      return { type: 'text', value: 'No running processes to stop.' }
    }
    await mgr.stopAll()
    return {
      type: 'text',
      value: `Stopped ${running.length} process${running.length === 1 ? '' : 'es'}.`,
    }
  }

  // /bg logs <id> [lines]
  if (sub === 'logs') {
    const id = parts[1]
    if (!id) {
      return { type: 'text', value: 'Usage: /bg logs <id> [lines]' }
    }
    const proc = mgr.getProcess(id)
    if (!proc) {
      return { type: 'text', value: `No process found with id "${id}".` }
    }
    const tail = parts[2] ? parseInt(parts[2], 10) : 50
    const lines = mgr.getLogs(id, isNaN(tail) ? 50 : tail)
    if (lines.length === 0) {
      return { type: 'text', value: `No output yet for process ${id}.` }
    }
    return { type: 'text', value: lines.join('\n') }
  }

  // /bg errors <id>
  if (sub === 'errors') {
    const id = parts[1]
    if (!id) {
      return { type: 'text', value: 'Usage: /bg errors <id>' }
    }
    const proc = mgr.getProcess(id)
    if (!proc) {
      return { type: 'text', value: `No process found with id "${id}".` }
    }
    const lines = mgr.getErrors(id)
    if (lines.length === 0) {
      return { type: 'text', value: `No error output for process ${id}.` }
    }
    return { type: 'text', value: lines.join('\n') }
  }

  // /bg clean
  if (sub === 'clean') {
    const removed = mgr.cleanup()
    return {
      type: 'text',
      value:
        removed > 0
          ? `Removed ${removed} exited process${removed === 1 ? '' : 'es'}.`
          : 'No exited processes to clean up.',
    }
  }

  return {
    type: 'text',
    value: [
      `Unknown subcommand: "${sub}"`,
      '',
      'Usage:',
      '  /bg                     — list all background processes',
      '  /bg start <command>     — start a command in the background',
      '  /bg stop <id>           — stop a background process',
      '  /bg stopall             — stop all background processes',
      '  /bg logs <id> [lines]   — show output (default 50 lines)',
      '  /bg errors <id>         — show error output',
      '  /bg clean               — remove exited processes',
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const bg = {
  type: 'local',
  name: 'bg',
  description: 'Manage background processes',
  argumentHint: '<start|stop|stopall|logs|errors|clean> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: async (): Promise<LocalCommandModule> => ({ call }),
} satisfies Command

export default bg
