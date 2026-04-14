# Multi-Model Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Void CLI into a multi-model AI development platform with an OpenRouter model browser, deliberation room, swarm mode, Gemini designer agent, and smart mode triggers.

**Architecture:** Seven phased features built into Void core. Phase 1 (marketplace fix) and Phase 2 (provider auth) are prerequisites. Phases 3-7 are largely independent and can be parallelized. All multi-model features route through the existing OpenAI shim for non-Claude models, with new direct clients for OpenAI and Gemini APIs.

**Tech Stack:** TypeScript, React/Ink (terminal UI), zod (schemas), existing OpenAI shim (OpenRouter + direct providers), macOS Keychain (secure storage), execa (subprocess management)

**Spec:** `docs/superpowers/specs/2026-04-14-multi-model-platform-design.md`

**Note on security:** Use `execa` (already a dependency) for subprocess spawning, never `child_process.exec()`. For simple commands, use `execFileNoThrow` from `src/utils/execFileNoThrow.ts`. All user-provided strings must be passed as array arguments, never interpolated into shell strings.

---

## Phase 1: Fix Plugin Marketplace

### Task 1: Update marketplace references

**Files:**
- Modify: `src/utils/plugins/officialMarketplace.ts:15-25`
- Modify: `src/utils/plugins/officialMarketplaceGcs.ts:28-34`

- [ ] **Step 1: Update officialMarketplace.ts**

Change the repo and name constants:

```typescript
// src/utils/plugins/officialMarketplace.ts

export const OFFICIAL_MARKETPLACE_SOURCE = {
  source: 'github',
  repo: 'anthropics/claude-plugins-official',
} as const satisfies MarketplaceSource

export const OFFICIAL_MARKETPLACE_NAME = 'claude-plugins-official'
```

- [ ] **Step 2: Update officialMarketplaceGcs.ts**

Change the GCS base URL and archive prefix:

```typescript
// src/utils/plugins/officialMarketplaceGcs.ts line 28-34

const GCS_BASE =
  'https://downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official'

const ARC_PREFIX = 'marketplaces/claude-plugins-official/'
```

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/utils/plugins/officialMarketplace.ts src/utils/plugins/officialMarketplaceGcs.ts
git commit -m "fix: point marketplace to claude-plugins-official repo

Void was trying to install from anthropics/void-plugins-official which
doesn't exist. Now uses the same repo as Claude Code, unlocking all 33
official plugins."
```

---

## Phase 2: Provider Auth (OpenAI + Google Gemini)

### Task 2: Extend provider type and detection

**Files:**
- Modify: `src/utils/model/providers.ts:4-16`

- [ ] **Step 1: Add new provider types**

```typescript
// src/utils/model/providers.ts

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'openrouter' | 'openai' | 'gemini'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.VOID_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.VOID_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.VOID_USE_FOUNDRY)
        ? 'foundry'
        : isEnvTruthy(process.env.VOID_USE_OPENAI)
          ? 'openai'
          : isEnvTruthy(process.env.VOID_USE_GEMINI)
            ? 'gemini'
            : isEnvTruthy(process.env.VOID_USE_OPENROUTER)
              ? 'openrouter'
              : 'firstParty'
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors (APIProvider is used as a string union, new values are forward-compatible)

- [ ] **Step 3: Commit**

```bash
git add src/utils/model/providers.ts
git commit -m "feat: add openai and gemini to APIProvider type"
```

### Task 3: Add provider command support for OpenAI and Gemini

**Files:**
- Modify: `src/commands/provider/provider.ts:5,86-181`

- [ ] **Step 1: Extend SUPPORTED_PROVIDERS**

```typescript
// src/commands/provider/provider.ts line 5
const SUPPORTED_PROVIDERS = ['openrouter', 'openai', 'gemini'] as const
```

- [ ] **Step 2: Add routing info for new providers**

Update the `handleStatus()` function's routing description section to add:

```typescript
lines.push('  openai/* models -> OpenAI direct (if key configured) or OpenRouter')
lines.push('  google/* models -> Gemini direct (if key configured) or OpenRouter')
```

- [ ] **Step 3: Add env var detection for new providers in handleList**

In `handleList()`, add detection for `OPENAI_API_KEY` and `GEMINI_API_KEY` following the existing `OPENROUTER_API_KEY` pattern.

- [ ] **Step 4: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/commands/provider/provider.ts
git commit -m "feat: add openai and gemini to /provider command"
```

### Task 4: Add smart model routing for direct OpenAI and Gemini

**Files:**
- Modify: `src/services/api/client.ts:79-98,327-357`

- [ ] **Step 1: Extract generic keychain helper**

Refactor the existing `getOpenRouterKeyFromKeychain()` (around lines 79-98) into a generic function. Use `execFileNoThrow` from `src/utils/execFileNoThrow.ts` instead of `execSync`:

```typescript
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'

async function getKeyFromKeychain(provider: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const result = await execFileNoThrow('security', [
      'find-generic-password', '-s', `Void-${provider}`, '-w'
    ], { timeout: 5000 })
    return result.stdout?.trim() || undefined
  } catch {
    return undefined
  }
}
```

Update the existing OpenRouter code to use `getKeyFromKeychain('openrouter')`.

- [ ] **Step 2: Extend auto-routing logic in getAnthropicClient**

After the existing OpenRouter key resolution, before the OpenRouter routing block, add:

```typescript
// Direct OpenAI routing
const openaiKey = process.env.OPENAI_API_KEY ?? await getKeyFromKeychain('openai')
if (model?.startsWith('openai/') && openaiKey) {
  return createOpenAIShimClient({
    apiKey: openaiKey,
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    defaultHeaders: { 'User-Agent': getUserAgent() },
    timeout: ARGS.timeout,
  }) as unknown as Anthropic
}

// Direct Gemini routing (uses OpenAI-compatible endpoint)
const geminiKey = process.env.GEMINI_API_KEY ?? await getKeyFromKeychain('gemini')
if (model?.startsWith('google/') && geminiKey) {
  return createOpenAIShimClient({
    apiKey: geminiKey,
    baseURL: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultHeaders: { 'User-Agent': getUserAgent() },
    timeout: ARGS.timeout,
  }) as unknown as Anthropic
}
```

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/services/api/client.ts
git commit -m "feat: smart routing for direct OpenAI and Gemini API calls

Models prefixed with openai/ route to OpenAI API directly when key is
configured. Models prefixed with google/ route to Gemini OpenAI-compat
endpoint. Falls through to OpenRouter otherwise."
```

---

## Phase 3: OpenRouter Model Browser

### Task 5: Create OpenRouter model fetching and cache

**Files:**
- Create: `src/utils/model/openrouterModels.ts`

- [ ] **Step 1: Create the model fetching module**

```typescript
// src/utils/model/openrouterModels.ts

import axios from 'axios'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { getGlobalConfigDir } from '../config.js'

export type OpenRouterModel = {
  id: string
  name: string
  provider: string
  contextLength: number
  pricing: { prompt: number; completion: number }
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const CACHE_FILE = 'openrouter-models.json'

type CachedModels = {
  fetchedAt: number
  models: OpenRouterModel[]
}

function getCachePath(): string {
  return join(getGlobalConfigDir(), 'cache', CACHE_FILE)
}

async function readCache(): Promise<CachedModels | null> {
  try {
    const raw = await readFile(getCachePath(), 'utf8')
    const cached: CachedModels = JSON.parse(raw)
    if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached
    }
    return null
  } catch {
    return null
  }
}

async function writeCache(models: OpenRouterModel[]): Promise<void> {
  const cachePath = getCachePath()
  await mkdir(join(cachePath, '..'), { recursive: true })
  await writeFile(cachePath, JSON.stringify({ fetchedAt: Date.now(), models }))
}

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  const cached = await readCache()
  if (cached) return cached.models

  const response = await axios.get('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 15_000,
  })

  const models: OpenRouterModel[] = response.data.data.map((m: any) => ({
    id: m.id,
    name: m.name ?? m.id,
    provider: m.id.split('/')[0] ?? 'unknown',
    contextLength: m.context_length ?? 0,
    pricing: {
      prompt: parseFloat(m.pricing?.prompt ?? '0'),
      completion: parseFloat(m.pricing?.completion ?? '0'),
    },
  }))

  await writeCache(models).catch(() => {})
  return models
}

export function getUniqueProviders(models: OpenRouterModel[]): string[] {
  const providers = new Set(models.map(m => m.provider))
  return Array.from(providers).sort()
}

export function filterModels(
  models: OpenRouterModel[],
  query: string,
  provider?: string,
): OpenRouterModel[] {
  let filtered = models
  if (provider && provider !== 'all') {
    filtered = filtered.filter(m => m.provider === provider)
  }
  if (query) {
    const q = query.toLowerCase()
    filtered = filtered.filter(m =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    )
  }
  return filtered
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/model/openrouterModels.ts
git commit -m "feat: OpenRouter model fetching with 1-hour cache"
```

### Task 6: Create model suggestion engine

**Files:**
- Create: `src/utils/model/modelSuggestions.ts`

- [ ] **Step 1: Create the suggestion engine**

```typescript
// src/utils/model/modelSuggestions.ts

import type { OpenRouterModel } from './openrouterModels.js'

type SuggestionContext = {
  recentFiles: string[]
  currentDir: string
}

type SuggestionRule = {
  label: string
  patterns: RegExp[]
  modelIds: string[]
}

const RULES: SuggestionRule[] = [
  {
    label: 'frontend component',
    patterns: [/\.tsx$/, /\.css$/, /\.scss$/, /tailwind/, /\.html$/],
    modelIds: ['google/gemini-3.1-pro', 'google/gemini-2.5-pro-preview'],
  },
  {
    label: 'backend / API',
    patterns: [/\/api\//, /\.controller\./, /\.service\./, /routes?\./],
    modelIds: ['openai/gpt-5.4', 'openai/gpt-5'],
  },
  {
    label: 'algorithms / reasoning',
    patterns: [/\.test\./, /\.spec\./, /algorithm/, /math/],
    modelIds: ['thudm/glm-5.1', 'openai/o3-pro'],
  },
  {
    label: 'documentation',
    patterns: [/\.md$/, /README/, /docs\//],
    modelIds: ['anthropic/claude-sonnet-4.6'],
  },
]

export function getSuggestedModels(
  context: SuggestionContext,
  availableModels: OpenRouterModel[],
): { models: OpenRouterModel[]; label: string } | null {
  const files = context.recentFiles.map(f => f.toLowerCase())

  for (const rule of RULES) {
    const matches = rule.patterns.some(p => files.some(f => p.test(f)))
    if (matches) {
      const suggested = rule.modelIds
        .map(id => availableModels.find(m => m.id === id))
        .filter((m): m is OpenRouterModel => m !== undefined)
      if (suggested.length > 0) {
        return { models: suggested, label: rule.label }
      }
    }
  }
  return null
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/model/modelSuggestions.ts
git commit -m "feat: context-aware model suggestion engine"
```

### Task 7: Add favoriteModels and multi-model settings to schema

**Files:**
- Modify: `src/utils/settings/types.ts`

- [ ] **Step 1: Add new fields to settings schema**

Find the settings schema definition and add these optional fields:

```typescript
favoriteModels: z.array(z.string()).optional(),

deliberation: z.object({
  defaultModels: z.array(z.string()).optional(),
  maxRounds: z.number().optional(),
  autoStop: z.boolean().optional(),
  showTokenUsage: z.boolean().optional(),
}).optional(),

swarm: z.object({
  defaultAssignments: z.record(z.string(), z.string()).optional(),
  autoMerge: z.boolean().optional(),
  reviewAfterMerge: z.boolean().optional(),
  maxWorkersParallel: z.number().optional(),
}).optional(),
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/settings/types.ts
git commit -m "feat: add favoriteModels, deliberation, swarm to settings schema"
```

### Task 8: Extend model picker with OpenRouter browser

**Files:**
- Modify: `src/utils/model/modelOptions.ts:462-526`
- Modify: `src/components/ModelPicker.tsx`

- [ ] **Step 1: Add OpenRouter model option helpers to modelOptions.ts**

Add imports and helper functions:

```typescript
import { fetchOpenRouterModels, type OpenRouterModel } from './openrouterModels.js'

export function openRouterModelToOption(m: OpenRouterModel): ModelOption {
  const priceStr = `$${(m.pricing.prompt * 1_000_000).toFixed(2)}/$${(m.pricing.completion * 1_000_000).toFixed(2)}`
  const ctxStr = m.contextLength >= 1_000_000
    ? `${(m.contextLength / 1_000_000).toFixed(0)}M ctx`
    : `${(m.contextLength / 1000).toFixed(0)}K ctx`
  return {
    value: m.id,
    label: m.name,
    description: `${m.provider} . ${priceStr} . ${ctxStr}`,
  }
}

export async function getOpenRouterModelOptions(): Promise<ModelOption[]> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return []
  try {
    const models = await fetchOpenRouterModels(key)
    return models.map(openRouterModelToOption)
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Update ModelPicker with search, filters, favorites**

Modify `src/components/ModelPicker.tsx` to add:
- Text input state for live search filtering
- Provider filter state that cycles with Tab key
- Favorites section at top (read from settings `favoriteModels`)
- Smart suggestions section between favorites and catalog
- Cmd+F handler to toggle favorite on highlighted model
- Async loading of OpenRouter models on mount via `getOpenRouterModelOptions()`
- Sectioned rendering: Favorites > Suggestions > All Claude > All OpenRouter

The component already uses React hooks and Ink. Add new state:
```typescript
const [searchQuery, setSearchQuery] = useState('')
const [activeFilter, setActiveFilter] = useState('all')
const [openRouterModels, setOpenRouterModels] = useState<ModelOption[]>([])
const [favorites, setFavorites] = useState<string[]>([])
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/utils/model/modelOptions.ts src/components/ModelPicker.tsx
git commit -m "feat: OpenRouter model browser with search, filters, favorites

Full-catalog model picker with live search, provider filter tabs,
favorites (Cmd+F to pin), and context-aware smart suggestions."
```

---

## Phase 4: Deliberation Room

### Task 9: Create deliberation types

**Files:**
- Create: `src/deliberation/types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/deliberation/types.ts

export type DeliberationConfig = {
  topic: string
  models: string[]
  maxRounds: number
  autoStop: boolean
  showTokenUsage: boolean
  context?: string
}

export type ModelResponse = {
  model: string
  content: string
  round: number
  respondingTo: string[]
  tokens: { input: number; output: number }
  costUSD: number
  latencyMs: number
}

export type Round = {
  number: number
  responses: ModelResponse[]
  converged: boolean
}

export type DeliberationState = {
  config: DeliberationConfig
  rounds: Round[]
  currentRound: number
  status: 'running' | 'converged' | 'stopped' | 'complete'
  totalCostUSD: number
  humanInjections: Array<{ afterRound: number; message: string }>
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/deliberation/types.ts
git commit -m "feat: deliberation room type definitions"
```

### Task 10: Create deliberation prompts with anti-sycophancy

**Files:**
- Create: `src/deliberation/prompts.ts`

- [ ] **Step 1: Create system prompts and convergence detection**

```typescript
// src/deliberation/prompts.ts

export function getDeliberationSystemPrompt(
  modelName: string,
  totalModels: number,
): string {
  return `You are ${modelName}, participating in a deliberation with ${totalModels - 1} other AI model${totalModels > 2 ? 's' : ''}. Your job is to make the final answer BETTER, not to be polite.

Rules:
- If you see a flaw in another model's reasoning, call it out directly with evidence
- If you have a better approach, present it with clear reasoning
- If you agree with a point, say WHY it's correct and ADD something new — never just echo
- If a previous revision addressed your concern, acknowledge it briefly and move to the next weakness
- Converge when the solution is genuinely strong, not to be agreeable
- Never say "great point" or "I agree" without substantive addition
- Be direct and specific — vague criticism is worse than no criticism
- When you revise your position, explain what changed your mind

Format your response as clear, structured analysis. Lead with your position, then your reasoning.`
}

export function getRoundPrompt(
  round: number,
  maxRounds: number,
  topic: string,
  previousResponses: Array<{ model: string; content: string }>,
  humanInjection?: string,
): string {
  let prompt = `## Deliberation Round ${round}/${maxRounds}\n\n**Topic:** ${topic}\n\n`

  if (previousResponses.length > 0) {
    prompt += `### Previous responses this round:\n\n`
    for (const r of previousResponses) {
      prompt += `**${r.model}:**\n${r.content}\n\n---\n\n`
    }
  }

  if (humanInjection) {
    prompt += `### Human input (highest priority):\n${humanInjection}\n\n`
  }

  if (round === maxRounds) {
    prompt += `This is the FINAL round. Synthesize the best ideas into a clear, actionable recommendation.\n`
  } else if (round > 1) {
    prompt += `Review the other models' responses. Challenge what's weak, build on what's strong, revise your position if warranted.\n`
  } else {
    prompt += `Present your initial analysis. Be thorough but concise.\n`
  }

  return prompt
}

const CHALLENGE_MARKERS = [
  'however', 'but i disagree', 'alternatively', 'i would push back',
  'the problem with', 'this overlooks', 'a better approach',
  'flawed', 'incorrect', 'missing', 'fails to',
]

export function checkConvergence(rounds: Array<{ responses: Array<{ content: string }> }>): boolean {
  if (rounds.length < 2) return false
  const lastTwo = rounds.slice(-2)
  for (const round of lastTwo) {
    for (const response of round.responses) {
      const lower = response.content.toLowerCase()
      if (CHALLENGE_MARKERS.some(m => lower.includes(m))) {
        return false
      }
    }
  }
  return true
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/deliberation/prompts.ts
git commit -m "feat: deliberation prompts with anti-sycophancy and convergence detection"
```

### Task 11: Create deliberation engine

**Files:**
- Create: `src/deliberation/engine.ts`

- [ ] **Step 1: Create the core deliberation loop**

```typescript
// src/deliberation/engine.ts

import { getAnthropicClient } from '../services/api/client.js'
import type { DeliberationConfig, DeliberationState, ModelResponse, Round } from './types.js'
import { checkConvergence, getDeliberationSystemPrompt, getRoundPrompt } from './prompts.js'

export type DeliberationCallbacks = {
  onRoundStart: (round: number) => void
  onModelStart: (model: string, round: number) => void
  onModelChunk: (model: string, chunk: string) => void
  onModelComplete: (response: ModelResponse) => void
  onRoundComplete: (round: Round) => void
  onConverged: () => void
  onComplete: (state: DeliberationState) => void
}

function estimateCost(model: string, input: number, output: number): number {
  const PRICING: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6': { input: 15, output: 75 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'openai/gpt-5.4': { input: 10, output: 30 },
    'openai/gpt-5': { input: 10, output: 30 },
    'thudm/glm-5.1': { input: 2, output: 6 },
    'google/gemini-3.1-pro': { input: 1.25, output: 5 },
    'google/gemini-2.5-pro-preview': { input: 1.25, output: 10 },
  }
  const p = PRICING[model] ?? { input: 1, output: 3 }
  return (input * p.input + output * p.output) / 1_000_000
}

async function queryModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  callbacks: DeliberationCallbacks,
): Promise<ModelResponse> {
  const start = performance.now()
  const client = await getAnthropicClient({ maxRetries: 2, model })

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    stream: true,
  })

  let content = ''
  let inputTokens = 0
  let outputTokens = 0

  for await (const event of response) {
    if (event.type === 'content_block_delta' && 'text' in event.delta) {
      content += event.delta.text
      callbacks.onModelChunk(model, event.delta.text)
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens ?? 0
    }
    if (event.type === 'message_start' && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens ?? 0
    }
  }

  return {
    model,
    content,
    round: 0,
    respondingTo: [],
    tokens: { input: inputTokens, output: outputTokens },
    costUSD: estimateCost(model, inputTokens, outputTokens),
    latencyMs: Math.round(performance.now() - start),
  }
}

export async function runDeliberation(
  config: DeliberationConfig,
  callbacks: DeliberationCallbacks,
  getHumanInjection: () => Promise<string | null>,
): Promise<DeliberationState> {
  const state: DeliberationState = {
    config,
    rounds: [],
    currentRound: 0,
    status: 'running',
    totalCostUSD: 0,
    humanInjections: [],
  }

  for (let roundNum = 1; roundNum <= config.maxRounds; roundNum++) {
    state.currentRound = roundNum
    callbacks.onRoundStart(roundNum)

    const round: Round = { number: roundNum, responses: [], converged: false }
    const roundResponses: Array<{ model: string; content: string }> = []

    const injection = await getHumanInjection()
    if (injection) {
      state.humanInjections.push({ afterRound: roundNum - 1, message: injection })
    }

    for (const model of config.models) {
      callbacks.onModelStart(model, roundNum)

      const systemPrompt = getDeliberationSystemPrompt(model, config.models.length)
      const userPrompt = getRoundPrompt(
        roundNum, config.maxRounds, config.topic,
        roundResponses, injection ?? undefined,
      )

      const response = await queryModel(model, systemPrompt, userPrompt, callbacks)
      response.round = roundNum
      response.respondingTo = roundResponses.map(r => r.model)

      round.responses.push(response)
      roundResponses.push({ model, content: response.content })
      state.totalCostUSD += response.costUSD
      callbacks.onModelComplete(response)
    }

    state.rounds.push(round)
    callbacks.onRoundComplete(round)

    if (config.autoStop && checkConvergence(state.rounds)) {
      state.status = 'converged'
      callbacks.onConverged()
      break
    }
  }

  if (state.status === 'running') state.status = 'complete'
  callbacks.onComplete(state)
  return state
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/deliberation/engine.ts
git commit -m "feat: deliberation engine with streaming, convergence, and human injection"
```

### Task 12: Create /deliberate command and register

**Files:**
- Create: `src/commands/deliberate/deliberate.tsx`
- Modify: `src/commands.ts`

- [ ] **Step 1: Create the deliberate command**

Create `src/commands/deliberate/deliberate.tsx` implementing the `/deliberate` slash command. Parse args for `--models` (comma-separated), `--rounds` (number), `--duo` (shortcut for 2-model), and the remaining topic string. Read defaults from settings. Render the deliberation room UI with Ink — model-colored borders, round counter, streaming text, token usage. Support Ctrl+C to stop and Enter to inject thoughts.

Register in `src/commands.ts`:
```typescript
import { deliberateCommand } from './commands/deliberate/deliberate.js'
// Add to commands: deliberate: deliberateCommand,
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/commands/deliberate/ src/commands.ts
git commit -m "feat: /deliberate command for multi-model deliberation room"
```

---

## Phase 5: Designer Agent

### Task 13: Create designer context assembly

**Files:**
- Create: `src/agents/designer/context.ts`

- [ ] **Step 1: Create design token discovery and component scanning**

```typescript
// src/agents/designer/context.ts

import { readFile } from 'fs/promises'
import { join } from 'path'

export type DesignContext = {
  designTokens: string | null
  existingComponents: Array<{ path: string; preview: string }>
  projectStack: string[]
}

export async function assembleDesignContext(cwd: string): Promise<DesignContext> {
  return {
    designTokens: await findDesignTokens(cwd),
    existingComponents: await scanComponents(cwd),
    projectStack: await detectStack(cwd),
  }
}

async function findDesignTokens(cwd: string): Promise<string | null> {
  const candidates = [
    'tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs',
    'src/styles/globals.css', 'app/globals.css', 'styles/globals.css',
    'src/styles/theme.ts', 'src/theme.ts',
  ]
  for (const candidate of candidates) {
    try {
      const content = await readFile(join(cwd, candidate), 'utf8')
      return `/* ${candidate} */\n${content.slice(0, 3000)}`
    } catch { continue }
  }
  return null
}

async function scanComponents(cwd: string): Promise<Array<{ path: string; preview: string }>> {
  const { glob } = await import('glob')
  const patterns = [
    'src/components/**/*.tsx', 'src/app/**/*.tsx',
    'app/**/*.tsx', 'components/**/*.tsx',
  ]
  const components: Array<{ path: string; preview: string }> = []
  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, { cwd })
      for (const file of files.slice(0, 20)) {
        try {
          const content = await readFile(join(cwd, file), 'utf8')
          components.push({ path: file, preview: content.split('\n').slice(0, 10).join('\n') })
        } catch { continue }
      }
    } catch { continue }
  }
  return components
}

async function detectStack(cwd: string): Promise<string[]> {
  const stack: string[] = []
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps['tailwindcss']) stack.push('tailwindcss')
    if (deps['framer-motion']) stack.push('framer-motion')
    if (deps['next']) stack.push('nextjs')
    if (deps['react']) stack.push('react')
    if (deps['@radix-ui/react-dialog'] || deps['@radix-ui/themes']) stack.push('radix-ui')
  } catch {}
  return stack
}
```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/agents/designer/context.ts
git commit -m "feat: designer context assembly — design tokens, components, stack detection"
```

### Task 14: Create designer agent definition and register

**Files:**
- Create: `src/agents/designer/agent.ts`
- Modify: `src/tools/AgentTool/builtInAgents.ts`

- [ ] **Step 1: Create the designer agent definition**

Create `src/agents/designer/agent.ts` exporting `DESIGNER_AGENT` as a `BuiltInAgentDefinition`. Set:
- `agentType: 'designer'`
- `source: 'built-in'`, `baseDir: 'built-in'`
- `whenToUse`: describes visual improvement, redesign, mockup, beautiful/polished/modern triggers
- `model: 'google/gemini-3.1-pro'`
- `tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']`
- `getSystemPrompt()`: returns the full designer system prompt covering:
  - Identity as a designer who codes, not a general assistant
  - Design philosophy: beautiful modern UIs, smooth animations everywhere, glassmorphism, gradients, depth, premium component quality, typography, dark mode, pixel-perfect spacing, hover/focus/active states, loading/empty/error states, responsive, accessible
  - Before-writing checklist: read existing components, identify design system, check tailwind/theme, match visual language
  - Output format: production-ready React/TSX, Tailwind by default, Framer Motion for animations
  - Handoff: Claude handles types, state, API, testing after designer finishes

- [ ] **Step 2: Register in builtInAgents.ts**

```typescript
// Add import at top of src/tools/AgentTool/builtInAgents.ts
import { DESIGNER_AGENT } from '../../agents/designer/agent.js'

// Inside getBuiltInAgents(), add to the agents array:
agents.push(DESIGNER_AGENT)
```

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/agents/designer/agent.ts src/tools/AgentTool/builtInAgents.ts
git commit -m "feat: Gemini designer agent — built-in frontend design specialist"
```

### Task 15: Create /design command and register

**Files:**
- Create: `src/commands/design/design.tsx`
- Modify: `src/commands.ts`

- [ ] **Step 1: Create the /design command**

Create `src/commands/design/design.tsx`. Parse args for topic string and `--review` flag. In design-first mode: assemble design context, dispatch the designer agent via the Agent tool system. In review mode: scan for components, send audit request.

Register in `src/commands.ts`:
```typescript
import { designCommand } from './commands/design/design.js'
// Add to commands: design: designCommand,
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/commands/design/ src/commands.ts
git commit -m "feat: /design command for design-first and review modes"
```

---

## Phase 6: Swarm Mode

### Task 16: Create swarm types

**Files:**
- Create: `src/swarm/types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/swarm/types.ts

export type WorkstreamDomain = 'frontend' | 'backend' | 'wiring' | 'tests' | 'debugging' | 'custom'

export type Workstream = {
  id: string
  name: string
  domain: WorkstreamDomain
  model: string
  description: string
  scope: string[]
  tasks: WorkstreamTask[]
  status: 'pending' | 'running' | 'complete' | 'failed'
  worktreePath?: string
  worktreeBranch?: string
}

export type WorkstreamTask = {
  description: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  file?: string
}

export type SwarmConfig = {
  description: string
  workstreams: Workstream[]
  coordinator: string
  autoMerge: boolean
  reviewAfterMerge: boolean
  maxWorkersParallel: number
}

export type SwarmState = {
  config: SwarmConfig
  phase: 'decomposing' | 'building' | 'merging' | 'reviewing' | 'complete' | 'failed'
  workstreams: Workstream[]
  totalCostUSD: number
  startTime: number
}

export type SwarmCallbacks = {
  onDecomposed: (workstreams: Workstream[]) => void
  onWorkerStart: (workstream: Workstream) => void
  onWorkerProgress: (workstreamId: string, task: WorkstreamTask) => void
  onWorkerComplete: (workstream: Workstream) => void
  onWorkerFailed: (workstream: Workstream, error: string) => void
  onMergeStart: () => void
  onMergeComplete: (conflicts: number) => void
  onReviewStart: () => void
  onComplete: (state: SwarmState) => void
}

export const DEFAULT_MODEL_ASSIGNMENTS: Record<WorkstreamDomain, string> = {
  frontend: 'google/gemini-3.1-pro',
  backend: 'openai/gpt-5.4',
  wiring: 'claude-opus-4-6',
  tests: 'claude-sonnet-4-6',
  debugging: 'claude-opus-4-6',
  custom: 'claude-opus-4-6',
}
```

- [ ] **Step 2: Verify build and commit**

Run: `npm run check` then commit:
```bash
git add src/swarm/types.ts
git commit -m "feat: swarm mode type definitions"
```

### Task 17: Create swarm coordinator

**Files:**
- Create: `src/swarm/coordinator.ts`

- [ ] **Step 1: Create the coordinator with task decomposition**

Create `src/swarm/coordinator.ts` that exports `decomposeTask(description, codebaseContext, coordinatorModel)`. It calls the coordinator model (Opus) with a system prompt instructing it to decompose a feature into independent workstreams with clear file boundaries. The model returns JSON with workstream definitions. Parse the response, assign default models per domain from `DEFAULT_MODEL_ASSIGNMENTS`, and return `Workstream[]`.

- [ ] **Step 2: Verify build and commit**

```bash
git add src/swarm/coordinator.ts
git commit -m "feat: swarm coordinator — task decomposition with Opus"
```

### Task 18: Create swarm worker and merger

**Files:**
- Create: `src/swarm/worker.ts`
- Create: `src/swarm/merger.ts`

- [ ] **Step 1: Create the worker module**

Create `src/swarm/worker.ts` that exports `runWorker(workstream, repoRoot, callbacks)`. It:
1. Creates a git worktree using `execa('git', ['worktree', 'add', ...])` (never shell interpolation)
2. Builds a task prompt from the workstream's description, tasks, and file scope
3. Runs void CLI as a subprocess in the worktree directory using `execa('node', [cliPath, '--print', '--model', model, '-p', prompt], { cwd: worktreePath })`
4. Updates workstream status and calls callbacks

- [ ] **Step 2: Create the merger module**

Create `src/swarm/merger.ts` that exports `mergeWorktrees(workstreams, repoRoot)`. It:
1. Iterates completed workstreams
2. Merges each branch using `execa('git', ['merge', branch, '--no-edit'])` 
3. On conflict: resolves by accepting theirs, stages, commits
4. Cleans up worktrees and branches after merge
5. Returns `{ success, conflicts, conflictFiles }`

- [ ] **Step 3: Verify build and commit**

```bash
git add src/swarm/worker.ts src/swarm/merger.ts
git commit -m "feat: swarm worker and merger — worktree-isolated parallel agents"
```

### Task 19: Create /swarm command and register

**Files:**
- Create: `src/commands/swarm/swarm.tsx`
- Modify: `src/commands.ts`

- [ ] **Step 1: Create the /swarm command**

Create `src/commands/swarm/swarm.tsx`. Parse args for feature description, `--models`, `--no-merge`, `--no-review`. Implement the 4-phase flow:
1. Decompose: show workstream plan, ask for approval
2. Build: dispatch workers in parallel, render progress UI
3. Merge: merge worktrees, show conflicts
4. Review: optional deliberation on merged result

Render the multi-panel swarm UI with Ink.

Register in `src/commands.ts`:
```typescript
import { swarmCommand } from './commands/swarm/swarm.js'
// Add to commands: swarm: swarmCommand,
```

- [ ] **Step 2: Verify build and commit**

```bash
git add src/commands/swarm/ src/commands.ts
git commit -m "feat: /swarm command for multi-model parallel implementation"
```

---

## Phase 7: Smart Mode Triggers

### Task 20: Register deliberate, swarm, and design as bundled skills

**Files:**
- Create: `src/skills/bundled/deliberate.ts`
- Create: `src/skills/bundled/swarm.ts`
- Create: `src/skills/bundled/design.ts`
- Modify: `src/skills/bundled/index.ts`

- [ ] **Step 1: Create deliberate skill**

```typescript
// src/skills/bundled/deliberate.ts

import { registerBundledSkill } from '../bundledSkills.js'

export function registerDeliberateSkill(): void {
  registerBundledSkill({
    name: 'deliberate',
    description: 'Multi-model deliberation for hard decisions. 2-3 models debate sequentially, challenging assumptions to converge on the best solution.',
    aliases: ['debate', 'discuss'],
    whenToUse: 'Architecture decisions, tradeoff discussions, design pattern selection, or when the user is stuck choosing between approaches. Trigger on: "should we X or Y?", "best approach", "tradeoffs", "pros and cons", "which one"',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: `The user wants to start a multi-model deliberation on: "${args}"\n\nUse the /deliberate command to launch the deliberation room. If no specific models were requested, use defaults from settings or fall back to opus + the user's secondary model. Present the deliberation results and consensus when complete.` }]
    },
  })
}
```

- [ ] **Step 2: Create swarm skill**

```typescript
// src/skills/bundled/swarm.ts

import { registerBundledSkill } from '../bundledSkills.js'

export function registerSwarmSkill(): void {
  registerBundledSkill({
    name: 'swarm',
    description: 'Multi-model parallel implementation. Different models build different parts of the codebase simultaneously in isolated worktrees.',
    aliases: ['crew', 'team'],
    whenToUse: 'Multi-layer features with clear frontend/backend/data separation, large features with 3+ independent components, or full-stack tasks. Trigger on: "build X with Y and Z", "full feature", "from scratch", "end to end"',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: `The user wants swarm mode to build: "${args}"\n\nUse the /swarm command. The coordinator (Opus) will decompose the task into workstreams and assign models. Present the decomposition plan for user approval before launching workers.` }]
    },
  })
}
```

- [ ] **Step 3: Create design skill**

```typescript
// src/skills/bundled/design.ts

import { registerBundledSkill } from '../bundledSkills.js'

export function registerDesignSkill(): void {
  registerBundledSkill({
    name: 'design',
    description: 'Gemini-powered frontend design specialist. Creates beautiful, modern, production-grade UI components with exceptional visual quality.',
    aliases: ['designer', 'fronty'],
    whenToUse: 'Visual improvement requests, UI redesigns, design-first mockups, or when the user wants beautiful/polished/modern/premium interfaces. Trigger on: "make it look better", "redesign", "10x the UI", "beautiful", "polished", editing .tsx with layout work',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: `The user wants the designer agent to work on: "${args}"\n\nLaunch the designer agent (Gemini 3.1 Pro) using Agent tool with subagent_type="designer". The designer reads existing components and design tokens, then writes beautiful production-grade UI code. You handle types, state, and testing after.` }]
    },
  })
}
```

- [ ] **Step 4: Register all three in index.ts**

Add to `src/skills/bundled/index.ts` inside `initBundledSkills()`:

```typescript
import { registerDeliberateSkill } from './deliberate.js'
import { registerSwarmSkill } from './swarm.js'
import { registerDesignSkill } from './design.js'

// Inside initBundledSkills():
registerDeliberateSkill()
registerSwarmSkill()
registerDesignSkill()
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/skills/bundled/deliberate.ts src/skills/bundled/swarm.ts src/skills/bundled/design.ts src/skills/bundled/index.ts
git commit -m "feat: smart mode triggers — deliberate, swarm, and design as bundled skills

Void dynamically suggests the right mode based on conversation context.
Always suggests, never auto-launches."
```

---

## Task 21: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Verify all commands registered**

Run void, type `/help`. Verify `deliberate`, `swarm`, `design` appear in command list.

- [ ] **Step 3: Verify marketplace**

Run void, `/plugin` — should show full catalog of official plugins.

- [ ] **Step 4: Verify provider**

Run `/provider list` — should show openrouter, openai, gemini.

- [ ] **Step 5: Push**

```bash
git push origin master
```
