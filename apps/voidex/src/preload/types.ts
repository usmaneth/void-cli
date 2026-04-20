// Voidex — shared preload types.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT).
export type TitlebarTheme = { mode: "light" | "dark" }

export type BridgeStatus =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "ready"; port: number; pid?: number }
  | { state: "error"; error: string }
  | { state: "stopped" }

export type VoidexHandoff = {
  mode?: "chat" | "swarm" | "deliberate" | "plan"
  prompt?: string
  model?: string
  models?: string[]
  rounds?: number
  cwd?: string
  sessionId?: string
  [k: string]: unknown
}

export type VoidexGlobals = {
  updaterEnabled: boolean
  deepLinks: string[]
  channel: "dev" | "beta" | "prod"
  voidexHandoff: VoidexHandoff | null
  voidexEnv: {
    mode: string | null
    prompt: string | null
    model: string | null
    models: string | null
    rounds: string | null
    sessionId: string | null
    cwd: string | null
  }
}

export type VoidexAPI = {
  parseMarkdownCommand: (md: string) => Promise<string>
  setBackgroundColor: (color: string) => Promise<void>
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>

  bridgeStart: () => Promise<BridgeStatus>
  bridgeStop: () => Promise<void>
  bridgeStatus: () => Promise<BridgeStatus>
  bridgeWsUrl: () => Promise<string | null>
  onBridgeStatus: (cb: (status: BridgeStatus) => void) => () => void

  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>

  openDirectoryPicker: (opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => Promise<string | string[] | null>
  openFilePicker: (opts?: { multiple?: boolean; title?: string; defaultPath?: string; extensions?: string[] }) => Promise<string | string[] | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void

  getWindowCount: () => Promise<number>
  getWindowFocused: () => Promise<boolean>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>

  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
}
