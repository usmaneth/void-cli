import { describe, expect, it } from 'vitest'
import {
  HEARTBEAT_GLYPHS,
  FRAMING_GLYPHS,
  getRoleColor,
  type HeartbeatEvent,
  type Role,
} from './glyphGrammar.js'
import { getPalette } from '../../theme/index.js'

describe('HEARTBEAT_GLYPHS', () => {
  it('has all 6 events from spec', () => {
    const expected: HeartbeatEvent[] = [
      'steady', 'eventStart', 'eventEnd', 'branch', 'success', 'failure',
    ]
    expect(Object.keys(HEARTBEAT_GLYPHS).sort()).toEqual(expected.sort())
  })

  it('uses correct unicode glyphs', () => {
    expect(HEARTBEAT_GLYPHS.steady).toBe('┃')
    expect(HEARTBEAT_GLYPHS.eventStart).toBe('╽')
    expect(HEARTBEAT_GLYPHS.eventEnd).toBe('╿')
    expect(HEARTBEAT_GLYPHS.branch).toBe('┣')
    expect(HEARTBEAT_GLYPHS.success).toBe('╋')
    expect(HEARTBEAT_GLYPHS.failure).toBe('╳')
  })
})

describe('FRAMING_GLYPHS', () => {
  it('top/body/bottom defined', () => {
    expect(FRAMING_GLYPHS.top).toBe('╭─')
    expect(FRAMING_GLYPHS.body).toBe('│')
    expect(FRAMING_GLYPHS.bottom).toBe('╰─')
  })
})

describe('getRoleColor', () => {
  it('maps all 5 roles to palette tokens', () => {
    const roles: Role[] = ['you', 'voidProse', 'voidWrite', 'success', 'failure']
    for (const r of roles) {
      expect(getRoleColor(r)).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('you = palette.role.you', () => {
    const palette = getPalette()
    expect(getRoleColor('you')).toBe(palette.role.you)
  })

  it('voidProse = palette.role.voidProse', () => {
    const palette = getPalette()
    expect(getRoleColor('voidProse')).toBe(palette.role.voidProse)
  })

  it('failure = palette.state.failure', () => {
    const palette = getPalette()
    expect(getRoleColor('failure')).toBe(palette.state.failure)
  })
})
