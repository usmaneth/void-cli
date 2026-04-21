/*
 * Voidex renderer entrypoint.
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 void-cli contributors
 *
 * This file replaces the old ~340-LOC vanilla-TS stub. It boots the Solid-based
 * UI forked from opencode's `@opencode-ai/app` (now `@void-cli/voidex-app`).
 *
 * The full opencode renderer expects a `Platform` object with ~30 methods and a
 * `ServerConnection` that speaks opencode's HTTP/WS wire protocol. For this PR
 * we wire up only the minimum — a branded welcome scaffold rendered with Solid
 * — and stop short of connecting the full `AppInterface` until the
 * voidex-sdk adapter is rewritten to target `void serve` (PR #80).
 *
 * See `NOTICE` in each `packages/voidex-*` package for opencode attribution.
 */

import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"

// NOTE: @void-cli/voidex-app/index.css imports Tailwind 4 + @void-cli/voidex-ui
// styles which need the @tailwindcss/vite plugin wired up before they compile.
// Skipped for this PR — enable once voidex-ui's CSS pipeline is integrated.
// import "@void-cli/voidex-app/index.css"
import "./styles.css"

import type { BridgeStatus, VoidexAPI, VoidexGlobals } from "../preload/types"

declare global {
  interface Window {
    voidex: VoidexAPI
    __VOIDEX__?: VoidexGlobals
  }
}

const VOID_SERVE_WS_DEFAULT = "ws://127.0.0.1:4096"
const VOID_SERVE_HTTP_DEFAULT = "http://127.0.0.1:4096"

function channel() {
  return window.__VOIDEX__?.channel ?? "dev"
}

function App() {
  const [bridge, setBridge] = createSignal<BridgeStatus>({ state: "idle" })
  const [wsUrl, setWsUrl] = createSignal<string | null>(null)

  onMount(() => {
    // Subscribe to bridge status updates from the Electron main process.
    const off = window.voidex.onBridgeStatus((s) => setBridge(s))
    void window.voidex.bridgeStatus().then(setBridge)
    void window.voidex.bridgeWsUrl().then((u) => setWsUrl(u ?? VOID_SERVE_WS_DEFAULT))
    onCleanup(off)
  })

  async function startBridge() {
    setBridge({ state: "starting" })
    try {
      const next = await window.voidex.bridgeStart()
      setBridge(next)
    } catch (err) {
      setBridge({ state: "error", error: String(err) })
    }
  }

  async function stopBridge() {
    await window.voidex.bridgeStop()
    setBridge({ state: "stopped" })
  }

  return (
    <div class="voidex-shell">
      <header class="voidex-titlebar">
        <div class="voidex-titlebar-left">
          <span class="voidex-asterisk" aria-hidden="true">
            ✱
          </span>
          <span class="voidex-product">Voidex</span>
          <span class="voidex-sep">·</span>
          <span class="voidex-channel">{channel()}</span>
        </div>
        <div class="voidex-titlebar-right">
          <span classList={{ "voidex-pill": true, [`voidex-pill-${bridge().state}`]: true }}>
            bridge: {bridge().state}
          </span>
          <Show when={bridge().state === "ready" || bridge().state === "starting"}>
            <button type="button" onClick={stopBridge}>
              stop bridge
            </button>
          </Show>
          <Show when={bridge().state !== "ready" && bridge().state !== "starting"}>
            <button type="button" onClick={startBridge}>
              start bridge
            </button>
          </Show>
        </div>
      </header>

      <main class="voidex-hero">
        <h1>
          <span class="voidex-hero-asterisk">✱</span>
          <span class="voidex-hero-title">Voidex</span>
        </h1>
        <p class="voidex-tagline">Void's desktop console. Forked from opencode.</p>

        <section class="voidex-card">
          <h2>Renderer ported</h2>
          <p>
            This window now runs Solid.js. The rich components from{" "}
            <code>@void-cli/voidex-app</code> (forked from opencode's desktop app) are
            vendored in this repo and ready to wire up.
          </p>
          <p>
            The last step is rewriting <code>@void-cli/voidex-sdk</code> so it speaks{" "}
            <code>void serve</code>'s wire protocol at{" "}
            <code>{wsUrl() ?? VOID_SERVE_WS_DEFAULT}</code> (and the matching HTTP
            endpoint at <code>{VOID_SERVE_HTTP_DEFAULT}</code>) instead of opencode's
            server.
          </p>
        </section>
      </main>
    </div>
  )
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) throw new Error("voidex: #root not found")

render(() => <App />, root)
