// Voidex — app-wide constants
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT, Copyright (c) 2025 opencode).
import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
// electron-vite injects this at build time via `define`.
// @ts-ignore — import.meta.env is wired by electron-vite
const raw = typeof import.meta !== "undefined" ? (import.meta as any).env?.VOIDEX_CHANNEL : undefined
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const APP_NAMES: Record<Channel, string> = {
  dev: "Voidex Dev",
  beta: "Voidex Beta",
  prod: "Voidex",
}

export const APP_IDS: Record<Channel, string> = {
  dev: "ai.void.voidex.dev",
  beta: "ai.void.voidex.beta",
  prod: "ai.void.voidex",
}

export const PROTOCOL_SCHEME = "voidex"
export const SETTINGS_STORE = "voidex.settings"
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
