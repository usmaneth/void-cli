/**
 * Void Mission Control — Compact TUI renderer.
 * Renders a terminal-friendly dashboard using ANSI escape codes and box drawing.
 */

// ANSI helpers
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const CYAN = '\x1b[36m'
const WHITE = '\x1b[37m'

// ---------------------------------------------------------------------------
// Types (lightweight view models)
// ---------------------------------------------------------------------------

export type TuiWorkstream = {
  name: string
  status: 'running' | 'paused' | 'completed' | 'failed'
}

export type TuiAgent = {
  name: string
  template?: string
  status: 'active' | 'idle' | 'dead'
  tokens: number
}

export type TuiTask = {
  id: string
  status: 'completed' | 'running' | 'failed' | 'queued'
  instruction: string
  agent: string
  tokens: number
  durationSec: number
}

export type TuiMetrics = {
  totalTokens: number
  totalCost: number
  uptimeMin: number
  tasksCompleted: number
  tasksTotal: number
}

export type TuiState = {
  workstreams: TuiWorkstream[]
  agents: TuiAgent[]
  tasks: TuiTask[]
  metrics: TuiMetrics
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusIcon(s: string): string {
  switch (s) {
    case 'running': case 'active': return `${GREEN}●${RESET}`
    case 'paused': return `${YELLOW}◐${RESET}`
    case 'completed': case 'idle': return `${DIM}○${RESET}`
    case 'failed': case 'dead': return `${RED}✗${RESET}`
    case 'queued': return `${BLUE}◌${RESET}`
    default: return `${DIM}?${RESET}`
  }
}

function taskStatusIcon(s: string): string {
  switch (s) {
    case 'completed': return `${GREEN}✓${RESET}`
    case 'running': return `${YELLOW}→${RESET}`
    case 'failed': return `${RED}✗${RESET}`
    case 'queued': return `${DIM}○${RESET}`
    default: return ' '
  }
}

function pad(str: string, len: number): string {
  // Strip ANSI for length measurement
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '')
  if (plain.length >= len) return str
  return str + ' '.repeat(len - plain.length)
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + '…'
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

const W = 62 // inner width

export function renderTUI(state: TuiState): string {
  const lines: string[] = []
  const hr = '═'.repeat(W)
  const hrSingle = '─'.repeat(W)

  // Header
  lines.push(`${BOLD}${CYAN}╔${hr}╗${RESET}`)
  const title = 'VOID MISSION CONTROL'
  const pad1 = Math.floor((W - title.length) / 2)
  const pad2 = W - title.length - pad1
  lines.push(`${BOLD}${CYAN}║${RESET}${' '.repeat(pad1)}${BOLD}${WHITE}${title}${RESET}${' '.repeat(pad2)}${BOLD}${CYAN}║${RESET}`)
  lines.push(`${BOLD}${CYAN}║${RESET}${hrSingle}${BOLD}${CYAN}║${RESET}`)

  // Workstreams + Agents side by side
  const mid = 28
  const rightW = W - mid - 3

  const wsLabel = ` Workstreams (${state.workstreams.length})`
  const agLabel = `Agents (${state.agents.length})`
  lines.push(`${BOLD}${CYAN}║${RESET} ${BOLD}${pad(wsLabel, mid)}${RESET}${DIM}│${RESET} ${BOLD}${pad(agLabel, rightW)}${RESET} ${BOLD}${CYAN}║${RESET}`)

  const maxRows = Math.max(state.workstreams.length, state.agents.length, 3)
  for (let i = 0; i < maxRows; i++) {
    let left = ''
    if (i < state.workstreams.length) {
      const ws = state.workstreams[i]
      left = ` ${statusIcon(ws.status)} ${pad(truncate(ws.name, 12), 12)} ${pad(ws.status, 10)}`
    }
    const leftPlain = left.replace(/\x1b\[[0-9;]*m/g, '')
    const leftPadded = left + ' '.repeat(Math.max(0, mid - leftPlain.length))

    let right = ''
    if (i < state.agents.length) {
      const ag = state.agents[i]
      right = `${statusIcon(ag.status)} ${pad(truncate(ag.name, 12), 12)} ${pad(ag.status, 7)} ${formatTokens(ag.tokens)} tok`
    }
    const rightPlain = right.replace(/\x1b\[[0-9;]*m/g, '')
    const rightPadded = right + ' '.repeat(Math.max(0, rightW - rightPlain.length))

    lines.push(`${BOLD}${CYAN}║${RESET} ${leftPadded}${DIM}│${RESET} ${rightPadded} ${BOLD}${CYAN}║${RESET}`)
  }

  // Divider
  lines.push(`${BOLD}${CYAN}║${RESET}${hrSingle}${BOLD}${CYAN}║${RESET}`)

  // Recent Tasks
  lines.push(`${BOLD}${CYAN}║${RESET} ${BOLD}Recent Tasks${RESET}${' '.repeat(W - 13)}${BOLD}${CYAN}║${RESET}`)

  const taskRows = state.tasks.slice(0, 5)
  if (taskRows.length === 0) {
    lines.push(`${BOLD}${CYAN}║${RESET} ${DIM}No tasks yet${RESET}${' '.repeat(W - 13)}${BOLD}${CYAN}║${RESET}`)
  }
  for (const t of taskRows) {
    const icon = taskStatusIcon(t.status)
    const instr = truncate(t.instruction, 24)
    const ag = truncate(t.agent || '--', 12)
    const tok = t.tokens > 0 ? formatTokens(t.tokens) + ' tok' : '--'
    const dur = t.durationSec > 0 ? t.durationSec.toFixed(0) + 's' : '--'
    const row = ` ${t.id.slice(0, 4)} ${icon} ${pad(instr, 24)} ${pad(ag, 12)} ${pad(tok, 8)} ${dur}`
    const rowPlain = row.replace(/\x1b\[[0-9;]*m/g, '')
    lines.push(`${BOLD}${CYAN}║${RESET}${row}${' '.repeat(Math.max(0, W - rowPlain.length))}${BOLD}${CYAN}║${RESET}`)
  }

  // Bottom divider
  lines.push(`${BOLD}${CYAN}║${RESET}${hrSingle}${BOLD}${CYAN}║${RESET}`)

  // Metrics footer
  const m = state.metrics
  const mLine = ` Tokens: ${formatTokens(m.totalTokens)} │ Cost: $${m.totalCost.toFixed(2)} │ Uptime: ${m.uptimeMin}m │ Tasks: ${m.tasksCompleted}/${m.tasksTotal}`
  const mPlain = mLine.replace(/\x1b\[[0-9;]*m/g, '')
  lines.push(`${BOLD}${CYAN}║${RESET}${DIM}${mLine}${' '.repeat(Math.max(0, W - mPlain.length))}${RESET}${BOLD}${CYAN}║${RESET}`)

  // Footer
  lines.push(`${BOLD}${CYAN}╚${hr}╝${RESET}`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Empty state factory
// ---------------------------------------------------------------------------

export function emptyTuiState(): TuiState {
  return {
    workstreams: [],
    agents: [],
    tasks: [],
    metrics: { totalTokens: 0, totalCost: 0, uptimeMin: 0, tasksCompleted: 0, tasksTotal: 0 },
  }
}
