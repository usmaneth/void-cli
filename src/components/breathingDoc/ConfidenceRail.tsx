/**
 * Single-character `▎` rendered with the paragraph's overall confidence
 * color. Resolves via resolveRailColor over the classifier's spans.
 */
import * as React from 'react'
import { Text } from '../../ink.js'
import {
  classifyParagraph,
  resolveRailColor,
} from '../../services/confidence/index.js'
import { resolveSpanColor } from './BreathingParagraph.js'

export type ConfidenceRailProps = {
  paragraphText: string
}

export function ConfidenceRail({ paragraphText }: ConfidenceRailProps): React.ReactNode {
  const spans = classifyParagraph(paragraphText)
  const rail = resolveRailColor(spans)
  return <Text color={resolveSpanColor(rail)}>▎</Text>
}
