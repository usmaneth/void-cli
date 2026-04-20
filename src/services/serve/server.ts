/**
 * Void `serve` HTTP + WebSocket server.
 *
 * The server is framework-Hono for HTTP; WebSockets are attached to the
 * underlying Node http.Server using the `ws` package.
 *
 * Endpoints (HTTP):
 *   GET    /                       — tiny health snippet
 *   GET    /health                 — JSON health
 *   GET    /sessions               — list sessions
 *   GET    /sessions/:id           — fetch one session (metadata + messages)
 *   POST   /sessions/:id/messages  — append a user message
 *   POST   /sessions/:id/fork      — fork via ForkManager (PR #58 API)
 *   POST   /sessions/:id/revert    — revert N turns via ForkManager
 *   POST   /sessions/:id/share     — generate a shareId
 *   GET    /s/:shareId             — read-only HTML render (no auth required)
 *
 * WebSocket (when `enableWebSocket: true`):
 *   ws://host:port/ws?sessionId=<id>[&token=<bearer>]
 *
 * Authentication:
 *   - Local (127.0.0.1) default — no token required.
 *   - `--public` (0.0.0.0) requires `VOID_SERVE_TOKEN` + `Authorization: Bearer ...`.
 *   - The /s/:shareId endpoint is always public read-only.
 *
 * CORS: by default allows `file://` origin (Electron / Voidex). Additional
 * origins can be provided.
 */

import type { Server as NodeServer, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { WebSocketServer, type WebSocket } from 'ws'
import { URL } from 'node:url'

import { SessionManager, SessionStore, type SessionMessage } from '../../sessions/index.js'
import { getForkManager, ForkTree } from '../../fork/index.js'
import { getEventBus, type PartEvent } from './eventBus.js'
import { SharedSessionsStore, generateShareId } from './sharedSessions.js'
import { renderSharePage } from './renderShare.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ServeConfig {
  port: number
  host: string
  /** If true, require bearer auth and only allow public mode via this flag. */
  publicMode: boolean
  /** Required when publicMode=true; also accepted in local mode if set. */
  authToken?: string
  /** Enable WebSocket /ws endpoint. Voidex uses `--ws`. */
  enableWebSocket: boolean
  /** Additional CORS origins (file:// is always allowed). */
  corsOrigins: string[]
  /** Default TTL for shared sessions (ms). 0 = no expiration. */
  shareTtlMs: number
  /** Optional overrides for tests. */
  sessionStore?: SessionStore
  sharedStore?: SharedSessionsStore
}

const DEFAULT_CONFIG: ServeConfig = {
  port: 4096,
  host: '127.0.0.1',
  publicMode: false,
  authToken: undefined,
  enableWebSocket: false,
  corsOrigins: ['file://'],
  shareTtlMs: 0,
}

// ---------------------------------------------------------------------------
// Build the Hono app
// ---------------------------------------------------------------------------

export interface BuildAppResult {
  app: Hono
  sessionManager: SessionManager
  sharedStore: SharedSessionsStore
}

export function buildApp(cfg: ServeConfig): BuildAppResult {
  const sessionStore = cfg.sessionStore ?? new SessionStore()
  const sharedStore = cfg.sharedStore ?? new SharedSessionsStore()
  const sessionManager = new SessionManager(sessionStore)
  const bus = getEventBus()

  const app = new Hono()

  // ---- CORS middleware ----
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin') ?? ''
    const allowed = isOriginAllowed(origin, cfg.corsOrigins)
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin || '*')
      c.header('Vary', 'Origin')
    }
    c.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204)
    }
    await next()
  })

  // ---- Auth middleware ----
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname
    // Public read-only share route — no auth.
    if (path.startsWith('/s/')) {
      return next()
    }
    // Health is always public.
    if (path === '/' || path === '/health') {
      return next()
    }
    if (!authPasses(c.req.header('authorization'), cfg)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  // ---- Health ----
  app.get('/', (c) => c.text('void serve\n'))
  app.get('/health', (c) =>
    c.json({ status: 'ok', uptime: process.uptime(), wsEnabled: cfg.enableWebSocket }),
  )

  // ---- Sessions list ----
  app.get('/sessions', (c) => {
    const list = sessionStore.list({ limit: 200 })
    return c.json({ sessions: list })
  })

  // ---- Single session ----
  app.get('/sessions/:id', (c) => {
    const id = c.req.param('id')
    const loaded = sessionStore.load(id)
    if (!loaded) return c.json({ error: 'Not Found' }, 404)
    return c.json(loaded)
  })

  // ---- Append user message ----
  app.post('/sessions/:id/messages', async (c) => {
    const id = c.req.param('id')
    let body: { content?: string; role?: string }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    if (!body || typeof body.content !== 'string' || body.content.length === 0) {
      return c.json({ error: 'Missing field: content' }, 400)
    }
    const role = (body.role as SessionMessage['role']) ?? 'user'
    const loaded = sessionStore.load(id)
    if (!loaded) return c.json({ error: 'Not Found' }, 404)

    const message: SessionMessage = {
      role,
      content: body.content,
      timestamp: Date.now(),
    }
    sessionStore.appendMessage(id, message)
    loaded.metadata.messageCount += 1
    loaded.metadata.updatedAt = Date.now()
    sessionStore.saveMetadata(loaded.metadata)

    // Emit an event for any WS subscribers.
    bus.publish({
      type: 'message.complete',
      sessionId: id,
      messageId: `${loaded.metadata.messageCount}`,
      role,
      content: body.content,
    })

    return c.json({ ok: true, messageCount: loaded.metadata.messageCount })
  })

  // ---- Fork ----
  app.post('/sessions/:id/fork', async (c) => {
    const id = c.req.param('id')
    let body: { turnNumber?: number; label?: string } = {}
    try {
      body = (await c.req.json().catch(() => ({}))) as typeof body
    } catch {
      // allow empty body
    }
    const loaded = sessionStore.load(id)
    if (!loaded) return c.json({ error: 'Not Found' }, 404)

    // Consume PR #58 session API. Get or initialize the ForkTree for this
    // session, then call createFork. (We never reimplement — ForkManager
    // owns its own persistence.)
    const manager = getForkManager()
    manager.init(id)
    // Prime the tree with existing messages so fork turnNumber makes sense
    const tree = manager.getTree()
    const current = tree.getCurrentFork()
    if (current.messages.length === 0 && loaded.messages.length > 0) {
      for (const m of loaded.messages) tree.addMessage(m)
    }
    const node = manager.fork(body.turnNumber, body.label)
    return c.json({ ok: true, forkId: node.id, parentId: node.parentId, turnNumber: node.turnNumber })
  })

  // ---- Revert ----
  app.post('/sessions/:id/revert', async (c) => {
    const id = c.req.param('id')
    let body: { turns?: number } = {}
    try {
      body = (await c.req.json().catch(() => ({}))) as typeof body
    } catch {
      // allow empty body
    }
    const loaded = sessionStore.load(id)
    if (!loaded) return c.json({ error: 'Not Found' }, 404)

    const turns = Math.max(1, body.turns ?? 1)
    // Delegate to ForkManager — revert is expressed as a fork at (N-turns).
    const manager = getForkManager()
    manager.init(id)
    const tree = manager.getTree()
    const current = tree.getCurrentFork()
    // Ensure the current fork has the session messages loaded
    if (current.messages.length === 0 && loaded.messages.length > 0) {
      for (const m of loaded.messages) tree.addMessage(m)
    }
    const newLen = Math.max(0, current.messages.length - turns)
    const revertNode = tree.createFork(newLen, `revert-${turns}`)
    tree.switchFork(revertNode.id)

    // Truncate the persisted messages to match.
    const keepMessages = loaded.messages.slice(0, newLen)
    sessionStore.save(
      { ...loaded.metadata, messageCount: keepMessages.length, updatedAt: Date.now() },
      keepMessages,
    )

    return c.json({
      ok: true,
      revertedTo: newLen,
      forkId: revertNode.id,
      remainingMessages: keepMessages.length,
    })
  })

  // ---- Share: generate ----
  app.post('/sessions/:id/share', async (c) => {
    const id = c.req.param('id')
    const loaded = sessionStore.load(id)
    if (!loaded) return c.json({ error: 'Not Found' }, 404)

    let body: { ttlMs?: number } = {}
    try {
      body = (await c.req.json().catch(() => ({}))) as typeof body
    } catch {
      // noop
    }
    const record = sharedStore.create(id, {
      ttlMs: body.ttlMs ?? (cfg.shareTtlMs || undefined),
    })
    const base = publicBaseUrl(cfg)
    return c.json({
      ok: true,
      shareId: record.shareId,
      url: `${base}/s/${record.shareId}`,
      expiresAt: record.expiresAt,
    })
  })

  // ---- Share: render ----
  app.get('/s/:shareId', (c) => {
    const shareId = c.req.param('shareId')
    const record = sharedStore.get(shareId)
    if (!record) {
      return c.html(
        renderNotFoundPage(shareId),
        404,
      )
    }
    const loaded = sessionStore.load(record.sessionId)
    if (!loaded) {
      return c.html(renderNotFoundPage(shareId), 404)
    }
    const base = publicBaseUrl(cfg)
    const html = renderSharePage({
      metadata: loaded.metadata,
      messages: loaded.messages,
      shareId,
      shareUrl: `${base}/s/${shareId}`,
    })
    return c.html(html, 200, {
      'Cache-Control': 'public, max-age=60',
    })
  })

  return { app, sessionManager, sharedStore }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function authPasses(headerValue: string | undefined, cfg: ServeConfig): boolean {
  if (cfg.publicMode) {
    if (!cfg.authToken) return false
    if (!headerValue) return false
    const parts = headerValue.split(' ')
    if (parts.length !== 2) return false
    const [scheme, token] = parts
    return scheme === 'Bearer' && token === cfg.authToken
  }
  // Local mode: if a token is set, still enforce it. Otherwise open.
  if (cfg.authToken) {
    if (!headerValue) return false
    const parts = headerValue.split(' ')
    if (parts.length !== 2) return false
    const [scheme, token] = parts
    return scheme === 'Bearer' && token === cfg.authToken
  }
  return true
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (!origin) return true // non-browser request — not enforceable, accept
  if (allowed.includes('*')) return true
  if (allowed.includes(origin)) return true
  // Allow all file:// origins when 'file://' is listed.
  if (allowed.includes('file://') && origin.startsWith('file://')) return true
  return false
}

function publicBaseUrl(cfg: ServeConfig): string {
  // For a public-mode server, construct `http://HOST:PORT` or just use
  // localhost placeholder in local mode. Callers that want a real public
  // URL should set VOID_SERVE_PUBLIC_URL.
  const explicit = process.env.VOID_SERVE_PUBLIC_URL
  if (explicit) return explicit.replace(/\/$/, '')
  return `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`
}

function renderNotFoundPage(shareId: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Not found</title>
<style>body{font:15px/1.5 -apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#222;}</style>
</head><body>
<h1>Shared session not found</h1>
<p>The share id <code>${shareId.replace(/[^a-zA-Z0-9_-]/g, '')}</code> is unknown or has expired.</p>
</body></html>`
}

// ---------------------------------------------------------------------------
// WebSocket wiring
// ---------------------------------------------------------------------------

export interface VoidServeHandle {
  port: number
  host: string
  close: () => Promise<void>
  nodeServer: NodeServer
  sessionManager: SessionManager
  sharedStore: SharedSessionsStore
  wss?: WebSocketServer
}

/**
 * Start the server. Resolves once listening.
 *
 * Returns a handle with close() to stop. WS is attached when cfg.enableWebSocket.
 */
export async function startServer(
  partial?: Partial<ServeConfig>,
): Promise<VoidServeHandle> {
  const cfg: ServeConfig = { ...DEFAULT_CONFIG, ...partial }

  if (cfg.publicMode) {
    const envToken = process.env.VOID_SERVE_TOKEN
    if (!cfg.authToken && envToken) cfg.authToken = envToken
    if (!cfg.authToken) {
      throw new Error(
        'Public mode (--public) requires VOID_SERVE_TOKEN or authToken. Refusing to start.',
      )
    }
  }

  const { app, sessionManager, sharedStore } = buildApp(cfg)

  const nodeServer = (await new Promise<NodeServer>((resolve, reject) => {
    try {
      const s = serve(
        {
          fetch: app.fetch,
          port: cfg.port,
          hostname: cfg.host,
        },
        () => resolve(s as unknown as NodeServer),
      ) as unknown as NodeServer
      s.on('error', reject)
    } catch (err) {
      reject(err)
    }
  })) as NodeServer

  let wss: WebSocketServer | undefined
  if (cfg.enableWebSocket) {
    wss = attachWebSocket(nodeServer, cfg)
  }

  const handle: VoidServeHandle = {
    port: cfg.port,
    host: cfg.host,
    nodeServer,
    sessionManager,
    sharedStore,
    wss,
    close: () => closeServer(nodeServer, wss),
  }
  return handle
}

function closeServer(node: NodeServer, wss?: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    if (wss) {
      for (const client of wss.clients) {
        try {
          client.terminate()
        } catch {
          // noop
        }
      }
      wss.close(() => node.close(() => done()))
    } else {
      node.close(() => done())
    }
  })
}

function attachWebSocket(
  node: NodeServer,
  cfg: ServeConfig,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  const bus = getEventBus()

  node.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '', `http://${cfg.host}:${cfg.port}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }

    // Auth for WS: either bearer in Authorization header OR ?token= query.
    const authHeader =
      req.headers.authorization ??
      (url.searchParams.get('token')
        ? `Bearer ${url.searchParams.get('token')}`
        : undefined)

    if (!authPasses(authHeader, cfg)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', `http://${cfg.host}:${cfg.port}`)
    const sessionId = url.searchParams.get('sessionId')

    const send = (event: PartEvent | { type: string; [k: string]: unknown }) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(event))
        } catch {
          // noop
        }
      }
    }

    send({ type: 'hello', sessionId: sessionId ?? null })

    let unsubscribe: (() => void) | null = null
    if (sessionId) {
      unsubscribe = bus.subscribe(sessionId, send)
    }

    ws.on('message', (raw: Buffer | string) => {
      // Minimal command handling: subscribe/unsubscribe to different session.
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'))
        if (msg && typeof msg === 'object') {
          if (msg.type === 'ping') {
            send({ type: 'pong' })
          } else if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
            if (unsubscribe) unsubscribe()
            unsubscribe = bus.subscribe(msg.sessionId, send)
            send({ type: 'subscribed', sessionId: msg.sessionId })
          } else if (msg.type === 'unsubscribe') {
            if (unsubscribe) unsubscribe()
            unsubscribe = null
            send({ type: 'unsubscribed' })
          }
        }
      } catch {
        // ignore malformed
      }
    })

    ws.on('close', () => {
      if (unsubscribe) unsubscribe()
    })
  })

  return wss
}

// Re-export types for convenience
export { generateShareId }
