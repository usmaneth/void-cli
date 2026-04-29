/**
 * Wraps a streamed paragraph and applies confidence-tinted spans on
 * settle. While streaming, renders flat default-colored text. Once the
 * paragraph terminates, runs the regex classifier and re-renders with
 * colored spans.
 */
import * as React from 'react'
import { Text } from '../../ink.js'
import { getPalette } from '../../theme/index.js'
import {
  classifyParagraph,
  type ColoredSpan,
  type SpanColor,
} from '../../services/confidence/index.js'

export function resolveSpanColor(color: SpanColor): string {
  const p = getPalette()
  switch (color) {
    case 'default':
      return p.text.default
    case 'confident':
      return p.state.confident
    case 'codeRef':
      return p.role.voidProse
    case 'hedge':
      return p.state.warning
    case 'blocked':
      return p.state.failure
  }
}

export type BreathingParagraphProps = {
  text: string
  isStreaming: boolean
}

export function BreathingParagraph({
  text,
  isStreaming,
}: BreathingParagraphProps): React.ReactNode {
  const palette = getPalette()
  if (isStreaming) {
    return <Text color={palette.text.default}>{text}</Text>
  }
  const spans: ColoredSpan[] = classifyParagraph(text)
  return (
    <>
      {spans.map((s, i) => (
        <Text key={i} color={resolveSpanColor(s.color)}>
          {s.text}
        </Text>
      ))}
    </>
  )
}
