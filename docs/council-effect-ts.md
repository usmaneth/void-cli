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
