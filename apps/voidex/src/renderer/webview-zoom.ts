// Voidex — webview zoom signal.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT) — desktop-electron/src/renderer/webview-zoom.ts
//
// Opencode's `Platform.webviewZoom` is an Accessor<number> that the renderer
// bumps via keyboard shortcuts. We keep the same behavior and hit our preload
// API (`window.voidex.setZoomFactor`) to commit the value.

import { createSignal } from "solid-js"
import type { VoidexAPI } from "../preload/types"

declare global {
  interface Window {
    voidex: VoidexAPI
  }
}

const OS_NAME = (() => {
  if (typeof navigator === "undefined") return "unknown"
  if (navigator.userAgent.includes("Mac")) return "macos"
  if (navigator.userAgent.includes("Windows")) return "windows"
  if (navigator.userAgent.includes("Linux")) return "linux"
  return "unknown"
})()

const [webviewZoom, setWebviewZoom] = createSignal(1)

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

const clamp = (value: number) => Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)

const applyZoom = (next: number) => {
  setWebviewZoom(next)
  void window.voidex?.setZoomFactor(next)
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (!(OS_NAME === "macos" ? event.metaKey : event.ctrlKey)) return

    let newZoom = webviewZoom()

    if (event.key === "-") newZoom -= 0.2
    if (event.key === "=" || event.key === "+") newZoom += 0.2
    if (event.key === "0") newZoom = 1

    applyZoom(clamp(newZoom))
  })
}

export { webviewZoom }
