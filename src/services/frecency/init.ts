/**
 * Frecency service initialization.
 *
 * Wires the frecency store into void's file-read lifecycle:
 *   - Read / view via the Read tool -> bump
 *   - Edit / Write tools hit Read on the way in, so edits are covered too
 *   - @-mention file expansions -> bumped inside fileref/expandFileReferences
 *
 * Call `initFrecency()` once at startup (background housekeeping).
 */

import { getFrecencyStore } from './store.js'
import { registerFileReadListener } from '../../tools/FileReadTool/FileReadTool.js'

let initialized = false

export function initFrecency(): void {
  if (initialized) return
  initialized = true

  // Pre-load so the first @-mention autocomplete doesn't pay a disk read.
  const store = getFrecencyStore()

  registerFileReadListener((filePath: string) => {
    store.bump(filePath)
  })
}
