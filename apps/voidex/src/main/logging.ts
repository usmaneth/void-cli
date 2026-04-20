// Voidex — file logging (rolling, auto-cleanup)
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT).
import log from "electron-log/main.js"
import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000

export function initLogging() {
  log.transports.file.maxSize = 5 * 1024 * 1024
  cleanup()
  return log
}

export function tail(): string {
  try {
    const p = log.transports.file.getFile().path
    const contents = readFileSync(p, "utf8")
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  } catch {
    return ""
  }
}

function cleanup() {
  try {
    const p = log.transports.file.getFile().path
    const dir = dirname(p)
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry)
      try {
        const info = statSync(file)
        if (!info.isFile()) continue
        if (info.mtimeMs < cutoff) unlinkSync(file)
      } catch {
        continue
      }
    }
  } catch {
    // logging cleanup is non-critical
  }
}
