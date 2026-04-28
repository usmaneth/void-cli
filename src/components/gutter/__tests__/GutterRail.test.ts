import { describe, expect, it } from 'vitest'
import { computeRailLine, type RailLineInput } from '../GutterRail.js'
import { HEARTBEAT_GLYPHS } from '../glyphGrammar.js'

describe('computeRailLine', () => {
  const baseInput: RailLineInput = {
    density: 'full',
    event: { type: 'idle', previousRole: 'voidProse' },
  }

  it('full mode + idle → steady glyph', () => {
    const out = computeRailLine(baseInput)
    expect(out.glyph).toBe(HEARTBEAT_GLYPHS.steady)
    expect(out.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('full mode + userMessage → eventStart glyph', () => {
    const out = computeRailLine({
      density: 'full',
      event: { type: 'userMessage' },
    })
    expect(out.glyph).toBe(HEARTBEAT_GLYPHS.eventStart)
  })

  it('compressed mode preserves event glyph', () => {
    const out = computeRailLine({
      density: 'compressed',
      event: { type: 'toolCallEnd', success: true },
    })
    expect(out.glyph).toBe(HEARTBEAT_GLYPHS.success)
  })

  it('minimal mode collapses all events to solid │', () => {
    const eventStart = computeRailLine({
      density: 'minimal',
      event: { type: 'userMessage' },
    })
    const success = computeRailLine({
      density: 'minimal',
      event: { type: 'toolCallEnd', success: true },
    })
    expect(eventStart.glyph).toBe('│')
    expect(success.glyph).toBe('│')
  })

  it('minimal still color-switches by role', () => {
    const you = computeRailLine({
      density: 'minimal',
      event: { type: 'userMessage' },
    })
    const tool = computeRailLine({
      density: 'minimal',
      event: { type: 'toolCallBegin', toolName: 'Edit' },
    })
    expect(you.color).not.toBe(tool.color)
  })
})
