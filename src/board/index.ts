/**
 * Live Task Board — real-time task status with step-level observability.
 *
 * Design principles from 10x Core:
 * - Every step is observable and auditable
 * - Aggregate metrics reveal system health
 * - Timeline provides chronological context
 *
 * Uses only Node.js built-ins.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoardFilter = { workstream?: string; status?: string; agent?: string }

export type BoardEntry = {
  taskId: string
  workstream: string
  instruction: string
  status: string
  agent: string
  steps: number
  completedSteps: number
  tokenUsage: number
  durationMs: number
  startedAt: string
  lastUpdate: string
}

export type TimelineEvent = {
  timestamp: string
  taskId: string
  eventType: 'created' | 'started' | 'step' | 'completed' | 'failed'
  description: string
  agent?: string
  tokenUsage?: number
}

export type BoardMetrics = {
  totalTasks: number
  completed: number
  failed: number
  running: number
  queued: number
  avgCompletionMs: number
  avgTokens: number
  successRate: number
  totalTokens: number
  totalCost: number
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const CYAN = '\x1b[36m'

function statusIcon(s: string): string {
  switch (s) {
    case 'completed': return `${GREEN}✓${RESET}`
    case 'running': return `${YELLOW}→${RESET}`
    case 'failed': return `${RED}✗${RESET}`
    case 'queued': return `${DIM}○${RESET}`
    default: return ' '
  }
}

function truncate(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 1) + '…'
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '--'
  if (ms < 1000) return ms + 'ms'
  return (ms / 1000).toFixed(1) + 's'
}

// ---------------------------------------------------------------------------
// TaskBoard
// ---------------------------------------------------------------------------

export class TaskBoard {
  private entries: BoardEntry[] = []
  private timeline: TimelineEvent[] = []

  // -- Data ingestion --

  setEntries(entries: BoardEntry[]): void { this.entries = entries }
  addEntry(entry: BoardEntry): void { this.entries.push(entry) }

  addTimelineEvent(event: TimelineEvent): void {
    this.timeline.push(event)
    if (this.timeline.length > 500) this.timeline = this.timeline.slice(-500)
  }

  refresh(): void {
    // Pull from task queue if available
    try {
      const { getTaskQueueManager } = require('../taskqueue/index.js')
      const tqm = getTaskQueueManager()
      const tasks = tqm.listTasks()
      this.entries = tasks.map((t: any) => ({
        taskId: t.id,
        workstream: 'default',
        instruction: t.instruction,
        status: t.status,
        agent: '',
        steps: t.steps?.length ?? 0,
        completedSteps: t.steps?.filter((s: any) => s.type === 'tool_result').length ?? 0,
        tokenUsage: t.tokenUsage ?? 0,
        durationMs: t.startedAt && t.completedAt ? new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime() : 0,
        startedAt: t.startedAt ?? t.createdAt ?? '',
        lastUpdate: t.completedAt ?? t.startedAt ?? '',
      }))
    } catch { /* task queue not initialized */ }
  }

  // -- Querying --

  getEntries(filter?: BoardFilter): BoardEntry[] {
    let result = [...this.entries]
    if (filter?.workstream) result = result.filter(e => e.workstream === filter.workstream)
    if (filter?.status) result = result.filter(e => e.status === filter.status)
    if (filter?.agent) result = result.filter(e => e.agent === filter.agent)
    return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  getEntry(taskId: string): BoardEntry | undefined {
    return this.entries.find(e => e.taskId === taskId || e.taskId.startsWith(taskId))
  }

  getTimeline(limit = 50): TimelineEvent[] {
    return this.timeline.slice(-limit).reverse()
  }

  getMetrics(): BoardMetrics {
    const all = this.entries
    const completed = all.filter(e => e.status === 'completed')
    const failed = all.filter(e => e.status === 'failed')
    const running = all.filter(e => e.status === 'running')
    const queued = all.filter(e => e.status === 'queued')
    const totalTokens = all.reduce((s, e) => s + e.tokenUsage, 0)
    const completedDurations = completed.filter(e => e.durationMs > 0)

    return {
      totalTasks: all.length,
      completed: completed.length,
      failed: failed.length,
      running: running.length,
      queued: queued.length,
      avgCompletionMs: completedDurations.length > 0
        ? completedDurations.reduce((s, e) => s + e.durationMs, 0) / completedDurations.length
        : 0,
      avgTokens: completed.length > 0
        ? completed.reduce((s, e) => s + e.tokenUsage, 0) / completed.length
        : 0,
      successRate: (completed.length + failed.length) > 0 ? completed.length / (completed.length + failed.length) * 100 : 0,
      totalTokens,
      totalCost: totalTokens * 0.000003,
    }
  }

  // -- Formatting --

  formatBoard(filter?: BoardFilter): string {
    this.refresh()
    const entries = this.getEntries(filter)
    const m = this.getMetrics()

    const lines: string[] = []
    const W = 66
    const hr = '═'.repeat(W)
    const hrS = '─'.repeat(W)

    lines.push(`${BOLD}${CYAN}╔${hr}╗${RESET}`)
    lines.push(`${BOLD}${CYAN}║${RESET}${BOLD} TASK BOARD${RESET}${' '.repeat(W - 11)}${BOLD}${CYAN}║${RESET}`)
    lines.push(`${BOLD}${CYAN}║${RESET}${hrS}${BOLD}${CYAN}║${RESET}`)

    // Header
    const hdr = ` ${'ID'.padEnd(9)}${'Status'.padEnd(11)}${'Agent'.padEnd(14)}${'Instruction'.padEnd(20)}${'Tok'.padEnd(6)}Time`
    lines.push(`${BOLD}${CYAN}║${RESET}${DIM}${hdr.padEnd(W)}${RESET}${BOLD}${CYAN}║${RESET}`)
    lines.push(`${BOLD}${CYAN}║${RESET}${DIM}${hrS}${RESET}${BOLD}${CYAN}║${RESET}`)

    if (entries.length === 0) {
      lines.push(`${BOLD}${CYAN}║${RESET} ${DIM}No tasks${RESET}${' '.repeat(W - 9)}${BOLD}${CYAN}║${RESET}`)
    }

    for (const e of entries.slice(0, 12)) {
      const icon = statusIcon(e.status)
      const statusText = e.status.slice(0, 8)
      const row = ` ${e.taskId.slice(0, 8).padEnd(9)}${icon} ${statusText.padEnd(8)} ${truncate(e.agent || '--', 12).padEnd(14)}${truncate(e.instruction, 18).padEnd(20)}${formatTokens(e.tokenUsage).padEnd(6)}${formatDuration(e.durationMs)}`
      const rowPlain = row.replace(/\x1b\[[0-9;]*m/g, '')
      lines.push(`${BOLD}${CYAN}║${RESET}${row}${' '.repeat(Math.max(0, W - rowPlain.length))}${BOLD}${CYAN}║${RESET}`)
    }

    lines.push(`${BOLD}${CYAN}║${RESET}${hrS}${BOLD}${CYAN}║${RESET}`)

    // Summary
    const summary = ` ${m.totalTasks} tasks │ ${m.running} running │ ${m.queued} queued │ ${m.completed} done │ ${m.failed} failed`
    lines.push(`${BOLD}${CYAN}║${RESET}${DIM}${summary.padEnd(W)}${RESET}${BOLD}${CYAN}║${RESET}`)
    const summary2 = ` Tokens: ${formatTokens(m.totalTokens)} │ Avg time: ${formatDuration(m.avgCompletionMs)} │ Success: ${m.successRate.toFixed(0)}%`
    lines.push(`${BOLD}${CYAN}║${RESET}${DIM}${summary2.padEnd(W)}${RESET}${BOLD}${CYAN}║${RESET}`)

    lines.push(`${BOLD}${CYAN}╚${hr}╝${RESET}`)
    return lines.join('\n')
  }

  formatTimeline(limit = 20): string {
    const events = this.getTimeline(limit)
    if (events.length === 0) return 'No timeline events.'
    const lines = ['Timeline:', '']
    for (const ev of events) {
      const icon = ev.eventType === 'completed' ? '✓' : ev.eventType === 'failed' ? '✗' : ev.eventType === 'started' ? '→' : '○'
      const time = new Date(ev.timestamp).toLocaleTimeString()
      lines.push(`  ${time} ${icon} [${ev.taskId.slice(0, 6)}] ${ev.description}`)
    }
    return lines.join('\n')
  }

  formatMetrics(): string {
    const m = this.getMetrics()
    return [
      'Board Metrics:',
      `  Total tasks: ${m.totalTasks}`,
      `  Completed: ${m.completed}`,
      `  Failed: ${m.failed}`,
      `  Running: ${m.running}`,
      `  Queued: ${m.queued}`,
      `  Avg completion: ${formatDuration(m.avgCompletionMs)}`,
      `  Avg tokens: ${formatTokens(Math.round(m.avgTokens))}`,
      `  Success rate: ${m.successRate.toFixed(1)}%`,
      `  Total tokens: ${formatTokens(m.totalTokens)}`,
      `  Est. cost: $${m.totalCost.toFixed(4)}`,
    ].join('\n')
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: TaskBoard | null = null
export function getTaskBoard(): TaskBoard {
  if (!_instance) _instance = new TaskBoard()
  return _instance
}
