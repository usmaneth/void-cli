import { describe, expect, it } from 'vitest'
import {
  resolveEffortDotState,
  type EffortDotState,
} from '../EffortDot.js'

describe('resolveEffortDotState', () => {
  it('idle, normal context → green slow (2000ms)', () => {
    expect(resolveEffortDotState({ streamActive: false, contextRatio: 0.1 })).toEqual({
      colorToken: 'state.success',
      periodMs: 2000,
    } satisfies EffortDotState)
  })

  it('stream active, normal context → green fast (400ms)', () => {
    expect(resolveEffortDotState({ streamActive: true, contextRatio: 0.1 })).toEqual({
      colorToken: 'state.success',
      periodMs: 400,
    })
  })

  it('idle, context 85-95 → amber slow', () => {
    expect(resolveEffortDotState({ streamActive: false, contextRatio: 0.86 })).toEqual({
      colorToken: 'state.warning',
      periodMs: 2000,
    })
  })

  it('idle, context > 95 → red fast (urgent)', () => {
    expect(resolveEffortDotState({ streamActive: false, contextRatio: 0.97 })).toEqual({
      colorToken: 'state.failure',
      periodMs: 400,
    })
  })

  it('boundary: exactly 0.85 is amber territory', () => {
    expect(resolveEffortDotState({ streamActive: false, contextRatio: 0.85 }).colorToken).toBe('state.warning')
  })

  it('boundary: exactly 0.95 is red territory', () => {
    expect(resolveEffortDotState({ streamActive: false, contextRatio: 0.95 }).colorToken).toBe('state.failure')
  })
})
