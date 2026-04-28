import { describe, expect, it } from 'vitest'
import {
  resolveEventGlyph,
  type GutterEvent,
  type RailTuple,
} from './eventStream.js'

describe('resolveEventGlyph', () => {
  it('user message → eventStart glyph + you color', () => {
    const tuple = resolveEventGlyph({ type: 'userMessage' })
    expect(tuple.glyph).toBe('╽')
    expect(tuple.role).toBe('you')
  })

  it('void message after read → branch glyph + voidProse', () => {
    const tuple = resolveEventGlyph({ type: 'assistantMessage', kind: 'afterRead' })
    expect(tuple.glyph).toBe('┣')
    expect(tuple.role).toBe('voidProse')
  })

  it('void message default → eventStart glyph', () => {
    const tuple = resolveEventGlyph({ type: 'assistantMessage', kind: 'fresh' })
    expect(tuple.glyph).toBe('╽')
    expect(tuple.role).toBe('voidProse')
  })

  it('tool call begin → eventStart + voidProse for read tools', () => {
    const tuple = resolveEventGlyph({ type: 'toolCallBegin', toolName: 'Read' })
    expect(tuple.glyph).toBe('╽')
    expect(tuple.role).toBe('voidProse')
  })

  it('tool call begin → eventStart + voidWrite for write tools', () => {
    const tuple = resolveEventGlyph({ type: 'toolCallBegin', toolName: 'Edit' })
    expect(tuple.glyph).toBe('╽')
    expect(tuple.role).toBe('voidWrite')
  })

  it('tool call success → success glyph + success role', () => {
    const tuple = resolveEventGlyph({ type: 'toolCallEnd', success: true })
    expect(tuple.glyph).toBe('╋')
    expect(tuple.role).toBe('success')
  })

  it('tool call failure → failure glyph + failure role', () => {
    const tuple = resolveEventGlyph({ type: 'toolCallEnd', success: false })
    expect(tuple.glyph).toBe('╳')
    expect(tuple.role).toBe('failure')
  })

  it('idle (no event) → steady + previous role', () => {
    const tuple = resolveEventGlyph({ type: 'idle', previousRole: 'voidProse' })
    expect(tuple.glyph).toBe('┃')
    expect(tuple.role).toBe('voidProse')
  })

  it('idle with no previous role defaults to voidProse', () => {
    const tuple = resolveEventGlyph({ type: 'idle', previousRole: undefined })
    expect(tuple.role).toBe('voidProse')
  })
})
