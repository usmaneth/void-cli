import { describe, expect, it } from 'vitest'
import { MOTIONS, type MotionCategory } from './motionLibrary.js'

describe('motionLibrary', () => {
  it('defines exactly the 8 categories from the spec', () => {
    const expected: MotionCategory[] = [
      'bash','web','fileEdit','modelThinking','subagent','compaction','mcp','remote',
    ]
    expect(Object.keys(MOTIONS).sort()).toEqual(expected.sort())
  })

  it('every motion has frames + period', () => {
    for (const [name, m] of Object.entries(MOTIONS)) {
      expect(m.frames.length, `${name} should have frames`).toBeGreaterThan(0)
      expect(m.periodMs, `${name} should have period`).toBeGreaterThan(0)
    }
  })

  it('every motion has a colorRole', () => {
    for (const [name, m] of Object.entries(MOTIONS)) {
      expect(['voidProse', 'voidWrite', 'accent', 'success', 'warning', 'failure'], `${name} role`).toContain(m.colorRole)
    }
  })

  it('bash uses filling-bar pattern (6 frames, 1.2s)', () => {
    expect(MOTIONS.bash.frames.length).toBe(6)
    expect(MOTIONS.bash.periodMs).toBe(1200)
    expect(MOTIONS.bash.frames[0]).toBe('▰▱▱▱▱▱')
    expect(MOTIONS.bash.frames[5]).toBe('▰▰▰▰▰▰')
  })

  it('web uses rotating-quarter pattern (4 frames, 1.6s)', () => {
    expect(MOTIONS.web.frames).toEqual(['◐', '◓', '◑', '◒'])
    expect(MOTIONS.web.periodMs).toBe(1600)
  })

  it('subagent uses diamond-pulse pattern', () => {
    expect(MOTIONS.subagent.frames).toContain('◆')
    expect(MOTIONS.subagent.periodMs).toBe(2000)
  })
})
