/**
 * Match-first dispatch over the regex pattern families. Returns one of
 * five SpanColor values per span. Conflict rule: a span containing both
 * hedge and confident markers (without blocked) falls back to default —
 * the conflict itself signals ambiguity. Blocked beats everything.
 */
import {
  HEDGE_RE,
  BLOCKED_RE,
  CONFIDENT_RE,
  CODE_REF_RE,
} from './rules.js'

export type SpanColor =
  | 'default'
  | 'confident'
  | 'codeRef'
  | 'hedge'
  | 'blocked'

export function classifySpan(text: string): SpanColor {
  if (BLOCKED_RE.test(text)) return 'blocked'

  const hasHedge = HEDGE_RE.test(text)
  const hasConfident = CONFIDENT_RE.test(text)

  if (hasHedge && hasConfident) return 'default'
  if (hasHedge) return 'hedge'
  if (hasConfident) return 'confident'

  if (CODE_REF_RE.test(text)) return 'codeRef'
  return 'default'
}
