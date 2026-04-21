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

export type DisplayBackend = "auto" | "wayland" | "x11"

export type SidecarHealth = {
  ok: boolean
  url?: string
  state: "idle" | "starting" | "ready" | "error" | "stopped"
  error?: string
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
  /**
   * Sidecar health — a Platform-facing wrapper around the bridge state. Returns
   * a normalized shape the opencode `PlatformProvider` expects for its health
   * indicator. Currently driven off bridgeStatus.
   */
  sidecarHealth: () => Promise<SidecarHealth>
  onBridgeStatus: (cb: (status: BridgeStatus) => void) => () => void

  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  /** Clear every key in the named store. Used by opencode's AsyncStorage adapter. */
  storeClear: (name: string) => Promise<void>
  /** Key count in the named store. Used by opencode's AsyncStorage adapter. */
  storeLength: (name: string) => Promise<number>

  openDirectoryPicker: (opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
    /**
     * MIME accept hints — the renderer forwards these from `Platform.openFilePickerDialog`,
     * but the main process currently only uses `extensions`. Accepted so the
     * caller doesn't need a cast.
     */
    accept?: string[]
  }) => Promise<string | string[] | null>
  /** Native save-file dialog. Tauri provides this; we expose via Electron's dialog. */
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void

  getWindowCount: () => Promise<number>
  getWindowFocused: () => Promise<boolean>
  /** Show + focus the window. Opencode uses this when a notification is clicked. */
  showWindow: () => Promise<void>
  /** Focus the window without raising it. */
  setWindowFocus: () => Promise<void>
  relaunch: () => void
  /**
   * Wait for the main-process server to initialize. Opencode returns sidecar
   * credentials here; Voidex uses HTTP to `void serve`, so this just resolves
   * with `undefined` once the window is alive.
   */
  awaitInitialization: <T = undefined>(arg?: unknown) => Promise<T>
  /** Stop the backing server. Voidex doesn't bundle a sidecar — stub as no-op. */
  killSidecar: () => Promise<void>
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>

  /**
   * True only on WSL hosts; opencode's PlatformProvider uses this to decide
   * whether to surface the "wsl integration" toggle. Always false on macOS/
   * Linux/Windows desktops.
   */
  getWslEnabled: () => Promise<boolean>
  setWslEnabled: (v: boolean) => Promise<void>

  /**
   * Preferred display backend on Linux. Returns `null` on non-Linux platforms;
   * on Linux, we prefer whichever session the user is actually running under
   * (via XDG_SESSION_TYPE), falling back to `null` if unknown.
   */
  getDisplayBackend: () => Promise<DisplayBackend | null>
  setDisplayBackend: (backend: DisplayBackend) => Promise<void>

  /** Probe whether a desktop app exists. Used by openPath's "open in <editor>" menu. */
  checkAppExists: (appName: string) => Promise<boolean>

  /**
   * Resolve a launchable app's absolute path on disk. Opencode uses this to
   * feed `openPath(path, appPath)` on Windows. Voidex stubs as null — callers
   * fall back to the raw name.
   */
  resolveAppPath: (appName: string) => Promise<string | null>
  /**
   * WSL path translation (Windows-only). Non-Windows hosts resolve the input
   * unchanged. Present purely so the ported renderer compiles without branches.
   */
  wslPath: (path: string, target: "windows" | "linux") => Promise<string>
  /** Read the WSL-integration config. Voidex returns `{ enabled: false }` on macOS. */
  getWslConfig: () => Promise<{ enabled: boolean }>
  /** Write the WSL-integration config. */
  setWslConfig: (cfg: { enabled: boolean }) => Promise<void>

  /** Persisted default server URL (platform-level). */
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>

  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
}
