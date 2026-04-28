import { describe, expect, it } from 'vitest'
import { compress, type AnimationSpec } from './animationSpec.js'

describe('compress', () => {
  const sample: AnimationSpec = {
    totalFrames: 100,
    keyframes: [
      { atFrame: 0, state: { phase: 'start' } },
      { atFrame: 50, state: { phase: 'mid' } },
      { atFrame: 100, state: { phase: 'end' } },
    ],
  }

  it('scales totalFrames by factor', () => {
    expect(compress(sample, 0.5).totalFrames).toBe(50)
    expect(compress(sample, 0.18).totalFrames).toBe(18)
  })

  it('scales each keyframe.atFrame by factor (rounded)', () => {
    const c = compress(sample, 0.5)
    expect(c.keyframes[0]!.atFrame).toBe(0)
    expect(c.keyframes[1]!.atFrame).toBe(25)
    expect(c.keyframes[2]!.atFrame).toBe(50)
  })

  it('preserves keyframe.state shape', () => {
    const c = compress(sample, 0.18)
    expect(c.keyframes[1]!.state).toEqual({ phase: 'mid' })
  })

  it('factor 1.0 returns equivalent spec', () => {
    const c = compress(sample, 1.0)
    expect(c.totalFrames).toBe(100)
    expect(c.keyframes).toEqual(sample.keyframes)
  })

  it('factor 0 returns spec with totalFrames 0', () => {
    const c = compress(sample, 0)
    expect(c.totalFrames).toBe(0)
  })
})
