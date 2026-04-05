/**
 * Void Mission Control — HTTP server + WebSocket + state aggregator.
 *
 * `void mission start` spins up a local web dashboard at localhost:3847.
 * WebSocket provides real-time state updates. TUI view available via `/mission`.
 * Uses only Node.js built-ins (http, crypto, child_process, os).
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { platform } from 'os'
import { getDashboardHTML } from './dashboard.js'
import { renderTUI, emptyTuiState, type TuiState, type TuiWorkstream, type TuiAgent, type TuiTask } from './tui.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MissionMetrics = {
  totalTokens: number
  totalCost: number
  uptimeMs: number
  tasksCompleted: number
  tasksFailed: number
  tasksRunning: number
  tasksQueued: number
  activeAgents: number
  activeWorkstreams: number
}

export type WorkstreamInfo = {
  id: string
  name: string
  status: string
  instruction: string
  tokenUsage: number
  stepsTotal: number
  stepsCompleted: number
  startedAt: string
}

export type AgentInfo = {
  id: string
  name: string
  template: string
  status: string
  currentTask: string
  tokenUsage: number
  uptime: number
}

export type TaskInfo = {
  id: string
  instruction: string
  status: string
  agent: string
  tokenUsage: number
  durationMs: number
  steps: number
  startedAt: string
}

export type MissionState = {
  workstreams: WorkstreamInfo[]
  tasks: TaskInfo[]
  agents: AgentInfo[]
  metrics: MissionMetrics
}

// ---------------------------------------------------------------------------
// WebSocket helpers (raw, no library)
// ---------------------------------------------------------------------------

interface WsClient {
  socket: import('stream').Duplex
  alive: boolean
}

function computeAcceptKey(key: string): string {
  return createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5FBD5E10A')
    .digest('base64')
}

function encodeWsFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8')
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81 // FIN + text opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

function decodeWsFrame(buf: Buffer): { opcode: number; payload: string } | null {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let payloadLen = buf[1] & 0x7f
  let offset = 2
  if (payloadLen === 126) {
    if (buf.length < 4) return null
    payloadLen = buf.readUInt16BE(2)
    offset = 4
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null
    payloadLen = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  if (masked) {
    if (buf.length < offset + 4 + payloadLen) return null
    const mask = buf.subarray(offset, offset + 4)
    offset += 4
    const data = buf.subarray(offset, offset + payloadLen)
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]
    return { opcode, payload: data.toString('utf8') }
  }
  return { opcode, payload: buf.subarray(offset, offset + payloadLen).toString('utf8') }
}

// ---------------------------------------------------------------------------
// MissionControlServer
// ---------------------------------------------------------------------------

export class MissionControlServer {
  private server: Server | null = null
  private clients: WsClient[] = []
  private broadcastTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private startTime = 0
  private port = 3847

  // -- Lifecycle --

  start(port = 3847): { url: string } {
    if (this.server) throw new Error('Mission Control is already running')
    this.port = port
    this.startTime = Date.now()

    this.server = createServer((req, res) => this.handleHttp(req, res))

    // WebSocket upgrade
    this.server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/ws') { socket.destroy(); return }
      const key = req.headers['sec-websocket-key']
      if (!key) { socket.destroy(); return }
      const accept = computeAcceptKey(key)
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      )
      const client: WsClient = { socket, alive: true }
      this.clients.push(client)

      socket.on('data', (buf: Buffer) => {
        const frame = decodeWsFrame(buf)
        if (!frame) return
        if (frame.opcode === 0x8) { socket.end(); return } // close
        if (frame.opcode === 0xa) { client.alive = true; return } // pong
      })
      socket.on('close', () => {
        this.clients = this.clients.filter(c => c !== client)
      })
      socket.on('error', () => {
        this.clients = this.clients.filter(c => c !== client)
      })

      // Send initial state
      this.sendToClient(client, { type: 'state', data: this.getState() })
    })

    this.server.listen(port, '127.0.0.1')

    // Broadcast state every 1s
    this.broadcastTimer = setInterval(() => {
      this.broadcast({ type: 'state', data: this.getState() })
    }, 1000)
    this.broadcastTimer.unref()

    // Ping every 30s
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) { client.socket.end(); continue }
        client.alive = false
        // Send ping frame
        const ping = Buffer.alloc(2)
        ping[0] = 0x89; ping[1] = 0
        client.socket.write(ping)
      }
    }, 30000)
    this.pingTimer.unref()

    const url = `http://127.0.0.1:${port}`
    return { url }
  }

  stop(): void {
    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    for (const c of this.clients) {
      try { c.socket.end() } catch { /* ignore */ }
    }
    this.clients = []
    if (this.server) { this.server.close(); this.server = null }
  }

  isRunning(): boolean { return this.server !== null }
  getUrl(): string { return `http://127.0.0.1:${this.port}` }
  getPort(): number { return this.port }

  openBrowser(): void {
    const url = this.getUrl()
    try {
      const plat = platform()
      if (plat === 'darwin') execSync(`open "${url}"`)
      else if (plat === 'win32') execSync(`start "${url}"`)
      else execSync(`xdg-open "${url}"`)
    } catch { /* ignore — user can open manually */ }
  }

  // -- HTTP handler --

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/'
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getDashboardHTML(this.port))
      return
    }

    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.getState()))
      return
    }

    if (url === '/api/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.getState().tasks))
      return
    }

    if (url === '/api/agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.getState().agents))
      return
    }

    if (url === '/api/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.getState().metrics))
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }

  // -- WebSocket helpers --

  private sendToClient(client: WsClient, msg: Record<string, unknown>): void {
    try { client.socket.write(encodeWsFrame(JSON.stringify(msg))) } catch { /* ignore */ }
  }

  broadcast(msg: Record<string, unknown>): void {
    const frame = encodeWsFrame(JSON.stringify(msg))
    for (const c of this.clients) {
      try { c.socket.write(frame) } catch { /* ignore */ }
    }
  }

  // -- State aggregation --
  // Design principle from 10x Core: single source of truth, all subsystems report into one state object

  getState(): MissionState {
    // Try to read from workstream manager and task queue if available
    const workstreams: WorkstreamInfo[] = []
    const tasks: TaskInfo[] = []
    const agents: AgentInfo[] = []

    try {
      // Dynamic import would be async; for now use a registry pattern
      const wm = _workstreamProvider?.() ?? []
      for (const ws of wm) workstreams.push(ws)
    } catch { /* not yet initialized */ }

    try {
      const tm = _taskProvider?.() ?? []
      for (const t of tm) tasks.push(t)
    } catch { /* not yet initialized */ }

    try {
      const am = _agentProvider?.() ?? []
      for (const a of am) agents.push(a)
    } catch { /* not yet initialized */ }

    const running = tasks.filter(t => t.status === 'running').length
    const queued = tasks.filter(t => t.status === 'queued').length
    const completed = tasks.filter(t => t.status === 'completed').length
    const failed = tasks.filter(t => t.status === 'failed').length

    return {
      workstreams,
      tasks,
      agents,
      metrics: {
        totalTokens: tasks.reduce((s, t) => s + t.tokenUsage, 0),
        totalCost: tasks.reduce((s, t) => s + t.tokenUsage, 0) * 0.000003, // rough estimate
        uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
        tasksCompleted: completed,
        tasksFailed: failed,
        tasksRunning: running,
        tasksQueued: queued,
        activeAgents: agents.filter(a => a.status === 'active').length,
        activeWorkstreams: workstreams.filter(w => w.status === 'running').length,
      },
    }
  }

  // -- TUI --

  renderTUI(): string {
    const state = this.getState()
    const tuiState: TuiState = {
      workstreams: state.workstreams.map(w => ({ name: w.name, status: w.status as TuiWorkstream['status'] })),
      agents: state.agents.map(a => ({ name: a.name, template: a.template, status: a.status as TuiAgent['status'], tokens: a.tokenUsage })),
      tasks: state.tasks.slice(0, 5).map(t => ({
        id: t.id,
        status: t.status as TuiTask['status'],
        instruction: t.instruction,
        agent: t.agent,
        tokens: t.tokenUsage,
        durationSec: t.durationMs / 1000,
      })),
      metrics: {
        totalTokens: state.metrics.totalTokens,
        totalCost: state.metrics.totalCost,
        uptimeMin: Math.floor(state.metrics.uptimeMs / 60000),
        tasksCompleted: state.metrics.tasksCompleted,
        tasksTotal: state.tasks.length,
      },
    }
    return renderTUI(tuiState)
  }
}

// ---------------------------------------------------------------------------
// Provider registration (10x Core pattern: subsystems register data providers)
// ---------------------------------------------------------------------------

type DataProvider<T> = () => T[]

let _workstreamProvider: DataProvider<WorkstreamInfo> | null = null
let _taskProvider: DataProvider<TaskInfo> | null = null
let _agentProvider: DataProvider<AgentInfo> | null = null

export function registerWorkstreamProvider(fn: DataProvider<WorkstreamInfo>): void { _workstreamProvider = fn }
export function registerTaskProvider(fn: DataProvider<TaskInfo>): void { _taskProvider = fn }
export function registerAgentProvider(fn: DataProvider<AgentInfo>): void { _agentProvider = fn }

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: MissionControlServer | null = null
export function getMissionControlServer(): MissionControlServer {
  if (!_instance) _instance = new MissionControlServer()
  return _instance
}
