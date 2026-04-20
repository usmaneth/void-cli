/**
 * Consensus mode test suite.
 *
 * Covers all 5 modes (leader-picks, majority, weighted-majority, unanimous,
 * borda-count), similarity edge cases, tiebreaker resolution paths, and
 * lifecycle events.
 */
import { describe, it, expect, vi } from 'vitest'
import type {
  CouncilMember,
  CouncilResponse,
} from '../types.js'
import {
  runConsensus,
  DEFAULT_TIEBREAKER,
  DEFAULT_UNANIMOUS_MAX_RETRIES,
} from '../consensus/index.js'
import type { ConsensusLifecycleEvent } from '../consensus/types.js'
import {
  cluster,
  cosine,
  jaccard,
  normalize,
  resolveSimilarityContext,
  sameCluster,
  similarity,
} from '../consensus/similarity.js'
import { pickLeader, resolveTie } from '../consensus/tiebreaker.js'

// ── Helpers ─────────────────────────────────────────────────────────────

const makeMember = (
  id: string,
  weight = 1,
): CouncilMember => ({
  id,
  name: id.toUpperCase(),
  model: `mock/${id}`,
  provider: 'openrouter',
  weight,
  canExecuteTools: false,
})

const makeResp = (
  memberId: string,
  content: string,
  overrides: Partial<CouncilResponse> = {},
): CouncilResponse => ({
  memberId,
  memberName: memberId.toUpperCase(),
  model: `mock/${memberId}`,
  content,
  rawText: content,
  toolUses: [],
  latencyMs: 100,
  tokens: { input: 10, output: 20 },
  costUSD: 0.001,
  ...overrides,
})

// ── Similarity ──────────────────────────────────────────────────────────

describe('similarity helpers', () => {
  it('normalize strips punctuation and collapses whitespace', () => {
    expect(normalize('  Hello,   WORLD!!  ')).toBe('hello world')
  })

  it('jaccard returns 1 for identical token sets', () => {
    expect(jaccard('a b c', 'a b c')).toBe(1)
  })

  it('jaccard returns 0 for disjoint token sets', () => {
    expect(jaccard('a b c', 'x y z')).toBe(0)
  })

  it('jaccard handles empty input', () => {
    expect(jaccard('', '')).toBe(1)
    expect(jaccard('a', '')).toBe(0)
  })

  it('cosine of identical vectors is 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5)
  })

  it('cosine of orthogonal vectors is 0', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })

  it('similarity naive returns 1 for equivalent texts', async () => {
    const s = await similarity('Hello, world!', 'hello world')
    expect(s).toBe(1)
  })

  it('similarity falls back to jaccard for partial overlap', async () => {
    const s = await similarity('hello world foo', 'hello world bar')
    // 2 overlap / 4 union = 0.5
    expect(s).toBeCloseTo(0.5, 3)
  })

  it('similarity embedding path falls back to jaccard when embed returns null', async () => {
    const s = await similarity('a b', 'a c', {
      strategy: 'embedding',
      embed: async () => null,
    })
    expect(s).toBeCloseTo(1 / 3, 3)
  })

  it('similarity embedding path uses cosine when vectors returned', async () => {
    const s = await similarity('x', 'y', {
      strategy: 'embedding',
      embed: async (t) => (t === 'x' ? [1, 0] : [1, 0.0001]),
    })
    expect(s).toBeGreaterThan(0.99)
  })

  it('cluster groups identical answers into one bucket', async () => {
    const ids = await cluster(['yes', 'yes', 'no'])
    // Two groups: [0, 0, 1] (indexes the cluster each item belongs to)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[0])
  })

  it('sameCluster respects threshold', async () => {
    const loose = await sameCluster('hello world', 'hello there', { threshold: 0.1 })
    const strict = await sameCluster('hello world', 'hello there', { threshold: 0.95 })
    expect(loose).toBe(true)
    expect(strict).toBe(false)
  })

  it('resolveSimilarityContext defaults to naive', () => {
    const ctx = resolveSimilarityContext()
    expect(ctx.strategy).toBe('naive')
  })

  it('resolveSimilarityContext honors VOID_COUNCIL_EMBEDDINGS env', () => {
    const prev = process.env.VOID_COUNCIL_EMBEDDINGS
    process.env.VOID_COUNCIL_EMBEDDINGS = '1'
    try {
      const ctx = resolveSimilarityContext()
      expect(ctx.strategy).toBe('embedding')
    } finally {
      if (prev === undefined) delete process.env.VOID_COUNCIL_EMBEDDINGS
      else process.env.VOID_COUNCIL_EMBEDDINGS = prev
    }
  })
})

// ── Tiebreaker ──────────────────────────────────────────────────────────

describe('tiebreaker helpers', () => {
  const members = [makeMember('a'), makeMember('b'), makeMember('c')]
  const responses = [
    makeResp('a', 'answer a'),
    makeResp('b', 'answer b'),
    makeResp('c', 'answer c'),
  ]

  it('DEFAULT_TIEBREAKER is leader', () => {
    expect(DEFAULT_TIEBREAKER).toBe('leader')
  })

  it('pickLeader picks first member in member order', () => {
    const winner = pickLeader(
      [responses[1]!, responses[2]!, responses[0]!],
      members,
    )
    expect(winner.memberId).toBe('a')
  })

  it("resolveTie 'leader' picks the member-order-first tied response", () => {
    const res = resolveTie({
      tied: ['c', 'b'],
      responses,
      members,
      tiebreaker: 'leader',
    })
    expect(res.winner.memberId).toBe('b')
    expect(res.retryRequested).toBe(false)
  })

  it("resolveTie 'retry' surfaces retryRequested=true", () => {
    const res = resolveTie({
      tied: ['b', 'c'],
      responses,
      members,
      tiebreaker: 'retry',
    })
    expect(res.retryRequested).toBe(true)
  })

  it("resolveTie 'random' picks one of the tied set", () => {
    const res = resolveTie({
      tied: ['b', 'c'],
      responses,
      members,
      tiebreaker: 'random',
    })
    expect(['b', 'c']).toContain(res.winner.memberId)
    expect(res.retryRequested).toBe(false)
  })
})

// ── leader-picks mode ───────────────────────────────────────────────────

describe('consensus/leader-picks', () => {
  it('picks the leader member', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const responses = [makeResp('a', 'one'), makeResp('b', 'two')]
    const result = await runConsensus({
      method: 'leader-picks',
      responses,
      members,
    })
    expect(result.winner.memberId).toBe('a')
    expect(result.method).toBe('leader-picks')
    expect(result.outcome).toBe('decided')
  })

  it('falls back to first response if leader errored out', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const responses = [makeResp('b', 'only b answered')]
    const result = await runConsensus({
      method: 'leader-picks',
      responses,
      members,
    })
    expect(result.winner.memberId).toBe('b')
  })
})

// ── majority mode ───────────────────────────────────────────────────────

describe('consensus/majority', () => {
  it('picks the plurality cluster when one dominates', async () => {
    const members = [makeMember('a'), makeMember('b'), makeMember('c')]
    const responses = [
      makeResp('a', 'yes'),
      makeResp('b', 'yes'),
      makeResp('c', 'no'),
    ]
    const result = await runConsensus({
      method: 'majority',
      responses,
      members,
    })
    expect(['a', 'b']).toContain(result.winner.memberId)
    expect(result.outcome).toBe('decided')
    expect(result.method).toBe('majority')
  })

  it('resolves tie via leader tiebreaker by default', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const responses = [makeResp('a', 'yes'), makeResp('b', 'no')]
    const result = await runConsensus({
      method: 'majority',
      responses,
      members,
    })
    // 1-1 tie → leader tiebreaker → a
    expect(result.winner.memberId).toBe('a')
    expect(result.tiebreaker?.kind).toBe('leader')
  })

  it('marks no-consensus when tiebreaker=retry', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const responses = [makeResp('a', 'yes'), makeResp('b', 'no')]
    const emitted: ConsensusLifecycleEvent[] = []
    const result = await runConsensus({
      method: 'majority',
      responses,
      members,
      tiebreaker: 'retry',
      emit: (e) => emitted.push(e),
    })
    expect(result.outcome).toBe('no-consensus')
    expect(emitted.some((e) => e.type === 'no_consensus')).toBe(true)
  })

  it('rejects negative weights on the weighted path', async () => {
    const members = [makeMember('a', -1), makeMember('b', 1)]
    const responses = [makeResp('a', 'yes'), makeResp('b', 'no')]
    await expect(
      runConsensus({
        method: 'weighted-majority',
        responses,
        members,
      }),
    ).rejects.toThrow(/negative weight/)
  })
})

// ── weighted-majority mode ──────────────────────────────────────────────

describe('consensus/weighted-majority', () => {
  it('weight multiplier beats vote count', async () => {
    // a+b vote "yes" with weight 0.1 each, c votes "no" with weight 10.
    // Unweighted: 2-1 for yes. Weighted: 0.2 vs 10 → no wins.
    const members = [makeMember('a', 0.1), makeMember('b', 0.1), makeMember('c', 10)]
    const responses = [
      makeResp('a', 'yes'),
      makeResp('b', 'yes'),
      makeResp('c', 'no'),
    ]
    const result = await runConsensus({
      method: 'weighted-majority',
      responses,
      members,
    })
    expect(result.winner.memberId).toBe('c')
    expect(result.method).toBe('weighted-majority')
  })

  it('degrades to unweighted when all weights are zero', async () => {
    const members = [makeMember('a', 0), makeMember('b', 0), makeMember('c', 0)]
    const responses = [
      makeResp('a', 'yes'),
      makeResp('b', 'yes'),
      makeResp('c', 'no'),
    ]
    const result = await runConsensus({
      method: 'weighted-majority',
      responses,
      members,
    })
    // Degraded: plurality wins → yes
    expect(['a', 'b']).toContain(result.winner.memberId)
    expect(result.tiebreaker?.reason).toMatch(/degrad/i)
  })
})

// ── unanimous mode ──────────────────────────────────────────────────────

describe('consensus/unanimous', () => {
  it('passes when all members agree', async () => {
    const members = [makeMember('a'), makeMember('b'), makeMember('c')]
    const responses = [
      makeResp('a', 'same'),
      makeResp('b', 'same'),
      makeResp('c', 'same'),
    ]
    const result = await runConsensus({
      method: 'unanimous',
      responses,
      members,
    })
    expect(result.outcome).toBe('decided')
    expect(result.retries).toBe(0)
  })

  it('retries up to max and emits retry events', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const initial = [makeResp('a', 'alpha'), makeResp('b', 'beta')]
    let rerunCalls = 0
    const emitted: ConsensusLifecycleEvent[] = []
    const rerun = vi.fn(async () => {
      rerunCalls += 1
      // Never converges — always split
      return [makeResp('a', `a-${rerunCalls}`), makeResp('b', `b-${rerunCalls}`)]
    })
    const result = await runConsensus({
      method: 'unanimous',
      responses: initial,
      members,
      unanimousMaxRetries: 2,
      rerun,
      emit: (e) => emitted.push(e),
    })
    expect(rerunCalls).toBe(2)
    expect(result.retries).toBe(2)
    expect(result.outcome).toBe('no-consensus')
    expect(emitted.filter((e) => e.type === 'retry')).toHaveLength(2)
    expect(emitted.some((e) => e.type === 'no_consensus')).toBe(true)
  })

  it('converges on retry when rerun returns unanimity', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const initial = [makeResp('a', 'alpha'), makeResp('b', 'beta')]
    const rerun = vi.fn(async () => [
      makeResp('a', 'gamma'),
      makeResp('b', 'gamma'),
    ])
    const result = await runConsensus({
      method: 'unanimous',
      responses: initial,
      members,
      unanimousMaxRetries: 2,
      rerun,
    })
    expect(result.outcome).toBe('decided')
    expect(result.retries).toBe(1)
  })

  it('defaults unanimous max retries to 2', () => {
    expect(DEFAULT_UNANIMOUS_MAX_RETRIES).toBe(2)
  })

  it('no rerun hook → immediate no-consensus with tiebreaker winner', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const initial = [makeResp('a', 'alpha'), makeResp('b', 'beta')]
    const result = await runConsensus({
      method: 'unanimous',
      responses: initial,
      members,
    })
    expect(result.outcome).toBe('no-consensus')
    expect(result.winner.memberId).toBe('a') // leader tiebreaker
  })
})

// ── borda-count mode ────────────────────────────────────────────────────

describe('consensus/borda-count', () => {
  it('computes Borda totals correctly on a known ranking set', async () => {
    // 3 members; each ranks the 2 others (excluding self).
    // Explicit rankings:
    //   a ranks b>c  → b gets 1, c gets 0
    //   b ranks a>c  → a gets 1, c gets 0
    //   c ranks a>b  → a gets 1, b gets 0
    // Totals: a=2, b=1, c=0  → a wins.
    const members = [makeMember('a'), makeMember('b'), makeMember('c')]
    const responses = [
      makeResp('a', 'answer a'),
      makeResp('b', 'answer b'),
      makeResp('c', 'answer c'),
    ]
    const bordaRank = vi.fn(async (voter: CouncilMember) => {
      if (voter.id === 'a') return ['b', 'c']
      if (voter.id === 'b') return ['a', 'c']
      return ['a', 'b']
    })
    const result = await runConsensus({
      method: 'borda-count',
      responses,
      members,
      bordaRank,
    })
    expect(result.winner.memberId).toBe('a')
    const scoreA = result.scores.find((s) => s.memberId === 'a')!.score
    const scoreB = result.scores.find((s) => s.memberId === 'b')!.score
    const scoreC = result.scores.find((s) => s.memberId === 'c')!.score
    expect(scoreA).toBe(2)
    expect(scoreB).toBe(1)
    expect(scoreC).toBe(0)
  })

  it('tiebreaker resolves ties in Borda scoring', async () => {
    // Two members; each ranks the other first — both get 1 point → tie.
    const members = [makeMember('a'), makeMember('b')]
    const responses = [makeResp('a', 'foo'), makeResp('b', 'bar')]
    const bordaRank = async (voter: CouncilMember) =>
      voter.id === 'a' ? ['b'] : ['a']
    const result = await runConsensus({
      method: 'borda-count',
      responses,
      members,
      bordaRank,
    })
    expect(result.tiebreaker).toBeDefined()
    // leader tiebreaker → a
    expect(result.winner.memberId).toBe('a')
  })

  it('falls back to similarity heuristic when bordaRank not supplied', async () => {
    // a and b answer similarly, c is divergent. Heuristic should rank
    // a's nearest as b (and vice versa), c as last.
    const members = [makeMember('a'), makeMember('b'), makeMember('c')]
    const responses = [
      makeResp('a', 'hello world foo'),
      makeResp('b', 'hello world foo'),
      makeResp('c', 'goodbye universe bar'),
    ]
    const result = await runConsensus({
      method: 'borda-count',
      responses,
      members,
    })
    // a and b each rank the other first (same content) → each gets 2 points
    // c ranks nobody close → whoever c picks gets 1 point, other 0
    // So a & b should tie at the top → leader tiebreaker → a.
    expect(['a', 'b']).toContain(result.winner.memberId)
  })

  it('single-response Borda returns the one response', async () => {
    const members = [makeMember('a')]
    const responses = [makeResp('a', 'only')]
    const result = await runConsensus({
      method: 'borda-count',
      responses,
      members,
    })
    expect(result.winner.memberId).toBe('a')
    expect(result.outcome).toBe('decided')
  })
})

// ── Integration: similarity + modes ─────────────────────────────────────

describe('consensus integration', () => {
  it('embedding strategy is plumbed through majority', async () => {
    const members = [makeMember('a'), makeMember('b'), makeMember('c')]
    const responses = [
      makeResp('a', 'x'),
      makeResp('b', 'y'),
      makeResp('c', 'z'),
    ]
    // Force all three to be same cluster via a fake embedder.
    const result = await runConsensus({
      method: 'majority',
      responses,
      members,
      similarity: {
        strategy: 'embedding',
        embed: async () => [1, 0, 0],
        threshold: 0.99,
      },
    })
    expect(result.outcome).toBe('decided')
    // All three in same cluster — leader a wins.
    expect(result.winner.memberId).toBe('a')
  })

  it('empty responses throws in strict modes', async () => {
    const members = [makeMember('a')]
    await expect(
      runConsensus({
        method: 'majority',
        responses: [],
        members,
      }),
    ).rejects.toThrow()
  })

  it('unsupported method (voting) throws from runConsensus', async () => {
    await expect(
      runConsensus({
        method: 'voting' as any,
        responses: [makeResp('a', 'x')],
        members: [makeMember('a')],
      }),
    ).rejects.toThrow(/unsupported/)
  })
})
