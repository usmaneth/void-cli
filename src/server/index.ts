/**
 * Headless HTTP server mode for CI/CD integration.
 *
 * Exposes a JSON-over-HTTP API backed by Node.js built-in `node:http`.
 * All AI chat/review handlers are intentionally stubbed — the real
 * integration with the model pipeline would need deeper wiring.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Server } from 'node:http'
import { URL } from 'node:url'
import { hostname } from 'node:os'
import { type ChatAdapter, echoChatAdapter } from './chatAdapter.js'
import { MOBILE_CLIENT_HTML } from './mobileClient.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ServerConfig {
  /** TCP port to listen on. @default 3456 */
  port: number
  /** Bind address. Defaults to localhost-only for security. @default '127.0.0.1' */
  host: string
  /** Optional Bearer token required on every request. */
  apiKey?: string
  /** Max concurrent in-flight requests. @default 3 */
  maxConcurrent: number
  /** Per-request timeout in milliseconds. @default 300_000 (5 min) */
  timeout: number
  /**
   * When true, serves the mobile web client at `/m` and enables the
   * streaming `/chat/stream` endpoint. The caller is expected to also set
   * `apiKey` (pairing token) and bind to `0.0.0.0` so phones on the LAN
   * can reach it.
   */
  mobile?: boolean
  /** Chat pipeline adapter. Defaults to {@link echoChatAdapter}. */
  chatAdapter?: ChatAdapter
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 3456,
  host: '127.0.0.1',
  apiKey: undefined,
  maxConcurrent: 3,
  timeout: 300_000,
  mobile: false,
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

export interface ChatRequest {
  message: string
  sessionId?: string
  model?: string
  cwd?: string
  stream?: boolean
}

export interface ChatResponse {
  sessionId: string
  response: string
  tokensUsed: { input: number; output: number }
  toolCalls: Array<{ name: string; input: string; output: string }>
  duration: number
}

export interface ReviewRequest {
  diff: string
  context?: string
  model?: string
}

export interface ReviewResponse {
  summary: string
  issues: Array<{
    severity: 'error' | 'warning' | 'info'
    file: string
    line?: number
    message: string
  }>
  suggestions: string[]
  approved: boolean
}

export interface ServerStatus {
  version: string
  uptime: number
  activeSessions: number
  totalRequests: number
  models: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a JSON body from an IncomingMessage. Rejects on malformed JSON. */
export function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        reject(new HttpError(400, 'Request body is empty'))
        return
      }
      try {
        resolve(JSON.parse(raw) as T)
      } catch {
        reject(new HttpError(400, 'Invalid JSON in request body'))
      }
    })
    req.on('error', (err) => reject(err))
  })
}

/** Write a JSON response with the given status code. */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Returns true if the request passes authentication, false otherwise. */
export function authMiddleware(req: IncomingMessage, config: ServerConfig): boolean {
  if (!config.apiKey) {
    return true
  }
  const header = req.headers.authorization
  if (!header) {
    return false
  }
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || token !== config.apiKey) {
    return false
  }
  return true
}

/** Structured HTTP error so handlers can throw with a status code. */
class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

class Semaphore {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++
        resolve()
      })
    })
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) {
      next()
    }
  }

  get active(): number {
    return this.running
  }

  get pending(): number {
    return this.queue.length
  }
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function setCorsHeaders(res: ServerResponse, req: IncomingMessage, mobile: boolean): void {
  // When the mobile client is served from this same origin the browser
  // doesn't need a permissive CORS policy, but echoing the request origin
  // lets users open the client URL from their phone's home screen (PWA)
  // without breaking auth headers.
  const origin = req.headers.origin
  if (mobile && typeof origin === 'string') {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

// ---------------------------------------------------------------------------
// VoidServer
// ---------------------------------------------------------------------------

export class VoidServer {
  private readonly config: ServerConfig
  private server: Server | null = null
  private startedAt: number = 0
  private totalRequests: number = 0
  private readonly semaphore: Semaphore
  private readonly sessions: Map<string, { createdAt: number; lastActiveAt: number }> = new Map()

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.semaphore = new Semaphore(this.config.maxConcurrent)
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error('Server is already running'))
        return
      }

      this.startedAt = Date.now()
      this.totalRequests = 0

      this.server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      this.server.on('error', (err) => {
        reject(err)
      })

      this.server.listen(this.config.port, this.config.host, () => {
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close((err) => {
        this.server = null
        this.sessions.clear()
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  get isRunning(): boolean {
    return this.server !== null
  }

  get address(): { host: string; port: number } {
    return { host: this.config.host, port: this.config.port }
  }

  // -----------------------------------------------------------------------
  // Request dispatcher
  // -----------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCorsHeaders(res, req, !!this.config.mobile)

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // The mobile HTML shell itself is public — the embedded script is what
    // authenticates with the pairing token in the URL fragment. Every other
    // route goes through the auth middleware.
    const pathname = new URL(req.url ?? '/', `http://${this.config.host}:${this.config.port}`).pathname
    const isMobileShell = this.config.mobile && req.method === 'GET' && pathname === '/m'
    if (!isMobileShell && !authMiddleware(req, this.config)) {
      sendJson(res, 401, { error: 'Unauthorized', message: 'Invalid or missing API key' })
      return
    }

    this.totalRequests++

    // Concurrency gate — acquire before handling, release after
    const acquired = await Promise.race([
      this.semaphore.acquire().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), this.config.timeout)),
    ])

    if (!acquired) {
      sendJson(res, 503, { error: 'Service Unavailable', message: 'Server is at capacity' })
      return
    }

    // Request timeout
    const timer = setTimeout(() => {
      if (!res.writableEnded) {
        sendJson(res, 504, { error: 'Gateway Timeout', message: 'Request timed out' })
      }
    }, this.config.timeout)

    try {
      await this.route(req, res, pathname)
    } catch (err) {
      if (!res.writableEnded) {
        if (err instanceof HttpError) {
          sendJson(res, err.statusCode, { error: err.name, message: err.message })
        } else {
          const message = err instanceof Error ? err.message : 'Unknown error'
          sendJson(res, 500, { error: 'Internal Server Error', message })
        }
      }
    } finally {
      clearTimeout(timer)
      this.semaphore.release()
    }
  }

  // -----------------------------------------------------------------------
  // Router
  // -----------------------------------------------------------------------

  private async route(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const method = req.method ?? 'GET'

    // GET /health
    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        uptime: Date.now() - this.startedAt,
        hostname: hostname(),
      })
      return
    }

    // GET /status
    if (method === 'GET' && pathname === '/status') {
      const status: ServerStatus = {
        version: typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.0-dev',
        uptime: Date.now() - this.startedAt,
        activeSessions: this.sessions.size,
        totalRequests: this.totalRequests,
        models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
      }
      sendJson(res, 200, status)
      return
    }

    // GET /m — mobile web client (only when mobile mode is enabled)
    if (this.config.mobile && method === 'GET' && pathname === '/m') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Lock the client down: it only talks to its own origin and the
        // inline script it was served with.
        'Content-Security-Policy':
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(MOBILE_CLIENT_HTML)
      return
    }

    // POST /chat
    if (method === 'POST' && pathname === '/chat') {
      await this.handleChat(req, res)
      return
    }

    // POST /chat/stream — Server-Sent Events streaming chat
    if (method === 'POST' && pathname === '/chat/stream') {
      await this.handleChatStream(req, res)
      return
    }

    // POST /review
    if (method === 'POST' && pathname === '/review') {
      await this.handleReview(req, res)
      return
    }

    // GET /sessions
    if (method === 'GET' && pathname === '/sessions') {
      const ids = Array.from(this.sessions.keys())
      sendJson(res, 200, { sessions: ids })
      return
    }

    // DELETE /sessions/:id
    const sessionDeleteMatch = pathname.match(/^\/sessions\/([^/]+)$/)
    if (method === 'DELETE' && sessionDeleteMatch) {
      const id = sessionDeleteMatch[1]!
      if (this.sessions.has(id)) {
        this.sessions.delete(id)
        sendJson(res, 200, { deleted: true, sessionId: id })
      } else {
        sendJson(res, 404, { error: 'Not Found', message: `Session ${id} not found` })
      }
      return
    }

    // Fallback
    sendJson(res, 404, { error: 'Not Found', message: `No route for ${method} ${pathname}` })
  }

  // -----------------------------------------------------------------------
  // Stub handlers
  // -----------------------------------------------------------------------

  /**
   * POST /chat — stub handler.
   * In a real implementation this would pipe the message through the AI
   * conversation pipeline. For now it returns a mock response.
   */
  private async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseJsonBody<ChatRequest>(req)

    if (!body.message || typeof body.message !== 'string') {
      throw new HttpError(400, 'Missing required field: message')
    }

    const startTime = Date.now()

    // Create or reuse session
    const sessionId = body.sessionId ?? generateSessionId()
    this.sessions.set(sessionId, {
      createdAt: this.sessions.get(sessionId)?.createdAt ?? Date.now(),
      lastActiveAt: Date.now(),
    })

    // Stub response — real implementation would invoke the model here
    const response: ChatResponse = {
      sessionId,
      response: `[stub] Received message: "${body.message.slice(0, 100)}"`,
      tokensUsed: { input: estimateTokens(body.message), output: 42 },
      toolCalls: [],
      duration: Date.now() - startTime,
    }

    sendJson(res, 200, response)
  }

  /**
   * POST /chat/stream — Server-Sent Events streaming chat.
   *
   * Pushes incremental events (text chunks, tool calls, usage) from the
   * configured {@link ChatAdapter} to the client as they arrive. The
   * connection stays open until the adapter yields a `done` or `error`
   * event, or the client disconnects.
   */
  private async handleChatStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseJsonBody<ChatRequest>(req)
    if (!body.message || typeof body.message !== 'string') {
      throw new HttpError(400, 'Missing required field: message')
    }

    const sessionId = body.sessionId ?? generateSessionId()
    this.sessions.set(sessionId, {
      createdAt: this.sessions.get(sessionId)?.createdAt ?? Date.now(),
      lastActiveAt: Date.now(),
    })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Disables proxy buffering (nginx, Cloudflare) so chunks flush promptly.
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    })

    const write = (payload: unknown): void => {
      if (res.writableEnded) return
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    write({ type: 'session', sessionId })

    // Emit a heartbeat every 15s so mobile browsers on flaky networks
    // don't silently drop the connection.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n')
    }, 15_000)

    let clientGone = false
    req.on('close', () => { clientGone = true })

    const adapter = this.config.chatAdapter ?? echoChatAdapter
    try {
      for await (const event of adapter({
        message: body.message,
        sessionId,
        model: body.model,
        cwd: body.cwd,
      })) {
        if (clientGone) break
        write(event)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      write({ type: 'error', message })
    } finally {
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    }
  }

  /**
   * POST /review — stub handler.
   * In a real implementation this would send the diff through a code-review
   * prompt. For now it returns a mock review.
   */
  private async handleReview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseJsonBody<ReviewRequest>(req)

    if (!body.diff || typeof body.diff !== 'string') {
      throw new HttpError(400, 'Missing required field: diff')
    }

    // Parse file names from unified diff headers for the stub
    const files = Array.from(body.diff.matchAll(/^(?:---|\+\+\+) [ab]\/(.+)$/gm))
      .map((m) => m[1]!)
      .filter((f, i, a) => a.indexOf(f) === i)

    const response: ReviewResponse = {
      summary: `[stub] Reviewed diff covering ${files.length} file(s).`,
      issues: files.map((file) => ({
        severity: 'info' as const,
        file,
        message: 'Stub review — no real analysis performed.',
      })),
      suggestions: [
        'Integrate with the real AI pipeline for meaningful review results.',
      ],
      approved: true,
    }

    sendJson(res, 200, response)
  }

  // -----------------------------------------------------------------------
  // Status helpers (used by the /serve command)
  // -----------------------------------------------------------------------

  getStatus(): ServerStatus {
    return {
      version: typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.0-dev',
      uptime: this.server ? Date.now() - this.startedAt : 0,
      activeSessions: this.sessions.size,
      totalRequests: this.totalRequests,
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateSessionId(): string {
  // Produce a random hex ID without importing crypto
  const bytes = new Uint8Array(16)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Rough token estimate (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Re-export the MACRO type declaration so TS doesn't complain when the
// build-time constant is not present.
declare const MACRO: { VERSION: string } | undefined
