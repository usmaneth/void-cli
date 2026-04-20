// Voidex — electron-store accessor (lazy so userData path is set first).
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
// Adapted from opencode (MIT).
import Store from "electron-store"
import { SETTINGS_STORE } from "./constants"

const cache = new Map<string, Store>()

// Instantiate lazily: module-load time runs before app.setPath("userData", ...)
// executes in index.ts, which would result in writes to the wrong directory.
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({ name, fileExtension: "", accessPropertiesByDotNotation: false })
  cache.set(name, next)
  return next
}
