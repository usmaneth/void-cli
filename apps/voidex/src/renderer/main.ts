/*
 * Voidex renderer.
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 void-cli contributors
 *
 * Vanilla TS keeps the renderer tight while we iterate on the design.
 * When we're ready, this can be re-platformed to React (void's native stack)
 * without changing the main/preload surface.
 *
 * NOTE: all rendering uses textContent / createElement. We never set innerHTML
 * from user-controlled data.
 */

import type { BridgeStatus, VoidexAPI, VoidexGlobals, VoidexHandoff } from "../preload/types"

type Thread = {
  id: string
  title: string
  createdAt: number
  messages: Array<{ role: "user" | "assistant"; text: string; at: number }>
}

declare global {
  interface Window {
    voidex: VoidexAPI
    __VOIDEX__?: VoidexGlobals
  }
}

const STORE_NAME = "voidex.threads"
const api = window.voidex

function $<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el as T
}

function channel(): VoidexGlobals["channel"] {
  return window.__VOIDEX__?.channel ?? "dev"
}

function handoff(): VoidexHandoff | null {
  const direct = window.__VOIDEX__?.voidexHandoff ?? null
  if (direct) return direct
  const env = window.__VOIDEX__?.voidexEnv
  if (!env) return null
  const any = Object.values(env).some((v) => v != null)
  if (!any) return null
  return {
    mode: (env.mode as VoidexHandoff["mode"]) ?? undefined,
    prompt: env.prompt ?? undefined,
    model: env.model ?? undefined,
    models: env.models ? env.models.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    rounds: env.rounds ? Number(env.rounds) : undefined,
    sessionId: env.sessionId ?? undefined,
    cwd: env.cwd ?? undefined,
  }
}

let currentMode: NonNullable<VoidexHandoff["mode"]> = "chat"
let threads: Thread[] = []
let activeThreadId: string | null = null

async function loadThreads() {
  try {
    const raw = await api.storeGet(STORE_NAME, "list")
    if (raw) threads = JSON.parse(raw) as Thread[]
  } catch (err) {
    console.warn("failed loading threads", err)
  }
}

async function saveThreads() {
  try {
    await api.storeSet(STORE_NAME, "list", JSON.stringify(threads))
  } catch (err) {
    console.warn("failed saving threads", err)
  }
}

function makeThread(title = "New thread"): Thread {
  return { id: cryptoRandomId(), title, createdAt: Date.now(), messages: [] }
}

function cryptoRandomId() {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")
}

function empty(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild)
}

function renderThreadList() {
  const list = $("#thread-list")
  empty(list)
  if (threads.length === 0) {
    const li = document.createElement("li")
    li.className = "list-item list-item-muted"
    li.textContent = "no threads yet"
    list.appendChild(li)
    return
  }
  for (const t of threads) {
    const li = document.createElement("li")
    li.className = "list-item" + (t.id === activeThreadId ? " active" : "")
    const dot = document.createElement("span")
    dot.className = "list-item-dot"
    li.appendChild(dot)
    const span = document.createElement("span")
    span.textContent = t.title
    li.appendChild(span)
    li.addEventListener("click", () => {
      activeThreadId = t.id
      renderThreadList()
      renderTranscript()
    })
    list.appendChild(li)
  }
}

function renderWelcome(target: HTMLElement) {
  empty(target)
  const wrap = document.createElement("div")
  wrap.className = "welcome"

  const h1 = document.createElement("h1")
  h1.className = "hero"
  const astx = document.createElement("span")
  astx.className = "hero-asterisk"
  astx.textContent = "\u2731"
  const title = document.createElement("span")
  title.className = "hero-title"
  title.textContent = "Voidex"
  h1.append(astx, title)

  const sub = document.createElement("p")
  sub.className = "hero-sub"
  sub.textContent = "Void's desktop console. Swarm, deliberate, and ship from one window."

  const tips = document.createElement("ul")
  tips.className = "hero-tips"
  const mkTip = (parts: Array<{ kind: "text" | "kbd" | "code"; value: string }>) => {
    const li = document.createElement("li")
    for (const p of parts) {
      if (p.kind === "text") li.appendChild(document.createTextNode(p.value))
      else {
        const n = document.createElement(p.kind)
        n.textContent = p.value
        li.appendChild(n)
      }
    }
    return li
  }
  tips.append(
    mkTip([
      { kind: "text", value: "Press " },
      { kind: "kbd", value: "/" },
      { kind: "text", value: " to type a slash command (try " },
      { kind: "code", value: "/swarm" },
      { kind: "text", value: " or " },
      { kind: "code", value: "/deliberate" },
      { kind: "text", value: ")." },
    ]),
    mkTip([
      { kind: "text", value: "Start the bridge to talk to " },
      { kind: "code", value: "void serve" },
      { kind: "text", value: ", or just scribble offline." },
    ]),
    mkTip([{ kind: "text", value: "Pick a mode in the sidebar to prefill the composer." }]),
  )

  wrap.append(h1, sub, tips)
  target.appendChild(wrap)
}

function renderTranscript() {
  const transcript = $("#transcript")
  const t = threads.find((x) => x.id === activeThreadId)
  if (!t) {
    renderWelcome(transcript)
    return
  }
  empty(transcript)
  for (const m of t.messages) {
    const div = document.createElement("div")
    div.className = "msg" + (m.role === "user" ? " msg-user" : "")
    const role = document.createElement("div")
    role.className = "msg-role"
    role.textContent = m.role
    const body = document.createElement("div")
    body.className = "msg-body"
    body.textContent = m.text
    div.append(role, body)
    transcript.appendChild(div)
  }
  transcript.scrollTop = transcript.scrollHeight
}

function setMode(m: typeof currentMode) {
  currentMode = m
  for (const c of document.querySelectorAll<HTMLButtonElement>(".chip[data-mode]")) {
    c.classList.toggle("chip-active", c.dataset.mode === m)
  }
  $("#composer-mode").textContent = m
}

function setBridgeStatus(s: BridgeStatus) {
  const dot = $("#bridge-status .dot")
  const text = $("#bridge-status-text")
  dot.className = "dot"
  switch (s.state) {
    case "idle":
      dot.classList.add("dot-idle")
      text.textContent = "bridge: offline"
      break
    case "starting":
      dot.classList.add("dot-starting")
      text.textContent = "bridge: starting\u2026"
      break
    case "ready":
      dot.classList.add("dot-ready")
      text.textContent = `bridge: ready @ ${s.port}`
      break
    case "error":
      dot.classList.add("dot-error")
      text.textContent = `bridge: ${s.error.slice(0, 60)}`
      break
    case "stopped":
      dot.classList.add("dot-stopped")
      text.textContent = "bridge: stopped"
      break
  }
}

async function handleSend() {
  const input = $<HTMLTextAreaElement>("#composer-input")
  const text = input.value.trim()
  if (!text) return
  let t = threads.find((x) => x.id === activeThreadId)
  if (!t) {
    t = makeThread(text.slice(0, 40))
    threads.unshift(t)
    activeThreadId = t.id
  }
  t.messages.push({ role: "user", text, at: Date.now() })

  const stub = [
    `[${currentMode}] Voidex received your prompt.`,
    "",
    "The bridge to `void serve` is a stub today — see apps/voidex/README.md for",
    "the WebSocket protocol plan. Once wired, replies will stream in here.",
  ].join("\n")
  t.messages.push({ role: "assistant", text: stub, at: Date.now() })
  input.value = ""
  await saveThreads()
  renderThreadList()
  renderTranscript()
}

async function init() {
  const appEl = document.querySelector<HTMLElement>(".app")
  if (appEl) appEl.dataset.channel = channel()
  $("#channel-label").textContent = channel()

  const ho = handoff()
  if (ho) {
    const banner = $("#handoff-banner")
    banner.hidden = false
    banner.textContent =
      `Handoff from CLI: mode=${ho.mode ?? "chat"}` +
      (ho.model ? `, model=${ho.model}` : "") +
      (ho.models?.length ? `, models=${ho.models.join(",")}` : "") +
      (ho.rounds ? `, rounds=${ho.rounds}` : "") +
      (ho.prompt ? `  \u2014  "${ho.prompt.slice(0, 80)}"` : "")

    if (ho.mode) setMode(ho.mode)
    if (ho.prompt) $<HTMLTextAreaElement>("#composer-input").value = ho.prompt
    if (ho.cwd) $("#composer-cwd").textContent = ho.cwd
  }

  for (const chip of document.querySelectorAll<HTMLButtonElement>(".chip[data-mode]")) {
    chip.addEventListener("click", () => {
      const m = chip.dataset.mode as typeof currentMode
      setMode(m)
    })
  }
  setMode(currentMode)

  $("#btn-send").addEventListener("click", () => void handleSend())
  $("#composer-input").addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault()
      void handleSend()
    }
  })
  $("#btn-new-session").addEventListener("click", () => {
    const t = makeThread()
    threads.unshift(t)
    activeThreadId = t.id
    renderThreadList()
    renderTranscript()
    void saveThreads()
  })
  $("#btn-start-bridge").addEventListener("click", async () => {
    const status = await api.bridgeStart()
    setBridgeStatus(status)
  })
  $("#btn-close-drawer").addEventListener("click", () => {
    $("#diff-drawer").hidden = true
  })

  api.onMenuCommand((id) => {
    if (id === "session.new") $("#btn-new-session").click()
    if (id === "sidebar.toggle") {
      const sb = document.querySelector<HTMLElement>(".sidebar")
      if (sb) sb.style.display = sb.style.display === "none" ? "" : "none"
    }
    if (id === "diff.toggle") {
      const d = $("#diff-drawer")
      d.hidden = !d.hidden
    }
  })

  api.onBridgeStatus(setBridgeStatus)

  const s = await api.bridgeStatus()
  setBridgeStatus(s)

  await loadThreads()
  renderThreadList()
  renderTranscript()
}

void init().catch((err) => {
  console.error("voidex renderer init failed", err)
})
