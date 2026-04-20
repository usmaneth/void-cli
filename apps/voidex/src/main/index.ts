// Voidex — Electron main process entrypoint.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT, Copyright (c) 2025 opencode).
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Event } from "electron"
import { app, BrowserWindow, dialog } from "electron"
import pkg from "electron-updater"

import { APP_IDS, APP_NAMES, CHANNEL, PROTOCOL_SCHEME, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendBridgeStatus, sendDeepLinks, sendMenuCommand } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { createMainWindow, setBackgroundColor, setDockIcon } from "./windows"
import { VoidBridge } from "./bridge"

// macOS apps run in `/` by default, which breaks ripgrep/find paths.
try {
  process.chdir(homedir())
} catch {}

// Set app identity before anything touches userData paths.
const appId = app.isPackaged ? APP_IDS[CHANNEL] : APP_IDS.dev
app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : APP_NAMES.dev)
app.setAppUserModelId(appId)
app.setPath("userData", join(app.getPath("appData"), appId))

const { autoUpdater } = pkg

const logger = initLogging()
logger.log("voidex starting", { version: app.getVersion(), packaged: app.isPackaged, channel: CHANNEL })

let mainWindow: BrowserWindow | null = null
const pendingDeepLinks: string[] = []
const bridge = new VoidBridge({ voidBin: process.env.VOID_BIN || "void" })

function readHandoff(): Record<string, unknown> | null {
  const p = process.env.VOIDEX_HANDOFF
  if (!p) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch (err) {
    logger.warn("failed reading VOIDEX_HANDOFF", err)
    return null
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

setupApp()

function setupApp() {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith(`${PROTOCOL_SCHEME}://`))
    if (urls.length) emitDeepLinks(urls)
    focusMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    emitDeepLinks([url])
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
      mainWindow = createMainWindow({ updaterEnabled: UPDATER_ENABLED, voidexHandoff: readHandoff(), deepLinks: pendingDeepLinks })
      wireMenu()
    } else {
      focusMainWindow()
    }
  })

  app.on("before-quit", () => bridge.stop())
  app.on("will-quit", () => bridge.stop())
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      bridge.stop()
      app.exit(0)
    })
  }

  void app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)
    setDockIcon()
    setupAutoUpdater()

    // Voidex defers bridge startup to the renderer's explicit request,
    // so smoke-running the app without `void` on PATH still works.
    bridge.on("status", (s) => {
      if (mainWindow) sendBridgeStatus(mainWindow, s)
    })

    mainWindow = createMainWindow({
      updaterEnabled: UPDATER_ENABLED,
      voidexHandoff: readHandoff(),
      deepLinks: pendingDeepLinks,
    })
    wireMenu()
  })
}

function wireMenu() {
  if (!mainWindow) return
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => void checkForUpdates(true),
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      bridge.stop()
      app.relaunch()
      app.exit(0)
    },
  })
}

registerIpcHandlers({
  parseMarkdown: (md) => parseMarkdown(md),
  setBackgroundColor: (c) => setBackgroundColor(c),
  runUpdater: (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: () => checkUpdate(),
  installUpdate: () => installUpdate(),
  bridgeStart: () => bridge.start(),
  bridgeStop: () => bridge.stop(),
  bridgeStatus: () => bridge.getStatus(),
  bridgeWsUrl: () => bridge.getWsUrl(),
})

function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    currentVersion: app.getVersion(),
  })
}

let updateReady = false

async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  updateReady = false
  try {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      return { updateAvailable: false }
    }
    await autoUpdater.downloadUpdate()
    updateReady = true
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

async function installUpdate() {
  if (!updateReady) return
  bridge.stop()
  autoUpdater.quitAndInstall()
}

async function checkForUpdates(alertOnFail: boolean) {
  if (!UPDATER_ENABLED) return
  const result: any = await checkUpdate()
  if (!result.updateAvailable) {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: result.failed ? "error" : "info",
      message: result.failed ? "Update check failed." : "You're up to date.",
      title: result.failed ? "Update Error" : "No Updates",
    })
    return
  }
  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${result.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await installUpdate()
}

// Silence no-unused-vars for existsSync import fence.
void existsSync
