# Void CLI Multi-Model Platform Design Spec

**Date:** 2026-04-14
**Author:** Usman + Claude
**Status:** Approved

## Overview

Transform Void CLI from a single-model Claude Code fork into a multi-model AI development platform. Seven interconnected features that let different AI models collaborate — debating ideas, building code in parallel, and designing beautiful interfaces — while Void dynamically suggests the right mode for each situation.

## Features

### 1. Fix Plugin Marketplace

**Problem:** Void tries to install plugins from `anthropics/void-plugins-official` which doesn't exist. Both GCS CDN and git fallback fail. Claude Code uses `anthropics/claude-plugins-official` (33 plugins).

**Solution:** Change 3 files:

- `src/utils/plugins/officialMarketplace.ts`
  - `repo` → `'anthropics/claude-plugins-official'`
  - `OFFICIAL_MARKETPLACE_NAME` → `'claude-plugins-official'`
- `src/utils/plugins/officialMarketplaceGcs.ts`
  - `GCS_BASE` → `'https://downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official'`
  - `ARC_PREFIX` → `'marketplaces/claude-plugins-official/'`

**Result:** `/plugin` shows all 33 official plugins — superpowers, figma, slack, telegram, frontend-design, code-review, LSPs, etc.

---

### 2. OpenRouter Model Browser

**Problem:** The model picker only shows hardcoded Claude aliases (sonnet, opus, haiku). OpenRouter models require manual `/model openai/gpt-4o` or env vars. No discovery, no browsing.

**Solution:** Replace the model picker with a full-catalog browser.

#### UX

- **Search** — Live text filter as you type
- **Favorites** — `Cmd+F` toggles favorite on highlighted model. Favorites pinned at top with star icon. Stored in `settings.json` as `favoriteModels: string[]`
- **Smart suggestions** — Context-aware section between favorites and catalog. Heuristic engine checks recent tool use and file types in context:
  - `.tsx/.css/.html` files → suggests design-capable models (Gemini)
  - Test files → suggests reasoning models (Opus, GLM)
  - Complex algorithms → suggests math/reasoning models
- **Provider filter** — Tab cycles: All → Anthropic → OpenAI → Google → Meta → Zhipu → etc. Extracted from model ID prefix (part before `/`)
- **Pricing display** — Shows input/output cost per 1M tokens and context window size

#### Hotkeys

| Key | Action |
|-----|--------|
| `↑↓` | Navigate models |
| `Enter` | Select model |
| `Cmd+F` | Toggle favorite |
| `Tab` | Cycle provider filter |
| `Esc` | Cancel |
| Type | Live search |

#### Data Flow

1. On first `/model` open: GET `https://openrouter.ai/api/v1/models` (requires `OPENROUTER_API_KEY`)
2. Cache response in `~/.void/cache/openrouter-models.json` with 1-hour TTL
3. Parse into structured list with provider, pricing, context window
4. Merge with Anthropic first-party models (always shown, even without OpenRouter)

#### Files

- `src/utils/model/openrouterModels.ts` **(new)** — API client, model fetching, caching
- `src/utils/model/modelSuggestions.ts` **(new)** — Context-aware suggestion engine
- `src/utils/model/modelOptions.ts` — Extend `getModelOptions()` to include OpenRouter models
- `src/components/ModelPicker.tsx` — Rewrite with search, filters, favorites, suggestions sections
- `src/utils/settings/types.ts` — Add `favoriteModels` field

---

### 3. Deliberation Room

**Purpose:** 2-3 models in a live round-based debate. They build on each other's ideas, challenge assumptions, and converge on a solution better than any single model could produce.

#### Invocation

```
/deliberate "topic"                          # Default panel
/deliberate --models opus,glm-5.1 "topic"   # Specific models
/deliberate --rounds 3 "topic"               # Set max rounds (default: 5)
/deliberate --duo "topic"                    # Quick 2-model with default secondary
```

Also invokable mid-conversation — Void auto-suggests when it detects architecture decisions or tradeoff discussions.

#### Execution Flow

1. All models receive: topic + codebase context (relevant files, recent conversation)
2. Model A responds first (highest-tier or randomly selected)
3. Model B receives A's response, responds with agreement/challenge/addition
4. Model C (if trio) receives both, synthesizes and adds
5. Model A gets all feedback, revises — this completes one "round"
6. Repeat for N rounds or until convergence
7. Final round: synthesize into actionable recommendation

#### Convergence Detection

Auto-stop when all models agree on the core approach for 2 consecutive rounds. Detected by checking for absence of "however", "but I disagree", "alternatively" type markers + semantic similarity of proposals.

#### Human Injection

Press `Enter` at any point to type a message. It's injected into the next round as highest-priority context. Models treat human input as a steering signal, not just another opinion.

#### Anti-Sycophancy System Prompt

Each model receives:

```
You are in a deliberation with other AI models. Your job is to make the
final answer BETTER, not to be polite. Specifically:
- If you see a flaw, call it out directly with evidence
- If you have a better approach, present it with reasoning
- If you agree, say WHY and ADD something new — don't just echo
- If the previous model's revision addressed your concern, acknowledge
  it and move on to the next weakness
- Converge when the solution is genuinely strong, not to end the debate
- Never say "great point" without adding substance
```

#### UI

Rendered in terminal with model-colored borders. Each response shows:
- Model name + color identifier
- Round number
- Context tag ("responding to Opus", "incorporating feedback")
- Streaming text

#### Hotkeys

| Key | Action |
|-----|--------|
| `Ctrl+C` | Stop deliberation early |
| `Ctrl+S` | Save transcript to file |
| `Enter` | Inject human thoughts into next round |

#### Settings

```json
{
  "deliberation": {
    "defaultModels": ["opus", "thudm/glm-5.1"],
    "maxRounds": 5,
    "autoStop": true,
    "showTokenUsage": true
  }
}
```

#### Files

- `src/deliberation/types.ts` **(new)** — DeliberationConfig, Round, ModelResponse, ConvergenceState
- `src/deliberation/engine.ts` **(new)** — Core loop, round management, convergence detection
- `src/deliberation/renderer.ts` **(new)** — Ink component for the deliberation room UI
- `src/deliberation/prompts.ts` **(new)** — System prompts, anti-sycophancy instructions, round framing
- `src/commands/deliberate/` **(new)** — `/deliberate` slash command
- `src/skills/bundled/deliberate.ts` **(new)** — Skill registration with whenToUse triggers
- `src/utils/settings/types.ts` — Add deliberation config to settings schema

---

### 4. Swarm Mode

**Purpose:** Multi-model parallel implementation. Different models build different parts of the codebase simultaneously, each playing to their strengths. A coordinator decomposes, assigns, and merges.

#### Invocation

```
/swarm "build a dashboard with real-time analytics and REST API"
/swarm --models gemini:frontend,gpt-5.4:backend "feature description"
/swarm --no-merge "feature"   # Skip auto-merge, leave worktrees for manual review
```

Also auto-suggested by Void when it detects multi-layer features with clear separation.

#### Execution Phases

**Phase 1 — Decompose (Coordinator: Opus)**
- Reads codebase structure, understands the request
- Breaks task into workstreams with: clear scope, file boundaries, model assignment
- Presents decomposition to user for approval before launching

**Phase 2 — Build (Parallel Workers)**
- Each model gets its own git worktree (`swarm/<workstream-name>`)
- Models work independently, only touching files in their assigned scope
- Real-time progress streams back to the swarm UI (task list per worker)
- Each worker has full tool access: Read, Write, Edit, Glob, Grep, Bash

**Phase 3 — Wire + Merge (Coordinator: Opus)**
- Merges all worktrees back to the working branch
- Resolves merge conflicts (coordinator has full context of all workstreams)
- Adds integration code: shared types, API clients, error boundaries, routing
- Runs build + tests to verify

**Phase 4 — Review (Optional)**
- Quick deliberation round where all models review the merged result
- Flag issues, suggest improvements
- Skippable with `--no-review`

#### Default Model Assignments

| Domain | Default Model | Rationale |
|--------|--------------|-----------|
| Frontend / UI | Gemini 3.1 Pro | Best visual design sense |
| Backend / API | GPT-5.4 / Codex | Strong at structured backend code |
| Wiring / Architecture | Opus 4.6 | Best at system-level reasoning |
| Tests | Sonnet 4.6 | Fast, good at pattern-matching test cases |
| Debugging | Opus 4.6 | Best at root cause analysis |

Fully configurable in settings and per-invocation via `--models` flag.

#### UI

Real-time multi-panel display showing:
- Coordinator status bar at top
- Per-worker progress: task list with checkmarks, current file being edited, streaming status
- Overall progress bar with percentage
- Token usage and estimated cost
- Hotkeys footer

#### Hotkeys

| Key | Action |
|-----|--------|
| `Enter` | Inject guidance to coordinator |
| `Ctrl+C` | Abort all workers |
| `Ctrl+P` | Pause a specific agent |
| `Tab` | Switch focus between workers |

#### Settings

```json
{
  "swarm": {
    "defaultAssignments": {
      "frontend": "google/gemini-3.1-pro",
      "backend": "openai/gpt-5.4",
      "wiring": "opus",
      "tests": "sonnet"
    },
    "autoMerge": true,
    "reviewAfterMerge": true,
    "maxWorkersParallel": 3
  }
}
```

#### Files

- `src/swarm/types.ts` **(new)** — SwarmConfig, Workstream, WorkerState, MergeResult
- `src/swarm/coordinator.ts` **(new)** — Task decomposition, model assignment, merge orchestration
- `src/swarm/worker.ts` **(new)** — Per-model worker wrapping Agent tool with worktree isolation
- `src/swarm/renderer.ts` **(new)** — Ink component for multi-agent progress UI
- `src/swarm/merger.ts` **(new)** — Git worktree merge, conflict resolution
- `src/commands/swarm/` **(new)** — `/swarm` slash command
- `src/skills/bundled/swarm.ts` **(new)** — Skill registration with whenToUse triggers

---

### 5. Designer Agent (Gemini 3.1 Pro)

**Purpose:** Built-in frontend design specialist. Gemini 3.1 Pro writes production-grade, beautiful, modern UI code. Claude handles types, state, backend, testing after.

#### Two Modes

**Invoke Mode (mid-flow):** User says "make this look better" or "redesign this component." Void brings in the designer, it reads existing code and design system, rewrites the visual layer, hands back to Claude for cleanup.

**Design-First Mode:** `/design "landing page for klipt"`. Designer generates a visual spec (layout, components, color, typography), user approves, designer writes all the code.

#### Invocation

```
/design "landing page for klipt — dark, cyberpunk"    # Design-first
/design --review                                        # Audit current UI
```

Also auto-invoked when Void detects: "make it look better", "redesign", "10x the UI", "beautiful", "polished", "modern", visual mockup requests.

#### Designer System Prompt

```
You are the Designer — a frontend design specialist powered by Gemini 3.1 Pro,
embedded inside Void CLI. You write production-grade UI code with exceptional
visual quality. You are a designer who codes.

## Your Design Philosophy
You create interfaces that make people stop and stare. Every component you
build should look like it belongs in a premium SaaS product or an award-winning
portfolio piece. You don't make "functional" UIs — you make BEAUTIFUL ones.

- Modern, contemporary design language — clean lines, intentional whitespace,
  sophisticated color palettes
- Smooth, delightful animations on EVERYTHING — page transitions, hover states,
  loading sequences, micro-interactions. Use Framer Motion or CSS transitions.
  Nothing should feel static or jarring.
- Glassmorphism, subtle gradients, depth through layered shadows — use current
  design trends tastefully, not gratuitously
- Premium component quality — every button, card, input, and modal should feel
  like it came from a world-class design system
- Typography that breathes — proper hierarchy, generous line-height, intentional
  font weight variations
- Dark mode done RIGHT — not inverted colors, but a carefully crafted palette
  with proper contrast ratios and subtle luminance differences
- Pixel-perfect spacing — consistent padding/margin system, aligned grids,
  nothing "close enough"
- Hover/focus/active states on every interactive element — no dead clicks
- Loading states, empty states, error states — every state is designed, not
  an afterthought
- Responsive from the ground up — mobile-first, fluid layouts, no breakpoint
  jank
- Accessibility built in — semantic HTML, ARIA labels, keyboard navigation,
  proper contrast ratios

## Before Writing Code
1. Read the existing components in the target directory
2. Identify the design system: colors, fonts, spacing, component patterns
3. Check for tailwind.config, theme files, CSS variables, design tokens
4. Match the existing visual language — enhance it, don't replace it

## What You Output
- Production-ready React/TSX components
- Tailwind CSS by default, CSS modules if the project uses them
- Framer Motion for animations if available, CSS transitions otherwise
- Every component includes: default, hover, focus, active, loading, empty,
  error states
- Responsive breakpoints: mobile (default), sm, md, lg, xl

## Handoff
After you finish, the main agent (Claude) handles:
- TypeScript types and interfaces
- State management and data fetching
- API integration and error handling
- Testing
You focus purely on the visual layer. Make it stunning.
```

#### Context Assembly

Before writing any code, the designer:
1. Reads the target directory's existing components
2. Discovers design tokens: `tailwind.config.*`, CSS variables, theme files, `globals.css`
3. Identifies patterns: component naming conventions, file structure, import style
4. Reads current conversation context (what the user wants changed)
5. Packages all context + system prompt into a Gemini API request

#### API Integration

Direct Gemini API call via `@google/genai` SDK — NOT through OpenRouter. Benefits:
- Lower latency (no proxy hop)
- Native Gemini features (grounding, code execution if needed)
- Auth: `GEMINI_API_KEY` env var or macOS Keychain (`Void-gemini`)

#### Tool Access

Same tools as any Void agent: Read, Write, Edit, Glob, Grep, Bash. The designer can:
- Read existing files to understand context
- Write new component files
- Edit existing components in place
- Run the dev server to check output
- Search for patterns across the codebase

#### Files

- `src/agents/designer/agent.ts` **(new)** — Agent definition, system prompt, mode logic
- `src/agents/designer/context.ts` **(new)** — Design token discovery, component scanning
- `src/agents/designer/geminiClient.ts` **(new)** — Direct Gemini API wrapper
- `src/commands/design/` **(new)** — `/design` slash command
- `src/skills/bundled/design.ts` **(new)** — Skill registration with whenToUse triggers
- `src/tools/AgentTool/builtInAgents.ts` — Register designer as built-in agent type

---

### 6. Provider Auth (OpenAI + Google Gemini)

**Problem:** Void only supports Anthropic (OAuth) and OpenRouter (API key). Swarm mode and the designer agent need direct access to OpenAI and Google Gemini APIs.

#### New Providers

**OpenAI Direct:**
- API key stored in macOS Keychain (service: `Void-openai`)
- Fallback: `OPENAI_API_KEY` env var
- Calls `api.openai.com` directly (not via OpenRouter)
- Needed for: Codex/GPT workers in swarm mode

**Google Gemini:**
- API key stored in macOS Keychain (service: `Void-gemini`)
- Fallback: `GEMINI_API_KEY` env var
- Calls `generativelanguage.googleapis.com` directly
- Needed for: Designer agent, Gemini workers in swarm mode

#### UX

```
/provider add openai     # Prompts for API key, stores in keychain
/provider add gemini     # Prompts for API key, stores in keychain
/provider status         # Shows all providers with connection status
/provider remove openai  # Removes key from keychain
```

#### Files

- `src/providers/openai.ts` **(new)** — OpenAI API client, auth, keychain integration
- `src/providers/gemini.ts` **(new)** — Gemini API client, auth, keychain integration
- `src/commands/provider/provider.ts` — Extend with `openai` and `gemini` subcommands
- `src/utils/model/providers.ts` — Add `'openai' | 'gemini'` to provider type

---

### 7. Smart Mode Triggers

**Purpose:** The main Void agent dynamically suggests deliberation, swarm, or designer based on conversation context. Always suggests, never auto-launches.

#### Trigger Heuristics

**Deliberate triggers:**
- Architecture decision questions ("should we X or Y?")
- Tradeoff discussions
- Design pattern selection
- User explicitly stuck or uncertain
- Keywords: "best approach", "tradeoffs", "which one", "pros and cons"

**Swarm triggers:**
- Multi-layer feature requests (frontend + backend + data)
- Large features with 3+ independent components
- Full-stack task descriptions ("build X with Y and Z")
- Keywords: "full feature", "from scratch", "end to end"

**Designer triggers:**
- Visual improvement requests ("make it look better", "redesign")
- Quality language ("beautiful", "polished", "modern", "10x", "premium")
- UI-focused work (editing `.tsx` with layout/styling changes)
- Design-first requests ("design a landing page", "mockup")

#### Implementation

Each mode registers as a built-in skill:

```typescript
// src/skills/bundled/deliberate.ts
{
  name: 'deliberate',
  description: 'Multi-model deliberation for hard decisions',
  whenToUse: 'Architecture decisions, tradeoff discussions, design pattern selection, or when the user is stuck choosing between approaches',
  aliases: ['debate', 'discuss']
}

// src/skills/bundled/swarm.ts
{
  name: 'swarm',
  description: 'Multi-model parallel implementation',
  whenToUse: 'Multi-layer features with clear frontend/backend/data separation, large features with 3+ independent components, or full-stack tasks',
  aliases: ['crew', 'team']
}

// src/skills/bundled/design.ts
{
  name: 'design',
  description: 'Gemini-powered frontend design specialist',
  whenToUse: 'Visual improvement requests, UI redesigns, design-first mockups, or when the user wants beautiful/polished/modern/premium interfaces',
  aliases: ['designer', 'fronty']
}
```

The main agent's system prompt includes awareness of all three modes and guidelines for when to suggest them. The suggestion is always conversational: "This looks like a good candidate for swarm mode — I'd split it into frontend/backend/wiring. Want me to set it up?"

#### Files

- `src/skills/bundled/deliberate.ts` **(new)**
- `src/skills/bundled/swarm.ts` **(new)**
- `src/skills/bundled/design.ts` **(new)**
- Main agent system prompt updated with mode awareness

---

## Architecture Notes

### All features built into Void core
No separate plugin repos. Everything ships in the void-cli binary. This keeps UX native — model picker hotkeys, Ink components for deliberation/swarm UI, direct access to the main conversation loop.

### Provider routing
Models are routed to the correct API based on model ID format:
- No prefix → Anthropic first-party
- `openai/...` → OpenAI direct (if key configured) or OpenRouter
- `google/...` → Gemini direct (if key configured) or OpenRouter
- `thudm/...`, `meta/...`, etc. → OpenRouter
- Explicit provider override in swarm config takes precedence

### Worktree isolation for swarm
Each swarm worker operates in a git worktree created under `.void/worktrees/swarm/<workstream>`. The coordinator handles creation and cleanup. Merge conflicts are resolved by the coordinator which has full context of all workstreams.

### Token budget awareness
All multi-model features track token usage and display estimated cost. Deliberation shows per-round cost. Swarm shows per-worker and total cost. Users can set budget limits in settings.
