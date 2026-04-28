/**
 * Resolves cinema playback mode from environmental signals.
 * Pure resolver — caller does the env/fs/process reads.
 */

export type CinemaMode = 'full' | 'compressed' | 'skip'
export type IntroFlag = 'auto' | 'quick' | 'full' | 'off'

const MIN_COLS = 40
const MIN_ROWS = 15

export type CinemaModeInput = {
  isTTY: boolean
  cols: number
  rows: number
  introFlag: IntroFlag
  envNoCinema: boolean
  lastBootMtimeMs: number | undefined
  nowMs: number
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export function resolveCinemaMode(input: CinemaModeInput): CinemaMode {
  if (!input.isTTY) return 'skip'
  if (input.envNoCinema) return 'skip'
  if (input.introFlag === 'off') return 'skip'
  if (input.cols < MIN_COLS || input.rows < MIN_ROWS) return 'skip'

  if (input.introFlag === 'quick') return 'compressed'
  if (input.introFlag === 'full') return 'full'

  if (input.lastBootMtimeMs === undefined) return 'full'
  return isSameLocalDay(input.lastBootMtimeMs, input.nowMs) ? 'compressed' : 'full'
}
