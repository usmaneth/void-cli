// Voidex — preload script. Exposes a narrow, typed API via contextBridge.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT).
import { contextBridge, ipcRenderer } from "electron"
import type { BridgeStatus, TitlebarTheme, VoidexAPI } from "./types"

const api: VoidexAPI = {
  parseMarkdownCommand: (md) => ipcRenderer.invoke("parse-markdown", md),
  setBackgroundColor: (color) => ipcRenderer.invoke("set-background-color", color),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),

  bridgeStart: () => ipcRenderer.invoke("bridge-start"),
  bridgeStop: () => ipcRenderer.invoke("bridge-stop"),
  bridgeStatus: () => ipcRenderer.invoke("bridge-status"),
  bridgeWsUrl: () => ipcRenderer.invoke("bridge-ws-url"),
  sidecarHealth: () => ipcRenderer.invoke("sidecar-health"),
  onBridgeStatus: (cb) => {
    const handler = (_: unknown, status: BridgeStatus) => cb(status)
    ipcRenderer.on("bridge-status", handler)
    return () => ipcRenderer.removeListener("bridge-status", handler)
  },

  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),

  getWslEnabled: () => ipcRenderer.invoke("get-wsl-enabled"),
  setWslEnabled: (v) => ipcRenderer.invoke("set-wsl-enabled", v),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (b) => ipcRenderer.invoke("set-display-backend", b),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme: TitlebarTheme) => ipcRenderer.invoke("set-titlebar", theme),

  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },
}

contextBridge.exposeInMainWorld("voidex", api)
