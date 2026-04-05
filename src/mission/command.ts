/**
 * /mission slash command — Void Mission Control dashboard.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getMissionControlServer } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const server = getMissionControlServer()
  const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''

  if (sub === 'start') {
    if (server.isRunning()) {
      return { type: 'text', value: `Mission Control already running at ${server.getUrl()}` }
    }
    const portArg = args.trim().split(/\s+/)[1]
    const port = portArg ? parseInt(portArg, 10) : 3847
    if (isNaN(port) || port < 1 || port > 65535) {
      return { type: 'text', value: 'Invalid port number.' }
    }
    const { url } = server.start(port)
    server.openBrowser()
    return { type: 'text', value: `Void Mission Control started at ${url}\nDashboard opened in browser.` }
  }

  if (sub === 'stop') {
    if (!server.isRunning()) {
      return { type: 'text', value: 'Mission Control is not running.' }
    }
    server.stop()
    return { type: 'text', value: 'Mission Control stopped.' }
  }

  if (sub === 'open') {
    if (!server.isRunning()) {
      return { type: 'text', value: 'Mission Control is not running. Use /mission start first.' }
    }
    server.openBrowser()
    return { type: 'text', value: `Opened ${server.getUrl()} in browser.` }
  }

  if (sub === 'status') {
    if (!server.isRunning()) {
      return { type: 'text', value: 'Mission Control: offline\nUse /mission start to launch.' }
    }
    const state = server.getState()
    const m = state.metrics
    const lines = [
      `Mission Control: online at ${server.getUrl()}`,
      `WebSocket clients: ${(server as any).clients?.length ?? 0}`,
      `Workstreams: ${m.activeWorkstreams} active`,
      `Agents: ${m.activeAgents} active`,
      `Tasks: ${m.tasksRunning} running, ${m.tasksQueued} queued, ${m.tasksCompleted} completed, ${m.tasksFailed} failed`,
      `Tokens: ${m.totalTokens.toLocaleString()} | Cost: $${m.totalCost.toFixed(2)}`,
      `Uptime: ${Math.floor(m.uptimeMs / 60000)}m`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  // Default: show TUI quick view
  if (server.isRunning()) {
    return { type: 'text', value: server.renderTUI() }
  }

  // Not running — show empty TUI with hint
  const { renderTUI: render, emptyTuiState } = await import('./tui.js')
  const output = render(emptyTuiState())
  return { type: 'text', value: output + '\n\nUse /mission start to launch the web dashboard.' }
}

const mission = {
  type: 'local',
  name: 'mission',
  description: 'Void Mission Control — agent management dashboard',
  argumentHint: '<start|stop|open|status>',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default mission
