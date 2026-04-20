// Voidex — IPC handler registration.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT). Trimmed to the surface Voidex currently uses.
import { execFile } from "node:child_process"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { TitlebarTheme } from "../preload/types"
import { getStore } from "./store"
import { setTitlebar } from "./windows"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

type Deps = {
  parseMarkdown: (markdown: string) => Promise<string> | string
  setBackgroundColor: (color: string) => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  bridgeStart: () => Promise<any>
  bridgeStop: () => void
  bridgeStatus: () => any
  bridgeWsUrl: () => string | null
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("parse-markdown", (_e, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("set-background-color", (_e, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("run-updater", (_e, alertOnFail: boolean) => deps.runUpdater(alertOnFail))
  ipcMain.handle("check-update", () => deps.checkUpdate())
  ipcMain.handle("install-update", () => deps.installUpdate())

  ipcMain.handle("bridge-start", () => deps.bridgeStart())
  ipcMain.handle("bridge-stop", () => deps.bridgeStop())
  ipcMain.handle("bridge-status", () => deps.bridgeStatus())
  ipcMain.handle("bridge-ws-url", () => deps.bridgeWsUrl())

  ipcMain.handle("store-get", (_e, name: string, key: string) => {
    const store = getStore(name)
    const value = store.get(key)
    if (value === undefined || value === null) return null
    return typeof value === "string" ? value : JSON.stringify(value)
  })
  ipcMain.handle("store-set", (_e, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_e, name: string, key: string) => {
    getStore(name).delete(key)
  })
  ipcMain.handle("store-keys", (_e, name: string) => Object.keys(getStore(name).store))

  ipcMain.handle(
    "open-directory-picker",
    async (_e, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle("open-file-picker", async (_e, opts?: any) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
      title: opts?.title ?? "Choose a file",
      defaultPath: opts?.defaultPath,
      filters: pickerFilters(opts?.extensions),
    })
    if (result.canceled) return null
    return opts?.multiple ? result.filePaths : result.filePaths[0]
  })

  ipcMain.on("open-link", (_e: IpcMainEvent, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.handle("open-path", async (_e, p: string, appName?: string) => {
    if (!appName) return shell.openPath(p)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin"
          ? (["open", ["-a", appName, p]] as const)
          : ([appName, [p]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.on("show-notification", (_e: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)
  ipcMain.handle("get-window-focused", (e: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.on("relaunch", () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle("get-zoom-factor", (e: IpcMainInvokeEvent) => e.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (e: IpcMainInvokeEvent, factor: number) => e.sender.setZoomFactor(factor))
  ipcMain.handle("set-titlebar", (e: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}

export function sendBridgeStatus(win: BrowserWindow, status: unknown) {
  win.webContents.send("bridge-status", status)
}
