# Council Effect-TS Guide

A pilot of [Effect-TS](https://effect.website) `Layer` composition inside the
council subsystem. Scope is deliberately narrow: only `src/council/` is
touched. The rest of void-cli keeps its current singletons and hooks.

## Why Effect here

The legacy council orchestrator (`src/council/orchestrator.ts`) hard-codes:

- Provider resolution (Anthropic SDK vs. OpenRouter fetch)
- API key lookup (env vars, macOS keychain fallback)
- Permission decisions (implicit "always allow")
- Configuration (module-level `currentConfig` singleton)

That shape works — but it's hard to mock one piece without stubbing the whole
module. Effect's `Layer` model lets each of those become a typed service
(`Context.Tag`) that callers compose:

```ts
const TestLayer = Layer.mergeAll(
  ConfigLayer.mockLayer(myConfig),
  ProviderLayer.mockLayer({ claude: { content: 'hi', tokens: {...} } }),
  PermissionLayer.defaultLayer,
).pipe(Layer.provide(AuthLayer.mockLayer({ openrouter: 'test-key' })))
```

Production gets the real IO; tests get deterministic responses; future layers
(weighted voting, streaming, tool dispatch) plug in without touching call
sites.

## Feature flag & fallback

Enabled by `VOID_EFFECT_COUNCIL=1`. The legacy `runCouncil` in
`src/council/orchestrator.ts` checks the flag at the top:

```ts
if (process.env.VOID_EFFECT_COUNCIL === '1') {
  try {
    const { runCouncilEffect } = await import('./orchestrator-effect.js')
    for await (const ev of runCouncilEffect(...)) yield ev
    return
  } catch (err) {
    console.warn(`[council] Effect orchestrator failed, falling back: ${err.message}`)
    // falls through to legacy path
  }
}
```

So the UI, CLI, and every existing call site keep working unchanged. If
Effect setup throws, we log and use the legacy orchestrator. Zero-risk
rollout.

## Layers

Four services live in `src/council/layers/`:

| Tag                | File                  | Responsibility                      |
| ------------------ | --------------------- | ----------------------------------- |
| `council/Config`   | `ConfigLayer.ts`      | `CouncilConfig` + preset lookup     |
| `council/Auth`     | `AuthLayer.ts`        | API-key / OAuth resolution          |
| `council/Provider` | `ProviderLayer.ts`    | Execute a prompt against a member   |
| `council/Permission` | `PermissionLayer.ts` | Pre-dispatch permission check       |

Each module exports:

- A `Context.Tag` class (e.g., `Config`)
- `defaultLayer` — production-wired, pulls from the existing singletons / env
- `mockLayer(...)` — for tests; accepts scripted input

`index.ts` also exports a pre-composed `CouncilLayer`:

```ts
export const CouncilLayer = Layer.mergeAll(
  ConfigLayer.defaultLayer,
  PermissionLayer.defaultLayer,
  ProviderLayer.defaultLayer,
).pipe(Layer.provide(AuthLayer.defaultLayer))
```

## Orchestrator

`src/council/orchestrator-effect.ts` exposes three entry points:

```ts
export function makeCouncilRuntime(layer?: Layer.Layer<...>): ManagedRuntime
export function runCouncilEffect(prompt, systemPrompt?, override?, runtime?)
export function queryCouncilEffect(prompt, systemPrompt?, override?, runtime?)
```

`runCouncilEffect` yields the same `CouncilEvent` stream the legacy
orchestrator does, so UI consumers don't need to change. Internally:

1. Pull `CouncilConfig` from `Config` service (merged with `configOverride`).
2. Fan out members via `Effect.all(..., { concurrency: 'unbounded' })`.
3. Each member Effect calls `Permission.check` then `Provider.execute`, with
   `Effect.timeout(memberTimeoutMs)` wrapped around the provider call.
4. Successful results become `CouncilResponse`; timeouts / denials become
   `member_error` events.
5. `determineConsensus` runs unchanged — the consensus logic is still plain
   TS, just fed by Effect outputs.

## Adding a new layer

Say we want a `ToolLayer` that exposes tool dispatch to members. Three steps:

### 1. Define the service

```ts
// src/council/layers/ToolLayer.ts
import { Context, Effect, Layer } from 'effect'

export interface ToolService {
  readonly invoke: (name: string, input: unknown) => Effect.Effect<unknown, Error>
}

export class Tool extends Context.Tag('council/Tool')<Tool, ToolService>() {}

export const defaultLayer = Layer.succeed(
  Tool,
  Tool.of({
    invoke: (name, input) => Effect.promise(() => realToolDispatch(name, input)),
  }),
)

export const mockLayer = (script: Record<string, unknown>) =>
  Layer.succeed(
    Tool,
    Tool.of({
      invoke: (name) =>
        name in script
          ? Effect.succeed(script[name])
          : Effect.fail(new Error(`mock: no tool ${name}`)),
    }),
  )
```

### 2. Register it in `layers/index.ts`

```ts
export { Tool } from './ToolLayer.js'
export const CouncilLayer = Layer.mergeAll(
  ConfigLayer.defaultLayer,
  PermissionLayer.defaultLayer,
  ProviderLayer.defaultLayer,
  ToolLayer.defaultLayer,          // <-- new
).pipe(Layer.provide(AuthLayer.defaultLayer))
```

### 3. Consume in the orchestrator (or a provider)

```ts
const tool = yield* ToolService
const result = yield* tool.invoke('read_file', { path: '/etc/hosts' })
```

## Mock patterns

**Scripted provider** — hand a map of `memberId -> response`:

```ts
ProviderLayer.mockLayer({
  claude: { content: 'answer A', tokens: { input: 1, output: 1 } },
  gpt4o:  { content: 'answer B', tokens: { input: 1, output: 1 } },
})
```

**Dynamic provider** — a function lets you introduce latency, failures, etc:

```ts
ProviderLayer.mockLayer(async ({ member }) => {
  if (member.id === 'slow') await sleep(500)
  return { content: `ok from ${member.id}`, tokens: { input: 1, output: 1 } }
})
```

**Denying permission** — test that the orchestrator routes denials to
`member_error`:

```ts
PermissionLayer.mockLayer((req) =>
  req.memberId === 'blocked'
    ? { kind: 'deny', reason: 'policy' }
    : { kind: 'allow' },
)
```

**Pinning config** — avoid the module-level singleton entirely:

```ts
ConfigLayer.mockLayer({
  enabled: true,
  preset: 'custom',
  members,
  consensusMethod: 'leader-picks',
  memberTimeoutMs: 1_000,
  showAllResponses: true,
  leaderPicks: true,
})
```

## Running the tests

```bash
npm run test:council
```

5 specs live in `src/council/__tests__/layers.test.ts`:

- Duo preset fans out in parallel (wall clock < sum of member latencies).
- Trinity handles one slow member — timeout surfaces as `member_error`.
- Leader-picks end-to-end with scripted responses.
- Weight-based voting — heavy weight beats light weight even with slightly
  shorter content.
- Permission denial short-circuits a member to `member_error`.

## Rollout

1. Ship as-is — legacy path remains default.
2. Flip `VOID_EFFECT_COUNCIL=1` in an internal .env for soak testing.
3. Once stable, switch default to `'1'` and keep the fallback warn for one
   more release.
4. Remove the flag; delete the legacy promise-based path.

## Next layer candidates

- **StreamingLayer** — per-member streaming chunks (currently the events only
  fire at completion).
- **ToolLayer** — council members that can execute tools (only Claude today).
- **BudgetLayer** — per-round cost cap enforced at dispatch, not post-hoc.
- **CacheLayer** — de-dupe identical prompts across council rounds.

---

## Consensus voting modes

The council ships five first-class consensus modes, all routed through the
`ConsensusLayer` service and the dispatcher at `src/council/consensus/index.ts`.
Legacy modes (`voting`, `longest`, `first`) still work but stay inline in the
orchestrator — they're not on the Effect-TS path.

| mode | when to use | needs 2nd pass? | deterministic? |
| --- | --- | --- | --- |
| `leader-picks` | trust the primary model; low cost | no | yes |
| `majority` | odd-numbered panel; answers often cluster | no | yes¹ |
| `weighted-majority` | heterogeneous models with trust scores | no | yes¹ |
| `unanimous` | safety-critical; willing to pay retry cost | yes (retry) | yes¹ |
| `borda-count` | ranked preference; members assess each other | yes (rank) | depends on ranker |

¹ Deterministic for the `naive` similarity strategy with stable inputs.
Non-determinism only enters via `tiebreaker: 'random'` or an LLM-backed
`bordaRank` / `rerun` callback.

### Mode semantics

**`leader-picks`** — the first member in the configured order wins. If the
leader errored out, falls through to the first response that made it back.
No voting log, `outcome` is always `'decided'`.

**`majority`** — each response is bucketed into a similarity cluster (see
*Similarity* below). Each member votes for its own cluster. The largest
cluster wins; its leader-most response is the winner. Cross-cluster ties
hand off to the configured tiebreaker. Emits `no_consensus` when
`tiebreaker='retry'` can't resolve.

**`weighted-majority`** — same cluster logic, but each vote multiplies by
`member.weight`. Negative weights are rejected (throws). All-zero weights
degrade to unweighted (flagged in `tiebreaker.reason`).

**`unanimous`** — requires a single cluster covering every member that
responded (missing / errored members don't block). If split, calls the
optional `rerun(convergePrompt, attempt)` hook up to
`unanimousMaxRetries` (default **2**). Each retry emits a `retry`
lifecycle event. When retries exhaust, returns the largest cluster's
tiebreaker-resolved winner with `outcome: 'no-consensus'`.

**`borda-count`** — each member ranks every other response. Borda score
for `N` candidates: rank 1 = `N-1` points, rank 2 = `N-2`, …, rank N = 0.
Totals sum across voters; highest total wins; ties use the tiebreaker.
If a `bordaRank(voter, candidates) => string[]` hook is supplied it's
called (one extra LLM round-trip per voter); otherwise falls back to
a similarity-to-own-answer heuristic.

### Similarity strategies

`src/council/consensus/similarity.ts` pluggable scoring:

- `naive` (default): lowercase + strip punctuation + Jaccard overlap. Fast,
  no network. Known limits: misses paraphrases, threshold (0.85) is a
  heuristic.
- `embedding` (opt-in via `VOID_COUNCIL_EMBEDDINGS=1`): cosine similarity of
  vectors from a caller-supplied `embed(text) => Promise<number[] | null>`.
  When `embed` returns `null` or throws, falls back to naive. No provider
  is wired yet — consumers supply their own embedder.

```ts
// Force embedding + custom threshold
await runConsensus({
  method: 'majority',
  responses,
  members,
  similarity: {
    strategy: 'embedding',
    embed: async (t) => await myEmbedder(t),
    threshold: 0.92,
  },
})
```

### Tiebreakers

All voting modes accept `tiebreaker: 'leader' | 'random' | 'retry'`:

- `leader` (default) — earliest tied member in configured order wins.
- `random` — uniform pick among the tied set. Useful for sticky-session
  avoidance when the leader is overrepresented.
- `retry` — caller (orchestrator) should re-run. `resolveTie` still returns
  a non-null winner (leader fallback) but flags `retryRequested=true`.
  The orchestrator surfaces this as `consensus_no_consensus` event and
  marks `result.outcome='no-consensus'`.

### Adding the ConsensusLayer to a runtime

```ts
import { Layer, ManagedRuntime } from 'effect'
import {
  ConfigLayer, AuthLayer, ProviderLayer,
  PermissionLayer, ConsensusLayer,
} from 'src/council/layers/index.js'

const rt = ManagedRuntime.make(
  Layer.mergeAll(
    ConfigLayer.mockLayer(myCfg),
    ProviderLayer.mockLayer(myResponseMap),
    PermissionLayer.defaultLayer,
    ConsensusLayer.defaultLayer, // or ConsensusLayer.mockLayer(fn)
  ).pipe(Layer.provide(AuthLayer.mockLayer({ openrouter: 'k' })))
)
```

`ConsensusLayer.mockLayer(runner)` replaces the real `runConsensus` with a
caller-supplied factory — useful for verifying orchestrator plumbing
without running real clustering.

### Config surface

`CouncilConfig` gained two optional fields:

```ts
type CouncilConfig = {
  // …existing fields
  tiebreaker?: 'leader' | 'random' | 'retry'   // default 'leader'
  unanimousMaxRetries?: number                  // default 2
}
```

`consensusMethod` now accepts the five new values alongside the three
legacy ones.

### CouncilEvent additions

```ts
| { type: 'consensus_retry'; attempt: number; reason: string }
| { type: 'consensus_no_consensus'; method: ConsensusMethod; reason: string }
```

The renderer already paints these — the consensus summary shows a yellow
`NO CONSENSUS` header, the tiebreaker kind + reason, the retry count, and
a vote breakdown sorted by weight.

### Test coverage

`src/council/__tests__/consensus.test.ts` — 39 specs across similarity,
tiebreaker, and each mode (see the commit message for the per-mode count).
Run with `npm run test:council`.

