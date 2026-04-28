/**
 * Imperative entrypoints for the cinema layer:
 *   playEntry({ mode, cols, rows })  — mount PortalEntry, await done
 *   playExit({ mode, cols, rows })   — mount BlackHoleExit, await done
 *
 * `mode === 'skip'` resolves immediately. Both helpers wrap Ink's render
 * lifecycle: render → await onDone → unmount.
 *
 * Full entry = 2200ms; full exit = 2800ms; compressed = full × 0.18.
 *
 * On full-play entry completion, touches ~/.void/last-cinema-boot mtime
 * so resolveCinemaMode resolves to 'compressed' for subsequent same-day
 * launches. Read failures are non-fatal.
 */
import * as React from 'react'
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import { render } from '../../ink.js'
import { PortalEntry } from './portal/PortalEntry.js'
import { BlackHoleExit } from './blackhole/BlackHoleExit.js'
import type { CinemaMode } from './cinemaState.js'

const LAST_BOOT_FILE = join(homedir(), '.void', 'last-cinema-boot')

export { PortalEntry } from './portal/PortalEntry.js'
export { BlackHoleExit } from './blackhole/BlackHoleExit.js'
export {
  resolveCinemaMode,
  type CinemaMode,
  type IntroFlag,
  type CinemaModeInput,
} from './cinemaState.js'
export {
  compress,
  type AnimationSpec,
  type Keyframe,
} from './animationSpec.js'

const FULL_ENTRY_MS = 2200
const FULL_EXIT_MS = 2800
const COMPRESSED_FACTOR = 0.18

const VOID_BANNER = ['VOID', '────']

async function touchBootFile(): Promise<void> {
  try {
    const dir = join(homedir(), '.void')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(LAST_BOOT_FILE, '', { flag: 'w' })
  } catch {
    // Non-fatal — next-of-day check just falls through to "no mtime"
    // and plays the full intro again. Acceptable degradation.
  }
}

export async function readBootMtimeMs(): Promise<number | undefined> {
  try {
    const stat = await fs.stat(LAST_BOOT_FILE)
    return stat.mtimeMs
  } catch {
    return undefined
  }
}

export async function playEntry(input: {
  mode: CinemaMode
  cols: number
  rows: number
}): Promise<void> {
  if (input.mode === 'skip') return

  const durationMs =
    input.mode === 'full'
      ? FULL_ENTRY_MS
      : Math.round(FULL_ENTRY_MS * COMPRESSED_FACTOR)

  await new Promise<void>((resolve, reject) => {
    let inkInstance: Awaited<ReturnType<typeof render>> | undefined
    let pendingDone = false

    const onDone = () => {
      if (inkInstance) {
        inkInstance.unmount()
        resolve()
      } else {
        pendingDone = true
      }
    }

    render(
      React.createElement(PortalEntry, {
        durationMs,
        cols: input.cols,
        rows: input.rows,
        bannerLines: VOID_BANNER,
        onDone,
      }),
    )
      .then(instance => {
        inkInstance = instance
        if (pendingDone) {
          instance.unmount()
          resolve()
        }
      })
      .catch(reject)
  })

  if (input.mode === 'full') {
    await touchBootFile()
  }
}

export async function playExit(input: {
  mode: CinemaMode
  cols: number
  rows: number
}): Promise<void> {
  if (input.mode === 'skip') return

  const durationMs =
    input.mode === 'full'
      ? FULL_EXIT_MS
      : Math.round(FULL_EXIT_MS * COMPRESSED_FACTOR)

  await new Promise<void>((resolve, reject) => {
    let inkInstance: Awaited<ReturnType<typeof render>> | undefined
    let pendingDone = false

    const onDone = () => {
      if (inkInstance) {
        inkInstance.unmount()
        resolve()
      } else {
        pendingDone = true
      }
    }

    render(
      React.createElement(BlackHoleExit, {
        durationMs,
        cols: input.cols,
        rows: input.rows,
        onDone,
      }),
    )
      .then(instance => {
        inkInstance = instance
        if (pendingDone) {
          instance.unmount()
          resolve()
        }
      })
      .catch(reject)
  })
}
