// Voidex — macOS application menu.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT).
import { Menu, shell } from "electron"
import { APP_NAMES, CHANNEL, UPDATER_ENABLED } from "./constants"
import { createMainWindow } from "./windows"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  reload: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return

  const appName = APP_NAMES[CHANNEL]

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates\u2026",
          enabled: UPDATER_ENABLED,
          click: () => deps.checkForUpdates(),
        },
        { label: "Reload Webview", click: () => deps.reload() },
        { label: "Restart", click: () => deps.relaunch() },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Session", accelerator: "Shift+Cmd+S", click: () => deps.trigger("session.new") },
        { label: "Open Project\u2026", accelerator: "Cmd+O", click: () => deps.trigger("project.open") },
        {
          label: "New Window",
          accelerator: "Cmd+Shift+N",
          click: () => createMainWindow({ updaterEnabled: UPDATER_ENABLED }),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "Cmd+B", click: () => deps.trigger("sidebar.toggle") },
        { label: "Toggle Diff Review", accelerator: "Cmd+D", click: () => deps.trigger("diff.toggle") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        {
          label: "Void CLI Documentation",
          click: () => shell.openExternal("https://github.com/usmaneth/void-cli#readme"),
        },
        {
          label: "Report a Bug",
          click: () => shell.openExternal("https://github.com/usmaneth/void-cli/issues/new"),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
