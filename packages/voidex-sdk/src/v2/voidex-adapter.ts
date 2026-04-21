/*
 * Voidex SDK Adapter — translates opencode SDK calls to `void serve`.
 *
 * The voidex-app renderer imports a generated `OpencodeClient` that expects
 * opencode's HTTP API (paths like `/session`, `/session/:id`, etc.). Void's
 * `serve` backend (src/services/serve/server.ts) exposes a smaller, differently
 * shaped API (`/sessions`, `/sessions/:id`, `/sessions/:id/messages`, ...).
 *
 * Rather than rewrite every callsite in the vendored UI, this adapter installs
 * a custom `fetch` on the SDK client that intercepts requests, rewrites them
 * to void serve's equivalents, and massages responses back into opencode's
 * shape. Endpoints the UI calls but void serve doesn't implement return sensible
 * empty-state stubs so the app boots; these are documented inline as follow-up
 * work for void serve.
 */

import type { Session } from "./gen/types.gen.js"

/** Public config options for building a void-serve-aware fetch. */
export interface VoidexAdapterConfig {
  /** Base URL of `void serve`. Defaults to http://127.0.0.1:4096. */
  voidServeUrl?: string
  /** Optional bearer token when `void serve --public` is enabled. */
  token?: string
  /** Underlying fetch implementation; defaults to globalThis.fetch. */
  fetch?: typeof fetch
  /** Enable verbose logging of rewrites (for debugging). */
  debug?: boolean
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function json(data: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

function notFound(): Response {
  return json({ error: "Not Found" }, { status: 404 })
}

// ---------------------------------------------------------------------------
// Mappers: void-serve record -> opencode Session shape
// ---------------------------------------------------------------------------

interface VoidSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  tokenUsage: { input: number; output: number }
  cwd: string
  branch?: string
  tags: string[]
  summary?: string
}

function voidSessionToOpencode(meta: VoidSessionMeta): Session {
  return {
    id: meta.id,
    slug: meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64) || meta.id,
    projectID: meta.cwd || "",
    directory: meta.cwd || "",
    title: meta.title || "Untitled session",
    version: "1",
    time: {
      created: Math.floor(meta.createdAt / 1000),
      updated: Math.floor(meta.updatedAt / 1000),
    },
  }
}

// ---------------------------------------------------------------------------
// URL rewriting table — opencode path -> void serve path
// ---------------------------------------------------------------------------

interface RewriteResult {
  /** Void-serve URL to call (absolute). */
  url: string
  /** Method for void serve. */
  method: string
  /** Optional body override (JSON-serialized). */
  body?: string
  /** If set, skip network and return this synthesized Response. */
  synth?: Response
  /** If set, transform the void-serve response before handing back to SDK. */
  transform?: (res: Response) => Promise<Response>
}

function makeRewrite(
  request: Request,
  cfg: Required<Pick<VoidexAdapterConfig, "voidServeUrl">>,
): RewriteResult {
  const src = new URL(request.url)
  const path = src.pathname
  const method = request.method.toUpperCase()
  const base = cfg.voidServeUrl.replace(/\/$/, "")

  // -- Global / health ------------------------------------------------------
  if (path === "/" || path === "/health") {
    return { url: `${base}/health`, method: "GET" }
  }

  // -- Session list ---------------------------------------------------------
  // opencode: GET /session  -> void serve: GET /sessions
  if (path === "/session" && method === "GET") {
    return {
      url: `${base}/sessions`,
      method: "GET",
      transform: async (res) => {
        if (!res.ok) return res
        const body = (await res.json().catch(() => ({}))) as {
          sessions?: VoidSessionMeta[]
        }
        const mapped = (body.sessions ?? []).map(voidSessionToOpencode)
        return json(mapped)
      },
    }
  }

  // -- Session create -------------------------------------------------------
  // opencode: POST /session  -> void serve has no "create" endpoint (sessions are
  // created lazily by the CLI runtime). Synthesize a local placeholder.
  if (path === "/session" && method === "POST") {
    const id = `vs_${Math.random().toString(36).slice(2, 10)}`
    const now = Math.floor(Date.now() / 1000)
    const stub: Session = {
      id,
      slug: id,
      projectID: "",
      directory: "",
      title: "New session",
      version: "1",
      time: { created: now, updated: now },
    }
    return { url: "", method: "POST", synth: json(stub) }
  }

  // -- Session status -------------------------------------------------------
  if (path === "/session/status" && method === "GET") {
    return { url: "", method: "GET", synth: json({}) }
  }

  // -- Session get ----------------------------------------------------------
  // opencode: GET /session/:id   -> void serve: GET /sessions/:id
  const matchGet = path.match(/^\/session\/([^/]+)$/)
  if (matchGet && method === "GET") {
    const [, sessionId] = matchGet
    return {
      url: `${base}/sessions/${encodeURIComponent(sessionId!)}`,
      method: "GET",
      transform: async (res) => {
        if (!res.ok) return res
        const body = (await res.json().catch(() => null)) as
          | { metadata: VoidSessionMeta; messages: unknown[] }
          | null
        if (!body) return notFound()
        return json(voidSessionToOpencode(body.metadata))
      },
    }
  }

  // -- Session delete -------------------------------------------------------
  // Void serve doesn't expose DELETE — return a no-op.
  if (matchGet && method === "DELETE") {
    return { url: "", method: "DELETE", synth: json({ ok: true }) }
  }

  // -- Session messages (list) ---------------------------------------------
  // opencode: GET /session/:id/message  -> derive from GET /sessions/:id
  const matchMsgs = path.match(/^\/session\/([^/]+)\/message$/)
  if (matchMsgs && method === "GET") {
    const [, sessionId] = matchMsgs
    return {
      url: `${base}/sessions/${encodeURIComponent(sessionId!)}`,
      method: "GET",
      transform: async (res) => {
        if (!res.ok) return res
        const body = (await res.json().catch(() => null)) as
          | { metadata: VoidSessionMeta; messages: VoidSessionMsg[] }
          | null
        if (!body) return json([])
        return json(body.messages.map((m, i) => voidMessageToOpencode(m, sessionId!, i)))
      },
    }
  }

  // -- Session message (append) --------------------------------------------
  // opencode: POST /session/:id/message -> void serve: POST /sessions/:id/messages
  const matchMsgCreate = path.match(/^\/session\/([^/]+)\/message$/)
  if (matchMsgCreate && method === "POST") {
    const [, sessionId] = matchMsgCreate
    return {
      url: `${base}/sessions/${encodeURIComponent(sessionId!)}/messages`,
      method: "POST",
      transform: async (res) => {
        if (!res.ok) return res
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
        return json({ info: {}, parts: [], ...body })
      },
    }
  }

  // -- Session fork --------------------------------------------------------
  const matchFork = path.match(/^\/session\/([^/]+)\/fork$/)
  if (matchFork && method === "POST") {
    const [, sessionId] = matchFork
    return {
      url: `${base}/sessions/${encodeURIComponent(sessionId!)}/fork`,
      method: "POST",
    }
  }

  // -- Session revert ------------------------------------------------------
  const matchRevert = path.match(/^\/session\/([^/]+)\/revert$/)
  if (matchRevert && method === "POST") {
    const [, sessionId] = matchRevert
    return {
      url: `${base}/sessions/${encodeURIComponent(sessionId!)}/revert`,
      method: "POST",
    }
  }

  // -- Session share -------------------------------------------------------
  const matchShare = path.match(/^\/session\/([^/]+)\/share$/)
  if (matchShare && method === "POST") {
    const [, sessionId] = matchShare
    return {
      url: `${base}/sessions/${encodeURIComponent(sessionId!)}/share`,
      method: "POST",
    }
  }

  // -- Session unshare — not implemented on void serve ---------------------
  if (path.match(/^\/session\/[^/]+\/unshare$/)) {
    return { url: "", method: "POST", synth: json({ ok: true }) }
  }

  // -- Session abort / children / summarize / etc.  ------------------------
  // None of these have a void-serve equivalent today. Return empty/no-op
  // so the UI's optimistic updates don't crash.
  if (path.startsWith("/session/")) {
    return { url: "", method, synth: json({ ok: true }) }
  }

  // -- Event stream --------------------------------------------------------
  // opencode uses SSE at `/event`. Void serve streams the same information
  // over WebSocket at `/ws`. The UI's SSE consumer is bypassed — see
  // voidex-app/context/sync.tsx where the WS bridge is attached. Return an
  // empty, never-terminating SSE stream so the SSE client doesn't crash.
  if (path === "/event") {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        // Emit an initial comment to open the stream; then idle.
        controller.enqueue(enc.encode(":voidex-bridge\n\n"))
      },
    })
    return {
      url: "",
      method: "GET",
      synth: new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      }),
    }
  }

  // -- Config / project / model / app / provider / command / agent --------
  // These all return empty/defaults; the UI's bootstrap tolerates these.
  if (path === "/config" || path === "/global/config") {
    return { url: "", method, synth: json({}) }
  }
  if (path === "/project/current") {
    return {
      url: "",
      method: "GET",
      synth: json({ id: "void", worktree: "/" }),
    }
  }
  if (path === "/project") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path === "/app/agents" || path === "/app/skills" || path === "/app/log") {
    return { url: "", method, synth: json([]) }
  }
  if (path === "/provider") {
    return { url: "", method: "GET", synth: json({ providers: [], default: {} }) }
  }
  if (path === "/command") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path === "/permission") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path === "/mcp/status" || path === "/mcp") {
    return { url: "", method, synth: json({}) }
  }
  if (path === "/file" || path === "/file/status" || path === "/path") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path === "/find/files" || path === "/find/symbols" || path === "/find/text") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path === "/tool" || path === "/tool/ids") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path === "/lsp/status" || path === "/formatter/status") {
    return { url: "", method: "GET", synth: json({}) }
  }
  if (path === "/worktree") {
    return { url: "", method, synth: json([]) }
  }
  if (path === "/vcs" || path.startsWith("/vcs/")) {
    return { url: "", method, synth: json({}) }
  }
  if (path === "/question") {
    return { url: "", method: "GET", synth: json([]) }
  }
  if (path.startsWith("/pty")) {
    return { url: "", method, synth: json({}) }
  }
  if (path.startsWith("/tui/")) {
    return { url: "", method, synth: json({ ok: true }) }
  }
  if (path.startsWith("/experimental/")) {
    return { url: "", method, synth: json([]) }
  }
  if (path.startsWith("/sync/")) {
    return { url: "", method, synth: json({}) }
  }
  if (path === "/auth" || path.startsWith("/auth/")) {
    return { url: "", method, synth: json({}) }
  }

  // -- Fallthrough: pass through unchanged ---------------------------------
  return { url: `${base}${src.pathname}${src.search}`, method, body: undefined }
}

// ---------------------------------------------------------------------------
// Message mapping — void messages are simpler than opencode messages.
// ---------------------------------------------------------------------------

interface VoidSessionMsg {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

function voidMessageToOpencode(m: VoidSessionMsg, sessionId: string, index: number) {
  const id = `vm_${sessionId}_${index}`
  const time = Math.floor(m.timestamp / 1000)
  const textPart = {
    id: `${id}_part_0`,
    messageID: id,
    sessionID: sessionId,
    type: "text" as const,
    text: m.content,
    time: { start: time, end: time },
  }
  if (m.role === "user") {
    return {
      info: {
        id,
        sessionID: sessionId,
        role: "user",
        time: { created: time },
      },
      parts: [textPart],
    }
  }
  // assistant / system
  return {
    info: {
      id,
      sessionID: sessionId,
      role: m.role === "assistant" ? "assistant" : "system",
      time: { created: time, completed: time },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [textPart],
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build a fetch function suitable for the opencode-generated SDK client that
 * speaks to `void serve`. Plug it into createOpencodeClient({ fetch: ... }).
 */
export function buildVoidexFetch(config: VoidexAdapterConfig = {}): typeof fetch {
  const voidServeUrl = (config.voidServeUrl ?? "http://127.0.0.1:4096").replace(/\/$/, "")
  const underlying = config.fetch ?? ((globalThis as any).fetch as typeof fetch)
  const debug = !!config.debug

  if (typeof underlying !== "function") {
    throw new Error("voidex-adapter: no fetch implementation available")
  }

  const adapter = async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input as RequestInfo, init)
    const rewrite = makeRewrite(request, { voidServeUrl })

    if (debug) {
      // eslint-disable-next-line no-console
      console.debug(
        "[voidex-adapter]",
        request.method,
        new URL(request.url).pathname,
        "->",
        rewrite.synth ? "synth" : `${rewrite.method} ${rewrite.url}`,
      )
    }

    if (rewrite.synth) return rewrite.synth

    const headers = new Headers(request.headers)
    if (config.token) headers.set("authorization", `Bearer ${config.token}`)

    const reqInit: RequestInit = {
      method: rewrite.method,
      headers,
      body: rewrite.body ?? (rewrite.method === "GET" || rewrite.method === "HEAD" ? undefined : request.body),
      // @ts-expect-error: Node fetch supports duplex but the lib types lag behind
      duplex: "half",
      redirect: request.redirect,
    }

    const res = await underlying(rewrite.url, reqInit)
    if (rewrite.transform) return await rewrite.transform(res)
    return res
  }

  return adapter as unknown as typeof fetch
}

/** Convenience: default voidex-adapter config used when the SDK has no override. */
export const VOIDEX_DEFAULT_SERVE_URL = "http://127.0.0.1:4096"
