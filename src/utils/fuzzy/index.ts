/**
 * Lightweight fuzzy scorer & ranker (fuzzysort-style scoring) used by the
 * ListDialog + session list live search. Pure functions — safe to consume
 * from hooks, workers, and the Voidex renderer without any React
 * dependency.
 *
 * We avoid an external dependency (fuzzysort is not in package.json). The
 * scoring rules mirror fuzzysort's order-of-magnitude behaviour closely
 * enough for keyboard-driven pickers:
 *
 *   - All query characters must appear in order inside the target (subsequence).
 *   - Exact substring match beats a scattered subsequence match.
 *   - Word-boundary / camelCase matches score higher.
 *   - Consecutive character runs multiply their reward.
 *   - Matches earlier in the string score higher than later ones.
 *
 * Higher scores are better. Non-matches return `null` (filter with
 * `fuzzyRank`).
 */

export type FuzzyMatch<T> = {
  readonly item: T
  readonly score: number
  /** Indices of matching characters in the target string. */
  readonly indexes: readonly number[]
}

const WORD_BOUNDARY_BONUS = 80
const CAMEL_BOUNDARY_BONUS = 60
const CONSECUTIVE_BONUS = 40
const START_OF_STRING_BONUS = 100
const EXACT_SUBSTRING_BONUS = 500
const GAP_PENALTY = 2
const LEADING_GAP_PENALTY = 1

function isWordBoundary(target: string, idx: number): boolean {
  if (idx === 0) return true
  const prev = target.charCodeAt(idx - 1)
  // Space, _, -, /, ., :
  return (
    prev === 32 || prev === 95 || prev === 45 || prev === 47 ||
    prev === 46 || prev === 58
  )
}

function isCamelBoundary(target: string, idx: number): boolean {
  if (idx === 0) return false
  const prev = target.charCodeAt(idx - 1)
  const cur = target.charCodeAt(idx)
  // lower-case -> upper-case transition
  return prev >= 97 && prev <= 122 && cur >= 65 && cur <= 90
}

/**
 * Score a single target against a query. Returns `null` when the query is
 * not a subsequence of the target.
 */
export function fuzzyScore(
  target: string,
  query: string,
): { score: number; indexes: number[] } | null {
  if (query.length === 0) {
    return { score: 0, indexes: [] }
  }
  if (query.length > target.length) return null

  const t = target.toLowerCase()
  const q = query.toLowerCase()

  // Fast path: exact substring match is always the best outcome.
  const exactIdx = t.indexOf(q)
  if (exactIdx !== -1) {
    const indexes: number[] = []
    for (let i = 0; i < q.length; i++) indexes.push(exactIdx + i)
    let score = EXACT_SUBSTRING_BONUS + q.length * CONSECUTIVE_BONUS
    if (exactIdx === 0) score += START_OF_STRING_BONUS
    if (isWordBoundary(target, exactIdx)) score += WORD_BOUNDARY_BONUS
    // Earlier matches score higher.
    score -= exactIdx * LEADING_GAP_PENALTY
    return { score, indexes }
  }

  // Subsequence scan with greedy-leftmost matching plus bonuses.
  const indexes: number[] = []
  let score = 0
  let ti = 0
  let lastMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q.charCodeAt(qi)
    let found = -1
    while (ti < t.length) {
      if (t.charCodeAt(ti) === qc) {
        found = ti
        break
      }
      ti++
    }
    if (found === -1) return null

    indexes.push(found)
    // Bonuses
    if (isWordBoundary(target, found)) score += WORD_BOUNDARY_BONUS
    if (isCamelBoundary(target, found)) score += CAMEL_BOUNDARY_BONUS
    if (found === lastMatch + 1) score += CONSECUTIVE_BONUS
    if (found === 0) score += START_OF_STRING_BONUS
    // Gap penalty for characters skipped since last match.
    const gap = lastMatch === -2 ? found : found - lastMatch - 1
    score -= gap * (lastMatch === -2 ? LEADING_GAP_PENALTY : GAP_PENALTY)

    lastMatch = found
    ti++
  }
  return { score, indexes }
}

/**
 * Rank a list of items by their fuzzy score against a query. Non-matching
 * items are filtered out. Returns the best match first.
 *
 * `getText` may return multiple haystacks per item (e.g. title + summary +
 * first message). The best field-score wins and that field's indexes are
 * preserved.
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string | readonly string[],
): FuzzyMatch<T>[] {
  const trimmed = query.trim()
  if (trimmed === '') {
    return items.map(item => ({ item, score: 0, indexes: [] }))
  }

  const out: FuzzyMatch<T>[] = []
  for (const item of items) {
    const text = getText(item)
    const fields = typeof text === 'string' ? [text] : text
    let best: { score: number; indexes: number[] } | null = null
    for (const field of fields) {
      const res = fuzzyScore(field, trimmed)
      if (res === null) continue
      if (best === null || res.score > best.score) best = res
    }
    if (best !== null) {
      out.push({ item, score: best.score, indexes: best.indexes })
    }
  }

  // Stable sort descending by score.
  out.sort((a, b) => b.score - a.score)
  return out
}

/**
 * Debounced accessor for a query string. Pure utility used by the session
 * picker's 150ms debounce.
 */
export function makeDebouncer<T extends unknown[]>(
  fn: (...args: T) => void,
  delayMs: number,
): { call: (...args: T) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    call(...args: T) {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fn(...args)
      }, delayMs)
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
