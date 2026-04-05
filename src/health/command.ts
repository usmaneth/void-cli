/**
 * /health slash command — monitor agent health with heartbeats.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getHealthMonitor } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const mon = getHealthMonitor()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'start') {
    if (mon.isMonitoring()) return { type: 'text', value: 'Health monitoring already active.' }
    mon.startMonitoring()
    return { type: 'text', value: 'Health monitoring started.' }
  }

  if (sub === 'stop') {
    if (!mon.isMonitoring()) return { type: 'text', value: 'Health monitoring not active.' }
    mon.stopMonitoring()
    return { type: 'text', value: 'Health monitoring stopped.' }
  }

  if (sub === 'config') {
    const key = parts[1]
    const val = parts[2]
    if (!key) {
      const cfg = mon.getConfig()
      return { type: 'text', value: `Health Config:\n  heartbeatInterval: ${cfg.heartbeatIntervalMs}ms\n  staleThreshold: ${cfg.staleThresholdMs}ms\n  deadThreshold: ${cfg.deadThresholdMs}ms\n  autoRestart: ${cfg.autoRestart}\n  maxRestarts: ${cfg.maxRestarts}\n  alertOnCrash: ${cfg.alertOnCrash}` }
    }
    if (!val) return { type: 'text', value: 'Usage: /health config <key> <value>' }
    const cfg: Record<string, any> = {}
    if (key === 'autoRestart') cfg.autoRestart = val === 'true'
    else if (key === 'maxRestarts') cfg.maxRestarts = parseInt(val, 10)
    else if (key === 'alertOnCrash') cfg.alertOnCrash = val === 'true'
    else if (key === 'heartbeatInterval') cfg.heartbeatIntervalMs = parseInt(val, 10)
    else if (key === 'staleThreshold') cfg.staleThresholdMs = parseInt(val, 10)
    else if (key === 'deadThreshold') cfg.deadThresholdMs = parseInt(val, 10)
    else return { type: 'text', value: `Unknown key: ${key}` }
    mon.setConfig(cfg)
    return { type: 'text', value: `Updated: ${key} = ${val}` }
  }

  if (sub === 'metrics') {
    const m = mon.getMetrics()
    return { type: 'text', value: `Health Metrics:\n  Avg uptime: ${Math.round(m.avgUptimeMs / 60000)}m\n  Total crashes: ${m.totalCrashes}\n  Total restarts: ${m.totalRestarts}\n  Healthy: ${m.healthyPct.toFixed(0)}%` }
  }

  // If arg is an agent ID, show detail
  if (sub && !['start', 'stop', 'config', 'metrics'].includes(sub)) {
    return { type: 'text', value: mon.formatAgentDetail(sub) }
  }

  // Default: health overview
  const monitoring = mon.isMonitoring() ? '● active' : '○ inactive'
  const overview = mon.getOverview()
  const lines = [
    `Health Monitor: ${monitoring}`,
    `Agents: ${overview.total} (${overview.healthy} healthy, ${overview.degraded} degraded, ${overview.unhealthy} unhealthy, ${overview.dead} dead)`,
    '',
    mon.formatHealthTable(),
  ]
  return { type: 'text', value: lines.join('\n') }
}

const health = {
  type: 'local',
  name: 'health',
  description: 'Monitor agent health with heartbeats and auto-restart',
  argumentHint: '<agent_id|start|stop|config|metrics>',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default health
