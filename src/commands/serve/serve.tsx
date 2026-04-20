/**
 * `void serve` — start the HTTP + WebSocket server that Voidex and other
 * external clients connect to.
 *
 * Flags:
 *   --port <n>      default 4096
 *   --host <h>      default 127.0.0.1
 *   --public        bind 0.0.0.0 and require $VOID_SERVE_TOKEN bearer auth
 *   --ws            enable the WebSocket endpoint at /ws
 *   --cors <o,...>  comma-separated additional CORS origins (file:// always on)
 *   --share-ttl <ms> default TTL for /sessions/:id/share records
 */

import { startServer, type VoidServeHandle } from '../../services/serve/server.js'

export interface ServeOptions {
  port?: number | string
  host?: string
  public?: boolean
  ws?: boolean
  cors?: string
  shareTtl?: number | string
}

function logLine(line: string): void {
  // stdout is the contract with Voidex (it reads the URL line to connect).
  process.stdout.write(line + '\n')
}

export async function runServe(opts: ServeOptions): Promise<VoidServeHandle> {
  const port = Number(opts.port ?? 4096)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid --port: ${opts.port}`)
  }
  const publicMode = Boolean(opts.public)
  const host = opts.host ?? (publicMode ? '0.0.0.0' : '127.0.0.1')
  const ws = Boolean(opts.ws)
  const corsOrigins = ['file://']
  if (opts.cors && typeof opts.cors === 'string') {
    for (const o of opts.cors.split(',').map((s) => s.trim()).filter(Boolean)) {
      corsOrigins.push(o)
    }
  }
  const shareTtlMs = opts.shareTtl ? Number(opts.shareTtl) : 0

  const handle = await startServer({
    port,
    host,
    publicMode,
    enableWebSocket: ws,
    corsOrigins,
    shareTtlMs,
  })

  const displayHost = host === '0.0.0.0' ? '0.0.0.0' : host
  logLine(`void serve listening on http://${displayHost}:${handle.port}`)
  if (ws) {
    logLine(`  websocket: ws://${displayHost}:${handle.port}/ws?sessionId=<id>`)
  }
  logLine('  endpoints:')
  logLine('    GET    /sessions')
  logLine('    GET    /sessions/:id')
  logLine('    POST   /sessions/:id/messages')
  logLine('    POST   /sessions/:id/fork')
  logLine('    POST   /sessions/:id/revert')
  logLine('    POST   /sessions/:id/share')
  logLine('    GET    /s/:shareId')
  if (publicMode) {
    logLine('  auth: bearer (VOID_SERVE_TOKEN) required (public mode)')
  } else {
    logLine('  auth: local (127.0.0.1)')
  }

  // Keep the process alive and handle SIGINT/SIGTERM for graceful shutdown.
  const shutdown = async (sig: string) => {
    logLine(`void serve: ${sig} received, shutting down`)
    try {
      await handle.close()
    } catch {
      // noop
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  return handle
}

/** Entry point used by commander / CLI wiring. */
export async function serveCommand(opts: ServeOptions): Promise<void> {
  try {
    await runServe(opts)
  } catch (err) {
    process.stderr.write(
      `void serve failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
