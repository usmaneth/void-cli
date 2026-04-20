// Voidex — window creation & chrome.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT).
import windowState from "electron-window-state"
import { app, BrowserWindow, nativeImage, nativeTheme } from "electron"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { TitlebarTheme } from "../preload/types"
import { APP_NAMES, CHANNEL } from "./constants"

type Globals = {
  updaterEnabled: boolean
  deepLinks?: string[]
  voidexHandoff?: Record<string, unknown> | null
}

const root = dirname(fileURLToPath(import.meta.url))

let backgroundColor: string | undefined = "#0b0b0e" // void's dark canvas

export function setBackgroundColor(color: string) {
  backgroundColor = color
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(iconsDir(), `icon.${ext}`)
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: 40,
  }
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  if (process.platform !== "win32") return
  win.setTitleBarOverlay(overlay(theme))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow(globals: Globals) {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  const mode = tone()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: APP_NAMES[CHANNEL],
    icon: iconPath(),
    backgroundColor,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  state.manage(win)
  loadWindow(win, "index.html")
  wireZoom(win)
  injectGlobals(win, globals)

  win.once("ready-to-show", () => win.show())

  return win
}

function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    void win.loadURL(url.toString())
    return
  }
  void win.loadFile(join(root, `../renderer/${html}`))
}

function injectGlobals(win: BrowserWindow, globals: Globals) {
  win.webContents.on("dom-ready", () => {
    const deepLinks = globals.deepLinks ?? []
    const data = {
      updaterEnabled: globals.updaterEnabled,
      deepLinks: Array.isArray(deepLinks) ? deepLinks.splice(0) : deepLinks,
      channel: CHANNEL,
      voidexHandoff: globals.voidexHandoff ?? null,
      voidexEnv: {
        mode: process.env.VOIDEX_MODE ?? null,
        prompt: process.env.VOIDEX_PROMPT ?? null,
        model: process.env.VOIDEX_MODEL ?? null,
        models: process.env.VOIDEX_MODELS ?? null,
        rounds: process.env.VOIDEX_ROUNDS ?? null,
        sessionId: process.env.VOIDEX_SESSION_ID ?? null,
        cwd: process.env.VOIDEX_CWD ?? null,
      },
    }
    void win.webContents.executeJavaScript(
      `window.__VOIDEX__ = Object.assign(window.__VOIDEX__ ?? {}, ${JSON.stringify(data)})`,
    )
  })
}

function wireZoom(win: BrowserWindow) {
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", () => {
    win.webContents.setZoomFactor(1)
  })
}
