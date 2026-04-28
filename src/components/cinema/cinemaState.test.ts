import { describe, expect, it } from 'vitest'
import { resolveCinemaMode, type CinemaModeInput } from './cinemaState.js'

describe('resolveCinemaMode', () => {
  const baseInput: CinemaModeInput = {
    isTTY: true,
    cols: 80,
    rows: 24,
    introFlag: 'auto',
    envNoCinema: false,
    lastBootMtimeMs: undefined,
    nowMs: new Date('2026-04-28T12:00:00Z').getTime(),
  }

  it('returns "skip" if non-TTY', () => {
    expect(resolveCinemaMode({ ...baseInput, isTTY: false })).toBe('skip')
  })

  it('returns "skip" if VOID_NO_CINEMA env', () => {
    expect(resolveCinemaMode({ ...baseInput, envNoCinema: true })).toBe('skip')
  })

  it('returns "skip" if --intro off', () => {
    expect(resolveCinemaMode({ ...baseInput, introFlag: 'off' })).toBe('skip')
  })

  it('returns "skip" if cols < 40', () => {
    expect(resolveCinemaMode({ ...baseInput, cols: 39 })).toBe('skip')
  })

  it('returns "skip" if rows < 15', () => {
    expect(resolveCinemaMode({ ...baseInput, rows: 14 })).toBe('skip')
  })

  it('returns "compressed" if --intro quick', () => {
    expect(resolveCinemaMode({ ...baseInput, introFlag: 'quick' })).toBe('compressed')
  })

  it('returns "full" on first boot of the day (no mtime)', () => {
    expect(resolveCinemaMode({ ...baseInput, lastBootMtimeMs: undefined })).toBe('full')
  })

  it('returns "full" if last boot was on a previous calendar day', () => {
    const yesterday = new Date('2026-04-27T22:00:00Z').getTime()
    expect(resolveCinemaMode({ ...baseInput, lastBootMtimeMs: yesterday })).toBe('full')
  })

  it('returns "compressed" if last boot was earlier today', () => {
    const earlierToday = new Date('2026-04-28T08:00:00Z').getTime()
    expect(resolveCinemaMode({ ...baseInput, lastBootMtimeMs: earlierToday })).toBe('compressed')
  })

  it('full beats compressed when --intro full overrides', () => {
    const earlierToday = new Date('2026-04-28T08:00:00Z').getTime()
    expect(resolveCinemaMode({ ...baseInput, lastBootMtimeMs: earlierToday, introFlag: 'full' })).toBe('full')
  })

  it('skip beats everything', () => {
    expect(resolveCinemaMode({
      ...baseInput,
      envNoCinema: true,
      introFlag: 'full',
    })).toBe('skip')
  })
})
