/**
 * Council Effect-TS layer composition tests.
 *
 * Verifies the Effect-backed orchestrator behaves correctly under a mock
 * composition:
 *  - Duo preset fans out to 2 members in parallel.
 *  - Trinity handles a member timeout (one slow, two fast).
 *  - Leader-picks consensus ends-to-end with mocked responses.
 *  - Weight-based voting scores members via their configured weight (stubbed
 *    provider output; real weight logic lives in determineConsensus).
 */
import { describe, it, expect } from 'vitest'
import { Layer } from 'effect'
import type {
  CouncilConfig,
  CouncilMember,
  ConsensusMethod,
} from '../types.js'
import {
  ConfigLayer,
  AuthLayer,
  ProviderLayer,
  PermissionLayer,
} from '../layers/index.js'
import {
  makeCouncilRuntime,
  queryCouncilEffect,
  runCouncilEffect,
} from '../orchestrator-effect.js'

const makeMember = (
  id: string,
  weight = 1,
  provider: 'anthropic' | 'openrouter' = 'openrouter',
): CouncilMember => ({
  id,
  name: id.toUpperCase(),
  model: `mock/${id}`,
  provider,
  weight,
  canExecuteTools: false,
})

const makeConfig = (
  members: CouncilMember[],
  overrides: Partial<CouncilConfig> = {},
): CouncilConfig => ({
  enabled: true,
  preset: 'custom',
  members,
  consensusMethod: 'leader-picks',
  memberTimeoutMs: 1_000,
  showAllResponses: true,
  leaderPicks: true,
  ...overrides,
})

const composeLayers = (args: {
  config: CouncilConfig
  responder: Parameters<typeof ProviderLayer.mockLayer>[0]
  permission?: Parameters<typeof PermissionLayer.mockLayer>[0]
}) =>
  Layer.mergeAll(
    ConfigLayer.mockLayer(args.config),
    ProviderLayer.mockLayer(args.responder),
    args.permission
      ? PermissionLayer.mockLayer(args.permission)
      : PermissionLayer.defaultLayer,
  ).pipe(Layer.provide(AuthLayer.mockLayer({ openrouter: 'test-key' })))

describe('council effect layers', () => {
  it('Duo preset fans out to 2 members in parallel', async () => {
    const members = [makeMember('a'), makeMember('b')]
    const config = makeConfig(members)

    let aStart = 0
    let bStart = 0
    const responder = async (input: {
      member: CouncilMember
    }) => {
      const now = Date.now()
      if (input.member.id === 'a') aStart = now
      else bStart = now
      // Each member sleeps 100ms; true parallelism means total ≈100ms,
      // sequential would be ≈200ms.
      await new Promise((r) => setTimeout(r, 100))
      return {
        content: `response from ${input.member.id}`,
        tokens: { input: 10, output: 20 },
      }
    }

    const runtime = makeCouncilRuntime(
      composeLayers({ config, responder }),
    )
    const t0 = Date.now()
    const result = await queryCouncilEffect(
      'hello',
      undefined,
      undefined,
      runtime,
    )
    const elapsed = Date.now() - t0
    await runtime.dispose()

    expect(result.responses).toHaveLength(2)
    expect(result.responses.map((r) => r.memberId).sort()).toEqual(['a', 'b'])
    // Parallelism: both should have started within ~30ms of each other.
    expect(Math.abs(aStart - bStart)).toBeLessThan(50)
    // And wall clock should be closer to one request than two.
    expect(elapsed).toBeLessThan(200)
  })

  it('Trinity handles member timeout (one slow, two fast)', async () => {
    const members = [makeMember('fast1'), makeMember('slow'), makeMember('fast2')]
    const config = makeConfig(members, { memberTimeoutMs: 150 })

    const responder = async (input: { member: CouncilMember }) => {
      if (input.member.id === 'slow') {
        await new Promise((r) => setTimeout(r, 500))
      } else {
        await new Promise((r) => setTimeout(r, 20))
      }
      return {
        content: `ok from ${input.member.id}`,
        tokens: { input: 1, output: 1 },
      }
    }

    const runtime = makeCouncilRuntime(
      composeLayers({ config, responder }),
    )
    const events: string[] = []
    const errored: string[] = []
    const completed: string[] = []
    for await (const ev of runCouncilEffect(
      'hi',
      undefined,
      undefined,
      runtime,
    )) {
      events.push(ev.type)
      if (ev.type === 'member_error') errored.push(ev.memberId)
      if (ev.type === 'member_complete') completed.push(ev.memberId)
    }
    await runtime.dispose()

    expect(errored).toEqual(['slow'])
    expect(completed.sort()).toEqual(['fast1', 'fast2'])
    expect(events).toContain('consensus_complete')
    expect(events).toContain('council_complete')
  })

  it('Leader-picks consensus works end-to-end with mocked responses', async () => {
    const members = [
      makeMember('leader'),
      makeMember('second'),
      makeMember('third'),
    ]
    const config = makeConfig(members, { consensusMethod: 'leader-picks' })

    const responder = {
      leader: { content: 'LEADER SPEAKS', tokens: { input: 5, output: 10 } },
      second: { content: 'a shorter note', tokens: { input: 5, output: 5 } },
      third: {
        content:
          'a much longer reply '.repeat(50) +
          'with plenty of detail that would win "longest"',
        tokens: { input: 10, output: 100 },
      },
    }

    const runtime = makeCouncilRuntime(
      composeLayers({ config, responder }),
    )
    const result = await queryCouncilEffect(
      'pick me',
      undefined,
      undefined,
      runtime,
    )
    await runtime.dispose()

    expect(result.method).toBe('leader-picks')
    expect(result.winner.memberId).toBe('leader')
    expect(result.responses).toHaveLength(3)
    // Leader gets score 1, others 0.5
    const leaderScore = result.scores.find((s) => s.memberId === 'leader')
    expect(leaderScore?.score).toBe(1)
  })

  it('Weight-based voting uses member weight (stub plug-in for future work)', async () => {
    // Even though member 'heavy' has a shorter response, its higher weight
    // should beat 'light' under `voting` when length is close.
    const members = [
      makeMember('heavy', 1.0),
      makeMember('light', 0.3),
    ]
    const config = makeConfig(members, { consensusMethod: 'voting' })

    const responder = {
      heavy: {
        content: 'x'.repeat(1500),
        tokens: { input: 1, output: 1 },
      },
      light: {
        content: 'x'.repeat(1600),
        tokens: { input: 1, output: 1 },
      },
    }

    const runtime = makeCouncilRuntime(
      composeLayers({ config, responder }),
    )
    const result = await queryCouncilEffect(
      'vote',
      undefined,
      undefined,
      runtime,
    )
    await runtime.dispose()

    expect(result.method).toBe('voting' as ConsensusMethod)
    // heavy wins because its length*weight (0.75*1=0.75) > light (0.8*0.3=0.24)
    expect(result.winner.memberId).toBe('heavy')
    const heavyScore = result.scores.find((s) => s.memberId === 'heavy')!
    const lightScore = result.scores.find((s) => s.memberId === 'light')!
    expect(heavyScore.score).toBeGreaterThan(lightScore.score)
  })

  it('Permission denial short-circuits the member', async () => {
    const members = [makeMember('ok'), makeMember('blocked')]
    const config = makeConfig(members)
    const responder = {
      ok: { content: 'hi', tokens: { input: 1, output: 1 } },
      blocked: { content: 'should never run', tokens: { input: 0, output: 0 } },
    }

    const runtime = makeCouncilRuntime(
      composeLayers({
        config,
        responder,
        permission: (req) =>
          req.memberId === 'blocked'
            ? { kind: 'deny', reason: 'policy' }
            : { kind: 'allow' },
      }),
    )
    const errored: string[] = []
    const completed: string[] = []
    for await (const ev of runCouncilEffect(
      'go',
      undefined,
      undefined,
      runtime,
    )) {
      if (ev.type === 'member_error') errored.push(ev.memberId)
      if (ev.type === 'member_complete') completed.push(ev.memberId)
    }
    await runtime.dispose()

    expect(errored).toEqual(['blocked'])
    expect(completed).toEqual(['ok'])
  })
})
