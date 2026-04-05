/**
 * Agent Health Monitor — heartbeats, health checks, auto-restart.
 *
 * Design principles from 10x Core + Rivet:
 * - Health is a first-class concept, not an afterthought
 * - Every agent has observable health state
 * - Auto-recovery reduces human intervention
 * - Full event history for post-mortem analysis
 *
 * Uses only Node.js built-ins.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'dead'

export type HealthEvent = {
  timestamp: string
  event: 'started' | 'heartbeat' | 'degraded' | 'crashed' | 'restarted' | 'recovered' | 'stopped'
  details?: string
}

export type AgentHealth = {
  agentId: string
  name: string
  template?: string
  status: HealthStatus
  lastHeartbeat: string
  uptimeMs: number
  startedAt: string
  crashCount: number
  restartCount: number
  tokenUsage: number
  currentTask?: string
  history: HealthEvent[]
}

export type HealthConfig = {
  heartbeatIntervalMs: number
  staleThresholdMs: number
  deadThresholdMs: number
  autoRestart: boolean
  maxRestarts: number
  alertOnCrash: boolean
}

// ---------------------------------------------------------------------------
// HealthMonitor
// ---------------------------------------------------------------------------

export class HealthMonitor {
  private agents: Map<string, AgentHealth> = new Map()
  private config: HealthConfig = {
    heartbeatIntervalMs: 10000,
    staleThresholdMs: 30000,
    deadThresholdMs: 60000,
    autoRestart: false,
    maxRestarts: 3,
    alertOnCrash: true,
  }
  private monitorTimer: ReturnType<typeof setInterval> | null = null
  private restartCallback: ((agentId: string) => void) | null = null

  // -- Agent registration --

  registerAgent(agentId: string, name: string, template?: string): void {
    const now = new Date().toISOString()
    const health: AgentHealth = {
      agentId,
      name,
      template,
      status: 'healthy',
      lastHeartbeat: now,
      uptimeMs: 0,
      startedAt: now,
      crashCount: 0,
      restartCount: 0,
      tokenUsage: 0,
      history: [{ timestamp: now, event: 'started' }],
    }
    this.agents.set(agentId, health)
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.history.push({ timestamp: new Date().toISOString(), event: 'stopped' })
      agent.status = 'dead'
    }
  }

  // -- Heartbeat --

  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    const now = new Date().toISOString()
    agent.lastHeartbeat = now
    agent.uptimeMs = Date.now() - new Date(agent.startedAt).getTime()

    if (agent.status === 'degraded' || agent.status === 'unhealthy') {
      agent.status = 'healthy'
      agent.history.push({ timestamp: now, event: 'recovered' })
    }
  }

  // -- Health checks --

  getHealth(agentId: string): AgentHealth | undefined {
    return this.agents.get(agentId)
  }

  getAllHealth(): AgentHealth[] {
    return Array.from(this.agents.values())
  }

  getOverview(): { healthy: number; degraded: number; unhealthy: number; dead: number; total: number } {
    const all = this.getAllHealth()
    return {
      healthy: all.filter(a => a.status === 'healthy').length,
      degraded: all.filter(a => a.status === 'degraded').length,
      unhealthy: all.filter(a => a.status === 'unhealthy').length,
      dead: all.filter(a => a.status === 'dead').length,
      total: all.length,
    }
  }

  checkAll(): void {
    const now = Date.now()
    for (const agent of this.agents.values()) {
      if (agent.status === 'dead') continue

      const lastBeat = new Date(agent.lastHeartbeat).getTime()
      const elapsed = now - lastBeat

      if (elapsed > this.config.deadThresholdMs * 2) {
        if ((agent.status as string) !== 'dead') {
          agent.status = 'dead'
          agent.crashCount++
          agent.history.push({ timestamp: new Date().toISOString(), event: 'crashed', details: `No heartbeat for ${Math.round(elapsed / 1000)}s` })
          this.handleCrash(agent)
        }
      } else if (elapsed > this.config.deadThresholdMs) {
        if (agent.status !== 'unhealthy') {
          agent.status = 'unhealthy'
          agent.history.push({ timestamp: new Date().toISOString(), event: 'degraded', details: `No heartbeat for ${Math.round(elapsed / 1000)}s` })
        }
      } else if (elapsed > this.config.staleThresholdMs) {
        if (agent.status === 'healthy') {
          agent.status = 'degraded'
          agent.history.push({ timestamp: new Date().toISOString(), event: 'degraded', details: `Heartbeat delayed ${Math.round(elapsed / 1000)}s` })
        }
      }

      agent.uptimeMs = now - new Date(agent.startedAt).getTime()
    }
  }

  private handleCrash(agent: AgentHealth): void {
    // Alert
    if (this.config.alertOnCrash) {
      try {
        const { getNotificationManager } = require('../notify/index.js')
        getNotificationManager().notify(`Agent crashed: ${agent.name}`, `Agent ${agent.agentId} (${agent.template ?? 'unknown'}) has crashed.`, 'error')
      } catch { /* notification not available */ }
    }

    // Auto-restart
    if (this.config.autoRestart && agent.restartCount < this.config.maxRestarts) {
      agent.restartCount++
      agent.status = 'healthy'
      agent.lastHeartbeat = new Date().toISOString()
      agent.startedAt = new Date().toISOString()
      agent.history.push({ timestamp: new Date().toISOString(), event: 'restarted', details: `Restart #${agent.restartCount}` })
      this.restartCallback?.(agent.agentId)
    }
  }

  // -- Monitoring lifecycle --

  startMonitoring(): void {
    if (this.monitorTimer) return
    this.monitorTimer = setInterval(() => this.checkAll(), this.config.heartbeatIntervalMs)
    this.monitorTimer.unref()
  }

  stopMonitoring(): void {
    if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null }
  }

  isMonitoring(): boolean { return this.monitorTimer !== null }

  onRestart(callback: (agentId: string) => void): void { this.restartCallback = callback }

  // -- Config --

  getConfig(): HealthConfig { return { ...this.config } }
  setConfig(cfg: Partial<HealthConfig>): void { Object.assign(this.config, cfg) }

  // -- History --

  getHistory(agentId: string, limit = 20): HealthEvent[] {
    const agent = this.agents.get(agentId)
    if (!agent) return []
    return agent.history.slice(-limit)
  }

  // -- Metrics --

  getMetrics(): { avgUptimeMs: number; totalCrashes: number; totalRestarts: number; healthyPct: number } {
    const all = this.getAllHealth()
    if (all.length === 0) return { avgUptimeMs: 0, totalCrashes: 0, totalRestarts: 0, healthyPct: 100 }
    return {
      avgUptimeMs: all.reduce((s, a) => s + a.uptimeMs, 0) / all.length,
      totalCrashes: all.reduce((s, a) => s + a.crashCount, 0),
      totalRestarts: all.reduce((s, a) => s + a.restartCount, 0),
      healthyPct: (all.filter(a => a.status === 'healthy').length / all.length) * 100,
    }
  }

  // -- Formatting --

  formatHealthTable(): string {
    const agents = this.getAllHealth()
    if (agents.length === 0) return 'No agents registered.\nUse the health monitor API to register agents.'

    const lines = ['Agent Health Status:', '']
    lines.push('  Agent          Template       Status     Last Beat  Uptime   Crashes')
    lines.push('  ' + '─'.repeat(65))

    for (const a of agents) {
      const icon = a.status === 'healthy' ? '●' : a.status === 'degraded' ? '◐' : a.status === 'unhealthy' ? '◑' : '✗'
      const elapsed = Date.now() - new Date(a.lastHeartbeat).getTime()
      const lastBeat = elapsed < 60000 ? `${Math.round(elapsed / 1000)}s ago` : `${Math.round(elapsed / 60000)}m ago`
      const uptime = a.uptimeMs > 60000 ? `${Math.round(a.uptimeMs / 60000)}m` : `${Math.round(a.uptimeMs / 1000)}s`
      lines.push(`  ${icon} ${a.name.padEnd(14).slice(0, 14)} ${(a.template ?? '--').padEnd(14).slice(0, 14)} ${a.status.padEnd(10)} ${lastBeat.padEnd(10)} ${uptime.padEnd(8)} ${a.crashCount}`)
    }

    return lines.join('\n')
  }

  formatAgentDetail(agentId: string): string {
    const a = this.agents.get(agentId)
    if (!a) return `Agent ${agentId} not found.`

    const lines = [
      `Agent: ${a.name} (${a.agentId})`,
      `Template: ${a.template ?? '--'}`,
      `Status: ${a.status}`,
      `Uptime: ${Math.round(a.uptimeMs / 60000)}m`,
      `Crashes: ${a.crashCount} | Restarts: ${a.restartCount}`,
      `Tokens: ${a.tokenUsage.toLocaleString()}`,
      `Current task: ${a.currentTask ?? '--'}`,
      '',
      'Health History:',
    ]
    for (const ev of a.history.slice(-10)) {
      lines.push(`  [${new Date(ev.timestamp).toLocaleTimeString()}] ${ev.event}${ev.details ? ': ' + ev.details : ''}`)
    }
    return lines.join('\n')
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: HealthMonitor | null = null
export function getHealthMonitor(): HealthMonitor {
  if (!_instance) _instance = new HealthMonitor()
  return _instance
}
