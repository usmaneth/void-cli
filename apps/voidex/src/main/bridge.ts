// Voidex — WebSocket bridge to `void serve`.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
//
// Voidex communicates with the void-cli backend via a long-running child
// process (`void serve --ws <port>`). This keeps the Electron main process
// lean and decouples UI rollouts from backend churn. Eventually we may
// embed the session/tool/council engine directly (see docs/voidex.md).

import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { EventEmitter } from "node:events"
import log from "electron-log/main.js"

export interface BridgeOptions {
  voidBin?: string // path to `void` binary; defaults to `void` on PATH
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface BridgeStatus {
  state: "idle" | "starting" | "ready" | "error" | "stopped"
  port?: number
  pid?: number
  error?: string
}

export class VoidBridge extends EventEmitter {
  private child: ChildProcess | null = null
  private port: number | null = null
  private status: BridgeStatus = { state: "idle" }

  constructor(private opts: BridgeOptions = {}) {
    super()
  }

  async start(): Promise<BridgeStatus> {
    if (this.status.state === "starting" || this.status.state === "ready") {
      return this.status
    }
    this.setStatus({ state: "starting" })
    try {
      const port = await pickFreePort()
      const bin = this.opts.voidBin ?? "void"
      log.info(`[voidex-bridge] spawning: ${bin} serve --ws ${port}`)
      const child = spawn(bin, ["serve", "--ws", String(port)], {
        cwd: this.opts.cwd ?? process.cwd(),
        env: { ...process.env, ...this.opts.env, VOID_USE_SQLITE_SESSIONS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      })
      this.child = child
      this.port = port

      child.stdout?.on("data", (b) => log.info(`[voidex-bridge stdout] ${b.toString().trim()}`))
      child.stderr?.on("data", (b) => log.warn(`[voidex-bridge stderr] ${b.toString().trim()}`))
      child.on("exit", (code, signal) => {
        log.warn(`[voidex-bridge] exit code=${code} signal=${signal}`)
        const wasRunning = this.status.state === "ready" || this.status.state === "starting"
        this.child = null
        this.port = null
        if (wasRunning) this.setStatus({ state: "stopped" })
      })
      child.on("error", (err) => {
        log.error(`[voidex-bridge] error`, err)
        this.setStatus({ state: "error", error: String(err?.message ?? err) })
      })

      // We trust that `void serve` will bind the port before the UI attempts
      // to connect; the renderer handles reconnect and exposes status.
      this.setStatus({ state: "ready", port, pid: child.pid })
      return this.status
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: "error", error: msg })
      return this.status
    }
  }

  stop(): void {
    if (!this.child) return
    try {
      this.child.kill("SIGTERM")
    } catch {}
    this.child = null
    this.port = null
    this.setStatus({ state: "stopped" })
  }

  getStatus(): BridgeStatus {
    return { ...this.status }
  }

  getWsUrl(): string | null {
    if (this.status.state !== "ready" || this.port == null) return null
    return `ws://127.0.0.1:${this.port}`
  }

  private setStatus(s: BridgeStatus) {
    this.status = s
    this.emit("status", s)
  }
}

async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      if (typeof addr !== "object" || !addr) {
        s.close()
        reject(new Error("no port"))
        return
      }
      const port = addr.port
      s.close(() => resolve(port))
    })
  })
}
