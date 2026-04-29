/**
 * Public API: paragraph string → ColoredSpan[].
 *
 * Splits paragraph on clause boundaries (`,;:.`), classifies each span,
 * returns typed result. resolveRailColor summarizes the array — used by
 * ConfidenceRail to color the left-margin glyph.
 */
import { classifySpan, type SpanColor } from './classifier.js'

export type ColoredSpan = {
  text: string
  color: SpanColor
}

const SPLIT_RE = /([,;:.])/

export function classifyParagraph(text: string): ColoredSpan[] {
  if (!text) return []
  const tokens = text.split(SPLIT_RE)
  const spans: ColoredSpan[] = []
  let current = ''
  for (const t of tokens) {
    // Punctuation tokens come back as single chars. Append to current
    // span and flush so each span stays a contiguous slice.
    if (t.length === 1 && /[,;:.]/.test(t)) {
      current += t
      const trimmed = current.trim()
      if (trimmed.length > 0) {
        spans.push({ text: current, color: classifySpan(trimmed) })
      }
      current = ''
      continue
    }
    current += t
  }
  if (current.length > 0) {
    const trimmed = current.trim()
    if (trimmed.length > 0) {
      spans.push({ text: current, color: classifySpan(trimmed) })
    }
  }
  return spans
}

export function resolveRailColor(spans: readonly ColoredSpan[]): SpanColor {
  let hasHedge = false
  let hasConfidentish = false
  for (const s of spans) {
    if (s.color === 'blocked') return 'blocked'
    if (s.color === 'hedge') hasHedge = true
    if (s.color === 'confident' || s.color === 'codeRef') hasConfidentish = true
  }
  if (hasHedge) return 'hedge'
  if (hasConfidentish) return 'confident'
  return 'default'
}
