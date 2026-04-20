/**
 * Pluggable similarity scoring for council consensus modes.
 *
 * Two strategies:
 *   - `naive`     — normalize (lowercase, collapse whitespace, strip punctuation)
 *                   then do simple string equality + Jaccard token-set overlap.
 *                   Fast, no network. Default.
 *   - `embedding` — use a provider embeddings API + cosine similarity.
 *                   Opt-in via `VOID_COUNCIL_EMBEDDINGS=1`. If the provider
 *                   doesn't support embeddings, falls back to `naive`.
 *
 * Known limitations of the `naive` strategy:
 *   - Misses paraphrases ("open the door" vs "unlock the entrance").
 *   - Case/whitespace/punctuation only — two semantically identical answers
 *     with different wording will not match.
 *   - Jaccard threshold (default 0.85) is a heuristic; unrelated long answers
 *     can accidentally cross it.
 *
 * Known limitations of `embedding`:
 *   - No embeddings API wired in yet (provider-agnostic slot). The default
 *     resolver returns `null` so callers always fall back to naive.
 *   - Cost + latency: one extra round-trip per response.
 */

export type SimilarityStrategy = 'naive' | 'embedding'

export type SimilarityContext = {
  /** Strategy requested by the caller. Defaults to 'naive'. */
  strategy?: SimilarityStrategy
  /**
   * Threshold above which two answers are considered the "same cluster".
   * Default 0.85.
   */
  threshold?: number
  /**
   * Optional embedder — `null` return means "no embeddings available, fall back".
   * Only used when strategy === 'embedding'.
   */
  embed?: (text: string) => Promise<number[] | null>
}

const DEFAULT_THRESHOLD = 0.85

/**
 * Normalize text for the `naive` strategy.
 * Lowercase, collapse whitespace, strip most punctuation.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Token-set Jaccard. 1.0 = identical token set, 0.0 = disjoint. */
export function jaccard(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return inter / union
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!
    const bv = b[i]!
    dot += av * bv
    na += av * av
    nb += bv * bv
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Compute a pairwise similarity score in [0, 1] between two response texts.
 *
 * Resolves to 1.0 on exact normalized match, otherwise Jaccard overlap or
 * embedding cosine.
 */
export async function similarity(
  a: string,
  b: string,
  ctx: SimilarityContext = {},
): Promise<number> {
  const strategy = ctx.strategy ?? 'naive'
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1

  if (strategy === 'embedding' && ctx.embed) {
    try {
      const [va, vb] = await Promise.all([ctx.embed(a), ctx.embed(b)])
      if (va && vb) return cosine(va, vb)
    } catch {
      // fall through to naive
    }
  }
  return jaccard(na, nb)
}

/** Helper — are two normalized/embedded answers in the same cluster? */
export async function sameCluster(
  a: string,
  b: string,
  ctx: SimilarityContext = {},
): Promise<boolean> {
  const s = await similarity(a, b, ctx)
  return s >= (ctx.threshold ?? DEFAULT_THRESHOLD)
}

/**
 * Cluster an array of texts by similarity. Greedy: each new text joins the
 * first cluster whose representative matches above threshold, else starts a
 * new cluster. Returns an array of cluster indexes (same length as input).
 *
 * Example: ['hi', 'hello', 'hi there'] with a loose threshold might return
 * [0, 1, 0].
 */
export async function cluster(
  texts: string[],
  ctx: SimilarityContext = {},
): Promise<number[]> {
  const assignments: number[] = []
  const reps: string[] = []
  for (const text of texts) {
    let assigned = -1
    for (let i = 0; i < reps.length; i++) {
      const rep = reps[i]!
      if (await sameCluster(text, rep, ctx)) {
        assigned = i
        break
      }
    }
    if (assigned === -1) {
      assigned = reps.length
      reps.push(text)
    }
    assignments.push(assigned)
  }
  return assignments
}

/**
 * Resolve the similarity context from env.
 *
 * `VOID_COUNCIL_EMBEDDINGS=1` opts into the embedding strategy (falls back to
 * naive if `embed` is not supplied).
 */
export function resolveSimilarityContext(
  override?: SimilarityContext,
): SimilarityContext {
  const strategy: SimilarityStrategy =
    override?.strategy ??
    (process.env.VOID_COUNCIL_EMBEDDINGS === '1' ? 'embedding' : 'naive')
  return {
    strategy,
    threshold: override?.threshold ?? DEFAULT_THRESHOLD,
    embed: override?.embed,
  }
}
