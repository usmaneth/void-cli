/**
 * Regex pattern strings for the breathing-document classifier.
 * Compiled at module init. Match-first dispatch in classifier.ts.
 *
 *   HEDGE_RE     → amber (uncertainty markers)
 *   BLOCKED_RE   → red (blocking failures)
 *   CONFIDENT_RE → bright white (anchor phrases)
 *   CODE_REF_RE  → cyan (file paths and code identifiers)
 */

export const HEDGE_RE =
  /\b(?:might (?:also )?|maybe|possibly|probably|perhaps|seems? (?:to|like)|appears? to|likely|i (?:think|believe|guess|suspect)|not (?:100% )?(?:sure|certain)|haven'?t (?:traced|verified|tested|checked|confirmed)|kind of|sort of|roughly|approximately|in theory|on the surface|at first glance|untested|inferred)\b/i

export const BLOCKED_RE =
  /\b(?:manual (?:verification|action|check) (?:is )?(?:needed|required)|failed|can'?t|cannot|unable to|not available|blocked|stuck|broken|errored|crashed|timed? out|exceeded (?:limit|quota|budget))\b/i

export const CONFIDENT_RE =
  /\b(?:specifically|exactly|the fix:?|the (?:bug|issue|problem) is|here(?:'s)? (?:the|what)|confirmed|verified|tested|all (?:tests )?pass(?:ed)?|done\.?|complete\.?|fixed\.?)\b/i

export const CODE_REF_RE =
  /\b[a-zA-Z_][a-zA-Z0-9_./]*\.[a-z]{1,4}(?::\d+)?\b/
