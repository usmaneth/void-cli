/**
 * Per-row renderer for the living-gutter rail. Given density + event
 * for the current row, computes (glyph, color).
 *
 * In minimal mode the rail collapses all event glyphs to `│` — only
 * the color carries information. Full and compressed keep the heartbeat
 * glyphs.
 */
import * as React from 'react'
import { Text } from '../../ink.js'
import { getRoleColor } from './glyphGrammar.js'
import { resolveEventGlyph, type GutterEvent } from './eventStream.js'
import type { Density } from './densityResolver.js'

export type RailLineInput = {
  density: Density
  event: GutterEvent
}

export type RailLineState = {
  glyph: string
  color: string
}

export function computeRailLine(input: RailLineInput): RailLineState {
  const tuple = resolveEventGlyph(input.event)
  const color = getRoleColor(tuple.role)

  if (input.density === 'minimal') {
    return { glyph: '│', color }
  }

  return { glyph: tuple.glyph, color }
}

export type GutterRailProps = {
  density: Density
  event: GutterEvent
}

export function GutterRail({
  density,
  event,
}: GutterRailProps): React.ReactNode {
  const { glyph, color } = computeRailLine({ density, event })
  return <Text color={color}>{glyph}</Text>
}
