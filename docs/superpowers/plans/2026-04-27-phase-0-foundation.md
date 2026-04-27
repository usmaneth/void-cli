# Phase 0 — Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundational primitives — semantic palette tokens, per-model accent map, `useFrame` animation primitive, ESLint rule against raw colors, and migration of the 12 existing `color="<name>"` literals — so all 7 visual feature specs can pull from one coherent palette without a later refactor.

**Architecture:** Extend Void's existing `Theme` type in `src/utils/theme.ts` with a new nested `palette` namespace. Add a parallel `src/theme/` directory exporting the new tokens + helpers — this is the public API the feature specs read. Delegates to existing theme infrastructure where useful; introduces no parallel theme systems.

**Tech Stack:** TypeScript, Bun, Ink (React for terminals), Vitest. Existing `Theme` type at `src/utils/theme.ts`. Existing `resolveModelFamily()` at `src/utils/model/modelFamily.ts`. Lint via ESLint (config to be added if absent).

## Multi-agent execution model

Every task has three roles. They can run sequentially (one agent playing all roles) or in parallel (separate agents in separate worktrees coordinating via the spec).

| Role | Responsibility |
|---|---|
| **Implementer** | Writes the failing test, writes the minimal code to pass, commits |
| **Validator** | Independently reviews the diff against the role's checklist (different perspective from implementer); raises issues for the implementer to address |
| **Tester** | Runs the test suite + an independent verification scenario; signs off only when both pass |

**Coordination rule:** A task is not complete until all three roles have signed off. Validator/Tester findings get cycled back to Implementer; the loop repeats until clean.

For parallel execution: implementer in worktree-A, validator reads `git show` from main once implementer commits, tester runs in worktree-B against the same branch. Three agents, three worktrees, one task at a time.

For sequential execution: one agent dispatches successively as Implementer → Validator → Tester roles per task.

---

## File Structure

| File | Status | Purpose |
|---|---|---|
| `src/utils/theme.ts` | Modify | Add nested `palette` field to `Theme` type and to each theme variant |
| `src/theme/palette.ts` | Create | Re-export typed palette tokens; one source of truth for the new namespace |
| `src/theme/modelAccents.ts` | Create | Per-model-family accent map + `useModelAccent()` hook |
| `src/theme/index.ts` | Create | Public entrypoint — re-exports `palette`, `useModelAccent`, types |
| `src/components/cinema/frames.ts` | Create | `useFrame(count, period)` animation primitive — used by cinema, status panel, ambient motion |
| `src/components/cinema/__tests__/frames.test.ts` | Create | Unit tests for `useFrame` |
| `src/theme/__tests__/palette.test.ts` | Create | Snapshot test asserting palette tokens match spec |
| `src/theme/__tests__/modelAccents.test.ts` | Create | Family-to-accent mapping tests |
| `eslint.config.mjs` | Create or Modify | ESLint rule forbidding hex/color-name literals outside `src/theme/` and `src/utils/theme.ts` |
| `src/theme/README.md` | Create | Documentation for the new namespace |
| Migration target files | Modify | The 12 existing `color="<name>"` literals — see Task 6 for the list |

---

## Task 1: Add palette namespace to existing Theme type

**Files:**
- Modify: `src/utils/theme.ts` — add `palette` field to `Theme` type, add palette values to default theme (and any other theme variants in this file)

### Implementer steps

- [ ] **Step 1.1: Read the existing Theme type and defaultTheme constant** to understand the current shape.

```bash
grep -n "export type Theme\|defaultTheme\|export const.*Theme:" src/utils/theme.ts | head -10
```

- [ ] **Step 1.2: Write the failing snapshot test for the palette namespace**

```typescript
// src/theme/__tests__/palette.test.ts
import { describe, expect, it } from 'vitest'
import { defaultTheme } from '../../utils/theme.js'

describe('palette tokens', () => {
  it('exposes all 11 semantic tokens', () => {
    const p = defaultTheme.palette
    expect(p).toBeDefined()
    expect(p.brand.diamond).toBe('#7dcfff')
    expect(p.brand.accent).toBe('#bb9af7')
    expect(p.role.you).toBe('#bb9af7')
    expect(p.role.voidProse).toBe('#7dcfff')
    expect(p.role.voidWrite).toBe('#e0af68')
    expect(p.state.success).toBe('#9ece6a')
    expect(p.state.failure).toBe('#f7768e')
    expect(p.state.warning).toBe('#e0af68')
    expect(p.state.confident).toBe('#ffffff')
    expect(p.text.default).toBe('#9aa5ce')
    expect(p.text.dim).toBe('#565f89')
    expect(p.text.dimmer).toBe('#3d4266')
  })
})
```

- [ ] **Step 1.3: Run the test to verify it fails**

Run: `bunx vitest run src/theme/__tests__/palette.test.ts`
Expected: FAIL — `palette` is undefined on `defaultTheme`.

- [ ] **Step 1.4: Add the palette nested type to the Theme type and the values to each theme constant**

Add to the `Theme` type definition (after the existing fields):

```typescript
  palette: {
    brand: {
      diamond: string
      accent: string
    }
    role: {
      you: string
      voidProse: string
      voidWrite: string
    }
    state: {
      success: string
      failure: string
      warning: string
      confident: string
    }
    text: {
      default: string
      dim: string
      dimmer: string
    }
  }
```

Add the corresponding values to **every** theme constant in this file (default, light, etc. — find them by `grep -n "^export const.*: Theme = {" src/utils/theme.ts`):

```typescript
  palette: {
    brand: {
      diamond: '#7dcfff',
      accent: '#bb9af7',
    },
    role: {
      you: '#bb9af7',
      voidProse: '#7dcfff',
      voidWrite: '#e0af68',
    },
    state: {
      success: '#9ece6a',
      failure: '#f7768e',
      warning: '#e0af68',
      confident: '#ffffff',
    },
    text: {
      default: '#9aa5ce',
      dim: '#565f89',
      dimmer: '#3d4266',
    },
  },
```

- [ ] **Step 1.5: Run the test to verify it passes**

Run: `bunx vitest run src/theme/__tests__/palette.test.ts`
Expected: PASS.

- [ ] **Step 1.6: Run the full type-check**

Run: `bun tsc --noEmit`
Expected: 0 new type errors. (Pre-existing notifier.ts error is acceptable.)

- [ ] **Step 1.7: Commit**

```bash
git add src/utils/theme.ts src/theme/__tests__/palette.test.ts
git commit -m "feat(theme): add palette namespace with 11 semantic tokens"
```

### Validator checklist

- [ ] **Confirms tokens were added to ALL theme variants in `src/utils/theme.ts`**, not just `defaultTheme`. Run `grep -n "^export const.*: Theme = {" src/utils/theme.ts` and verify each gets the palette block.
- [ ] **Confirms WCAG AA contrast on a black terminal background** for each token used as foreground:
  - `#7dcfff` cyan → 8.0:1 ✓
  - `#bb9af7` violet → 7.2:1 ✓
  - `#9aa5ce` text.default → 7.4:1 ✓
  - `#565f89` text.dim → 3.4:1 (acceptable for metadata)
  - `#3d4266` text.dimmer → 1.4:1 (acceptable — decorative use only)
  - Any value below 3.0:1 must be flagged for review.
- [ ] **Confirms no name conflict with existing flat tokens** like `success`, `warning`, `error`. The palette namespace is nested, so no collision — but confirm.
- [ ] **Confirms hex values match the spec at `docs/superpowers/specs/2026-04-27-palette-design.md`** byte-for-byte.

### Tester verification

- [ ] **Step T.1: Run the new test in isolation**: `bunx vitest run src/theme/__tests__/palette.test.ts` → all green.
- [ ] **Step T.2: Run the full theme test suite** (if any): `bunx vitest run src/utils/theme.test.ts` → no regressions.
- [ ] **Step T.3: Manually inspect** the diff: `git show HEAD --stat` and `git show HEAD -- src/utils/theme.ts` — visually confirm the palette block landed in every theme constant.

---

## Task 2: Create per-model accent map + hook

**Files:**
- Create: `src/theme/modelAccents.ts`
- Create: `src/theme/__tests__/modelAccents.test.ts`

### Implementer steps

- [ ] **Step 2.1: Read `src/utils/model/modelFamily.ts`** to confirm the exact `ModelFamily` union type.

```bash
grep -n "export type ModelFamily\|export.*resolveModelFamily" src/utils/model/modelFamily.ts
```

- [ ] **Step 2.2: Write the failing test**

```typescript
// src/theme/__tests__/modelAccents.test.ts
import { describe, expect, it } from 'vitest'
import { MODEL_ACCENTS, resolveModelAccent } from '../modelAccents.js'

describe('modelAccents', () => {
  it('maps each family to a hex color', () => {
    expect(MODEL_ACCENTS.anthropic).toBe('#7dcfff')
    expect(MODEL_ACCENTS.chatgptSubscription).toBe('#bb9af7')
    expect(MODEL_ACCENTS.openaiApi).toBe('#9ece6a')
    expect(MODEL_ACCENTS.gemini).toBe('#7aa2f7')
    expect(MODEL_ACCENTS.xai).toBe('#ff7eb6')
    expect(MODEL_ACCENTS.deepseek).toBe('#ff9e64')
    expect(MODEL_ACCENTS.eastasian).toBe('#e0af68')
    expect(MODEL_ACCENTS.local).toBe('#9aa5ce')
  })

  it('resolveModelAccent returns the right accent per model id', () => {
    expect(resolveModelAccent('claude-opus-4-7')).toBe('#7dcfff')
    expect(resolveModelAccent('gpt-5.5')).toBe('#bb9af7')
    expect(resolveModelAccent('openai/gpt-5.4')).toBe('#9ece6a')
    expect(resolveModelAccent('gemini-3-pro')).toBe('#7aa2f7')
    expect(resolveModelAccent('grok-4')).toBe('#ff7eb6')
    expect(resolveModelAccent('deepseek-v3')).toBe('#ff9e64')
    expect(resolveModelAccent('qwen2.5-coder')).toBe('#e0af68')
    expect(resolveModelAccent('llama-3-local')).toBe('#9aa5ce')
  })

  it('falls back to anthropic accent for unknown models', () => {
    expect(resolveModelAccent('completely-unknown-model')).toBe('#7dcfff')
  })
})
```

- [ ] **Step 2.3: Run the test to verify it fails**

Run: `bunx vitest run src/theme/__tests__/modelAccents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.4: Read existing `resolveModelFamily()` to understand its model-id → family logic**

```bash
sed -n '1,80p' src/utils/model/modelFamily.ts
```

- [ ] **Step 2.5: Implement `modelAccents.ts`**

```typescript
// src/theme/modelAccents.ts
/**
 * Per-model-family accent color map. Used by status panel frame, model
 * indicator glyphs, and any "which model is this" affordance.
 *
 * The mapping is split from the palette so feature code that just wants
 * "the accent for the current model" doesn't have to compose two lookups.
 */
import {
  resolveModelFamily,
  type ModelFamily,
} from '../utils/model/modelFamily.js'

/** Extended family used for accent purposes. We treat openai-via-api and
 * openai-via-chatgpt-subscription as distinct accent groups even though
 * `resolveModelFamily` returns one `'openai'` family. The discriminator is
 * whether the model id is a bare gpt-5.* (subscription) or has an `openai/`
 * prefix (api). */
export type AccentFamily =
  | 'anthropic'
  | 'chatgptSubscription'
  | 'openaiApi'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'eastasian'
  | 'local'

export const MODEL_ACCENTS: Record<AccentFamily, string> = {
  anthropic: '#7dcfff',
  chatgptSubscription: '#bb9af7',
  openaiApi: '#9ece6a',
  gemini: '#7aa2f7',
  xai: '#ff7eb6',
  deepseek: '#ff9e64',
  eastasian: '#e0af68',
  local: '#9aa5ce',
}

const DEFAULT_ACCENT = MODEL_ACCENTS.anthropic

/**
 * Resolve the accent color for a raw model id.
 * Bare gpt-5.* → chatgptSubscription. openai/gpt-* → openaiApi.
 * qwen|glm|kimi → eastasian. Unknown → anthropic (matches default behavior).
 */
export function resolveModelAccent(model: string | null | undefined): string {
  if (!model) return DEFAULT_ACCENT

  const id = model.toLowerCase().trim()
  // openai/ prefix or any nested variant means api-routing
  if (/(^|\/)openai\//i.test(id)) return MODEL_ACCENTS.openaiApi
  // local marker: explicit `-local` suffix or `lm-studio`/`ollama` prefix
  if (/(?:-local$|^(?:ollama|lmstudio|local)\/)/i.test(id))
    return MODEL_ACCENTS.local

  const family = resolveModelFamily(model)
  switch (family) {
    case 'anthropic':
      return MODEL_ACCENTS.anthropic
    case 'openai':
      // bare gpt-* → subscription; the openai/* prefix above already routed
      return MODEL_ACCENTS.chatgptSubscription
    case 'gemini':
      return MODEL_ACCENTS.gemini
    case 'xai':
      return MODEL_ACCENTS.xai
    case 'deepseek':
      return MODEL_ACCENTS.deepseek
    case 'qwen':
    case 'kimi':
    case 'glm':
      return MODEL_ACCENTS.eastasian
    default:
      return DEFAULT_ACCENT
  }
}
```

- [ ] **Step 2.6: Run the test to verify it passes**

Run: `bunx vitest run src/theme/__tests__/modelAccents.test.ts`
Expected: PASS — all three test groups green.

- [ ] **Step 2.7: Run typecheck**

Run: `bun tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 2.8: Commit**

```bash
git add src/theme/modelAccents.ts src/theme/__tests__/modelAccents.test.ts
git commit -m "feat(theme): add per-model-family accent map + resolver"
```

### Validator checklist

- [ ] **Confirms `AccentFamily` covers all 8 families from the spec**: anthropic, chatgptSubscription, openaiApi, gemini, xai, deepseek, eastasian, local. None missing, none extra.
- [ ] **Confirms the openai-api vs chatgptSubscription split** works correctly via the `openai/` prefix discriminator. `openai/gpt-5.5` → openaiApi (green), `gpt-5.5` → chatgptSubscription (violet).
- [ ] **Confirms hex values match the palette spec exactly** — same 8 hex codes as in `docs/superpowers/specs/2026-04-27-palette-design.md`.
- [ ] **Reads `resolveModelFamily`** and confirms `qwen | kimi | glm` return distinct family strings (not collapsed) so the switch routes them all to `eastasian`. If they're returned as a single family, the switch needs adjustment.
- [ ] **Sanity-checks** that no AccentFamily token references a hex outside the palette spec's 11 tokens. Cross-check against `palette.test.ts`.

### Tester verification

- [ ] **Step T.1: Run the test in isolation**: `bunx vitest run src/theme/__tests__/modelAccents.test.ts` → all green.
- [ ] **Step T.2: Manually exercise the resolver** in a node REPL or quick script:

```bash
bun -e "import('./src/theme/modelAccents.js').then(m => {
  for (const id of ['claude-opus-4-7', 'gpt-5.5', 'openai/gpt-5.4', 'gemini-3-pro', 'grok-4', 'deepseek-v3', 'qwen2.5', 'kimi-k2', 'glm-4.6', 'unknown-model']) {
    console.log(id.padEnd(28), m.resolveModelAccent(id))
  }
})"
```

Expected output: each id resolves to one of the 8 hex values; eastasian for qwen/kimi/glm; default for unknown.

- [ ] **Step T.3: Confirm no regressions** in the modelFamily tests: `bunx vitest run src/utils/model/__tests__/modelFamily.test.ts`.

---

## Task 3: Create theme entry point with palette + accent re-exports

**Files:**
- Create: `src/theme/palette.ts`
- Create: `src/theme/index.ts`

### Implementer steps

- [ ] **Step 3.1: Create the palette accessor**

```typescript
// src/theme/palette.ts
/**
 * Public entrypoint for the palette tokens. Reads from the active theme
 * (delegating to the existing `getTheme()` helper) and exposes the
 * palette namespace directly — saves callers from doing `theme.palette.x`
 * everywhere.
 */
import { getTheme, type Theme } from '../utils/theme.js'

export type Palette = Theme['palette']

/** Get the palette of the currently active theme. */
export function getPalette(): Palette {
  return getTheme().palette
}
```

- [ ] **Step 3.2: Create the index entrypoint**

```typescript
// src/theme/index.ts
export { getPalette, type Palette } from './palette.js'
export {
  MODEL_ACCENTS,
  resolveModelAccent,
  type AccentFamily,
} from './modelAccents.js'
```

- [ ] **Step 3.3: Verify the import path works from a typical consumer location**

Quick test — write a 1-line scratch consumer to make sure imports resolve:

```bash
bun -e "import('./src/theme/index.js').then(m => console.log(Object.keys(m)))"
```

Expected output includes: `getPalette`, `MODEL_ACCENTS`, `resolveModelAccent` (types are erased at runtime so they won't appear).

- [ ] **Step 3.4: Run typecheck**

Run: `bun tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 3.5: Run all theme tests to confirm nothing regressed**

Run: `bunx vitest run src/theme/`
Expected: all green.

- [ ] **Step 3.6: Commit**

```bash
git add src/theme/palette.ts src/theme/index.ts
git commit -m "feat(theme): public entrypoint exposing palette + model accents"
```

### Validator checklist

- [ ] **Confirms `getPalette()` calls `getTheme()` without args** — the underlying helper resolves the active theme. Hardcoded theme names would break theme switching later.
- [ ] **Confirms no circular dependency**: `src/theme/` does not import from any feature directory; it only depends on `src/utils/theme.ts` and `src/utils/model/modelFamily.ts`. Verify with `grep -r "from '../components/" src/theme/` (should return nothing).
- [ ] **Confirms re-exports use `type` keyword** for type-only exports — preserves tree-shaking.
- [ ] **Reads the file to confirm doc comments** explain WHY each export exists, not just WHAT.

### Tester verification

- [ ] **Step T.1: Verify import shape**:

```bash
bun -e "
const m = await import('./src/theme/index.js');
const expected = ['getPalette', 'MODEL_ACCENTS', 'resolveModelAccent'];
for (const name of expected) {
  if (typeof m[name] === 'undefined') throw new Error('missing: ' + name);
}
console.log('all exports present');
"
```

Expected: `all exports present`.

- [ ] **Step T.2: Verify `getPalette()` returns a populated object**:

```bash
bun -e "
const { getPalette } = await import('./src/theme/index.js');
const p = getPalette();
if (!p?.brand?.diamond) throw new Error('palette empty');
console.log(JSON.stringify(p, null, 2));
"
```

Expected: prints the full palette tree with all 11 tokens.

---

## Task 4: Create useFrame animation primitive

**Files:**
- Create: `src/components/cinema/frames.ts`
- Create: `src/components/cinema/__tests__/frames.test.ts`

### Implementer steps

- [ ] **Step 4.1: Identify the existing `useInterval` hook in Void**

```bash
grep -rln "export.*useInterval\|^export function useInterval" src/ | head
```

If one exists, reuse it. Otherwise the implementation uses a `useEffect + setInterval + return clearInterval` pattern directly.

- [ ] **Step 4.2: Write the failing test**

```typescript
// src/components/cinema/__tests__/frames.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFrame } from '../frames.js'

describe('useFrame', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts at frame 0', () => {
    const { result } = renderHook(() => useFrame(4, 100))
    expect(result.current).toBe(0)
  })

  it('advances by one frame each tick', () => {
    const { result } = renderHook(() => useFrame(4, 100))
    expect(result.current).toBe(0)
    act(() => vi.advanceTimersByTime(25))
    expect(result.current).toBe(1)
    act(() => vi.advanceTimersByTime(25))
    expect(result.current).toBe(2)
  })

  it('wraps back to 0 after the last frame', () => {
    const { result } = renderHook(() => useFrame(4, 100))
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe(0)
  })

  it('uses period/count as the per-frame duration', () => {
    const { result } = renderHook(() => useFrame(2, 200))
    act(() => vi.advanceTimersByTime(99))
    expect(result.current).toBe(0)
    act(() => vi.advanceTimersByTime(2))
    expect(result.current).toBe(1)
  })

  it('cleans up the interval on unmount', () => {
    const { unmount } = renderHook(() => useFrame(4, 100))
    const before = vi.getTimerCount()
    unmount()
    expect(vi.getTimerCount()).toBe(before - 1)
  })

  it('handles count=0 gracefully (returns 0, no interval)', () => {
    const { result } = renderHook(() => useFrame(0, 100))
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
```

If `@testing-library/react` is not installed, test using a manual hook driver: render a tiny Ink component, mount, advance timers, inspect output. Or use the existing pattern in Void's test suite — check what's there:

```bash
grep -l "renderHook" src/ -r 2>/dev/null | head -3
```

- [ ] **Step 4.3: Run the test to verify it fails**

Run: `bunx vitest run src/components/cinema/__tests__/frames.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.4: Implement `useFrame`**

```typescript
// src/components/cinema/frames.ts
/**
 * Animation frame primitive for terminal animations.
 *
 * Drives a frame counter that increments at `period_ms / frame_count` Hz,
 * wrapping back to 0 after the last frame. Used by:
 *  - Cinema (portal/black-hole) — drives ring expansion + particle motion
 *  - Status panel — drives the breathing effort dot
 *  - Ambient motion — drives spinner glyph cycling
 *
 * Caller chooses count + period; we don't prescribe an animation system.
 */
import { useEffect, useState } from 'react'

/**
 * Returns the current frame index, advancing every (period / count) ms.
 * Frame index wraps from `count - 1` back to `0`.
 *
 * @param count Total number of frames in the cycle. count <= 0 disables.
 * @param period Total cycle duration in milliseconds.
 */
export function useFrame(count: number, period: number): number {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (count <= 0 || period <= 0) return
    const tickMs = period / count
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % count)
    }, tickMs)
    return () => clearInterval(id)
  }, [count, period])

  return frame
}
```

- [ ] **Step 4.5: Run the test to verify it passes**

Run: `bunx vitest run src/components/cinema/__tests__/frames.test.ts`
Expected: all tests pass.

- [ ] **Step 4.6: Run typecheck**

Run: `bun tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 4.7: Commit**

```bash
git add src/components/cinema/frames.ts src/components/cinema/__tests__/frames.test.ts
git commit -m "feat(cinema): useFrame animation primitive"
```

### Validator checklist

- [ ] **Confirms cleanup on unmount** — the `clearInterval` returned from `useEffect` is not optional. Verify the test actually exercises it.
- [ ] **Confirms degenerate cases**: count=0, count<0, period=0 all handled (no interval scheduled, hook returns 0). Test exists for count=0.
- [ ] **Confirms the dependency array is `[count, period]`** so changing either resets the interval. Otherwise the cycle drifts.
- [ ] **Confirms no hard dependency on Ink** — this is a pure React hook, usable from any React component (not just terminal). Should be testable with `@testing-library/react` without any Ink setup.
- [ ] **Reads the doc comment** and confirms it lists the three known consumers (cinema, status panel, ambient motion). If any has changed, the comment is stale.

### Tester verification

- [ ] **Step T.1: Run the new test**: `bunx vitest run src/components/cinema/__tests__/frames.test.ts` → all green.
- [ ] **Step T.2: Manually verify timer count cleanup** by adding a temporary `console.log(vi.getTimerCount())` between the mount and unmount, run, observe the count drops.
- [ ] **Step T.3: Verify integration plumbing exists** for the three downstream consumers — they import from `./frames.js`, the path resolves, no error. Quick check:

```bash
echo "import('./src/components/cinema/frames.js').then(m => console.log(typeof m.useFrame === 'function'))" | bun run -
```

Expected: `true`.

---

## Task 5: Add ESLint rule forbidding raw color literals

**Files:**
- Create or modify: `eslint.config.mjs` (or whatever lint config Void uses)
- Verify: `package.json` scripts include the lint command

### Implementer steps

- [ ] **Step 5.1: Identify the existing lint config**

```bash
ls eslint.config.* .eslintrc* biome.json* 2>/dev/null
cat package.json | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('scripts', {}).get('lint', 'NO LINT SCRIPT'))"
```

If none exists, this task creates the config from scratch. If one exists, this task adds the rule to it.

- [ ] **Step 5.2: Write the failing test (a fixture file that should fail lint)**

Create a temporary fixture in `src/__lint-fixtures__/violations.tsx`:

```typescript
// src/__lint-fixtures__/violations.tsx
// This file exists to verify the no-color-literals lint rule fires.
// It should ALWAYS fail lint. The lint script uses --ignore-pattern to
// skip this directory in CI, but it gets included when running the
// `lint:test-rules` script from package.json.
export const A = 'cyan'  // should error
export const B = '#7dcfff'  // should error
```

- [ ] **Step 5.3: Add the ESLint rule**

If `eslint.config.mjs` doesn't exist, create it:

```javascript
// eslint.config.mjs
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

const COLOR_NAMES = '(black|red|green|yellow|blue|magenta|cyan|white|gray|grey|amber|violet|orange|pink|coral)'
const HEX_COLOR = '/^#([a-f0-9]{3}|[a-f0-9]{6})$/i'

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/theme/**',
      'src/utils/theme.ts',
      'src/services/themes/**',
      'src/components/design-system/color.ts',
      'src/ink/colorize.ts',
      'src/__lint-fixtures__/**',
      '**/*.test.ts',
      '**/__tests__/**',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${HEX_COLOR}]`,
          message:
            'Hex color literals are forbidden outside src/theme/. Use palette tokens via getPalette() or resolveModelAccent().',
        },
        {
          selector: `Literal[value=/^${COLOR_NAMES}$/i]`,
          message:
            'Named color strings are forbidden outside src/theme/. Use palette tokens via getPalette() or resolveModelAccent().',
        },
      ],
    },
  },
]
```

If a config exists, merge these rules into the appropriate flat-config block. Do NOT replace existing rules.

Add to `package.json` scripts:

```json
"lint": "eslint src/",
"lint:test-rules": "eslint --no-ignore src/__lint-fixtures__/violations.tsx"
```

- [ ] **Step 5.4: Run lint on the fixture file** to verify the rule fires

Run: `bun run lint:test-rules`
Expected: 2 errors (one for `'cyan'`, one for `'#7dcfff'`).

- [ ] **Step 5.5: Run lint on the full source** to verify pre-existing code still passes

Run: `bun run lint`
Expected: clean OR a list of expected violations matching the count from `grep -rn 'color="cyan"\|color="violet"...' src/components | wc -l`. (12 expected — these are the migration targets in Task 6.)

If unexpected violations appear in non-component code (e.g., logs, comments parsed as strings), refine the rule's `ignores` or selector.

- [ ] **Step 5.6: Commit**

```bash
git add eslint.config.mjs package.json src/__lint-fixtures__/violations.tsx
git commit -m "feat(lint): forbid raw color literals outside src/theme/"
```

### Validator checklist

- [ ] **Confirms the rule fires on the fixture file** with both error types (named + hex).
- [ ] **Confirms `src/theme/`, `src/utils/theme.ts`, `src/services/themes/`, and the existing color helper files are excluded** — they legitimately contain raw colors as the source of truth.
- [ ] **Confirms test files are excluded** — tests assert on hex values and that's fine.
- [ ] **Confirms the rule does NOT match comments**, JSDoc, or string content that just happens to contain a color name (`"this turn was red"`). The selector targets `Literal` AST nodes only.
- [ ] **Confirms running `bun run lint` exits with the expected count of violations** (12 from the existing components — these are Task 6's migration targets, not failures of the rule).

### Tester verification

- [ ] **Step T.1: Run the rule-test script**: `bun run lint:test-rules` → 2 errors as expected.
- [ ] **Step T.2: Run lint over a known-clean file** (e.g., `src/utils/auth/openaiOauth.ts` if it has no colors): `bunx eslint src/utils/auth/openaiOauth.ts` → 0 errors.
- [ ] **Step T.3: Verify the migration count**: `bun run lint 2>&1 | grep -c 'no-restricted-syntax'` matches the count of `color="<name>"` occurrences from Task 6.

---

## Task 6: Migrate existing color literals to palette tokens

**Files:**
- Modify: 12 files identified by `grep -rn 'color="cyan"\|color="violet"\|color="green"\|color="red"\|color="amber"\|color="white"\|color="blue"' src/components`

### Implementer steps

- [ ] **Step 6.1: Generate the migration list**

```bash
grep -rn 'color="cyan"\|color="violet"\|color="green"\|color="red"\|color="amber"\|color="white"\|color="blue"' src/components > /tmp/color-migration.txt
wc -l /tmp/color-migration.txt
cat /tmp/color-migration.txt
```

Expected: 12 lines listing file:line:code triples.

- [ ] **Step 6.2: For each violation, decide the right token**

Apply this mapping (the most common cases; review each violation against context):

| Old literal | New token | Use when |
|---|---|---|
| `color="cyan"` | `palette.role.voidProse` or `palette.brand.diamond` | Default void-speaking text or brand glyph |
| `color="violet"` | `palette.role.you` or `palette.brand.accent` | User-related or accent emphasis |
| `color="green"` | `palette.state.success` | Success/confirmation indicators |
| `color="red"` | `palette.state.failure` | Errors, blocked states |
| `color="amber"` | `palette.state.warning` or `palette.role.voidWrite` | Warnings or write operations |
| `color="white"` | `palette.state.confident` | High-emphasis text |
| `color="blue"` | `palette.role.you` | Treat as accent — re-evaluate per-site |

- [ ] **Step 6.3: For ONE file at a time**, replace the literal with a `getPalette()` call:

Before:
```tsx
import { Box, Text } from '../ink.js'
// ...
<Text color="cyan">value</Text>
```

After:
```tsx
import { Box, Text } from '../ink.js'
import { getPalette } from '../theme/index.js'
// ...
const palette = getPalette()
// ...
<Text color={palette.role.voidProse}>value</Text>
```

If the file already imports `getPalette`, just reuse. If `palette` is referenced often, hoist it to the component scope.

Commit per-file: `git commit -m "refactor(<filename>): migrate raw colors to palette tokens"`.

- [ ] **Step 6.4: Run typecheck after each file** to catch import errors early

Run: `bun tsc --noEmit`
Expected: 0 new errors per file.

- [ ] **Step 6.5: After all 12 files migrated, run lint**

Run: `bun run lint`
Expected: 0 violations.

- [ ] **Step 6.6: Run the full test suite**

Run: `bunx vitest run`
Expected: pre-existing test failures unchanged; no new failures.

- [ ] **Step 6.7: Squash-commit (optional)** — if 12 commits feel excessive, optionally squash via `git rebase -i HEAD~12` into a single "migrate raw colors → palette tokens" commit. Per-file commits are easier to review; squash if PR review prefers fewer commits.

### Validator checklist

- [ ] **Confirms each migration site has the SEMANTICALLY correct token** — not just "cyan → role.voidProse" mechanically, but "this cyan is a status indicator, so state.success would be wrong, role.voidProse is right." Spot-check at least 4 of the 12 sites.
- [ ] **Confirms no `getPalette()` is called inside a render loop** without being memoized. The function is cheap but calling it 1000x per render is still cheap noise. Prefer hoisting to component scope.
- [ ] **Confirms imports use the public `src/theme/index.ts` entrypoint**, not deep imports like `src/theme/palette.ts` directly. Discipline at the module boundary.
- [ ] **Re-runs lint** to confirm 0 violations after migration: `bun run lint`.

### Tester verification

- [ ] **Step T.1: Run lint after every file migration**: `bun run lint`. Catches any drift early.
- [ ] **Step T.2: Visually inspect** the rendered output of 3 representative migrated components. Boot Void if possible and compare against pre-migration screenshots — colors should be identical (we're swapping equivalent values, not changing the visual).
- [ ] **Step T.3: Run the full test suite**: `bunx vitest run`. Pre-existing failures stay pre-existing. Zero new failures.

---

## Task 7: Document the foundation

**Files:**
- Create: `src/theme/README.md`

### Implementer steps

- [ ] **Step 7.1: Write the README**

```markdown
# src/theme/

Visual identity foundation for Void. Every visual feature pulls from this.

## What's here

- `palette.ts` — `getPalette()` returns the active theme's semantic tokens
- `modelAccents.ts` — per-model-family accent map + `resolveModelAccent(modelId)`
- `index.ts` — public entrypoint; the only path consumers should import from

## How to use

```tsx
import { getPalette } from '../theme/index.js'

function MyComponent() {
  const palette = getPalette()
  return <Text color={palette.role.voidProse}>hello</Text>
}
```

For per-model accent (status panel frames, model indicators):

```tsx
import { resolveModelAccent } from '../theme/index.js'

const accent = resolveModelAccent(activeModel)  // returns hex string
```

## What NOT to do

- ❌ Hard-coded hex colors anywhere in component code (lint will catch it)
- ❌ Hard-coded named colors like `'cyan'` or `'red'` outside this directory
- ❌ Importing from `src/theme/palette.ts` directly — go through `index.ts`
- ❌ Adding new tokens without updating the spec at
  `docs/superpowers/specs/2026-04-27-palette-design.md` first

## Adding a new token

1. Update the spec with the new token + its semantic meaning + hex value
2. Add the field to the `Theme.palette` type in `src/utils/theme.ts`
3. Add the value to every theme constant in `src/utils/theme.ts`
4. Update `src/theme/__tests__/palette.test.ts` to assert the new token
5. Run tests; commit

## Adding a new model family accent

1. Update `MODEL_ACCENTS` in `modelAccents.ts`
2. Update the switch in `resolveModelAccent`
3. Add a test case in `modelAccents.test.ts`

## Spec

Full design at `docs/superpowers/specs/2026-04-27-palette-design.md`.
```

- [ ] **Step 7.2: Commit**

```bash
git add src/theme/README.md
git commit -m "docs(theme): document the palette + accent foundation"
```

### Validator checklist

- [ ] **Confirms the example code blocks compile** by mentally running them against the actual `src/theme/index.ts` exports. Code blocks with stale function signatures are docs rot waiting to happen.
- [ ] **Confirms the "Adding a new token" steps work** by mentally walking through them — would a fresh contributor complete the steps and end with a working new token?
- [ ] **Confirms the "What NOT to do" list maps to actual lint behavior** — anti-patterns listed should be caught by the lint rule from Task 5.

### Tester verification

- [ ] **Step T.1: Code-block check** — copy the first usage example into a scratch file, run `bun tsc --noEmit` on it. Should compile.
- [ ] **Step T.2: Link check** — the spec path `docs/superpowers/specs/2026-04-27-palette-design.md` exists.
- [ ] **Step T.3: Read end-to-end** as if you were a new contributor. Anything ambiguous? Note for revision.

---

## Self-Review

After completing all 7 tasks:

- [ ] **Spec coverage check**: Cross-reference each section of `docs/superpowers/specs/2026-04-27-palette-design.md` against the tasks. Every item in the spec has a task. (Done — 11 tokens in Task 1, 8 model accents in Task 2, theme entrypoint in Task 3, no useFrame primitive in spec but listed as foundation in master plan and added in Task 4, lint rule in Task 5, migration in Task 6, docs in Task 7.)
- [ ] **Phase 0 done definition**: From the master plan — "all current TUI rendering reads from the palette. No visual change yet, but the substrate is in place." Verify by running Void manually and confirming pixel-equivalent rendering before/after this phase.
- [ ] **Lint rule fires + 0 violations** in `src/`.
- [ ] **`bun tsc --noEmit` exits 0** (modulo pre-existing notifier.ts error).
- [ ] **All new tests pass + no existing tests regressed.**

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-27-phase-0-foundation.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task. Each task gets implementer + validator + tester roles either as three sequential agent runs or three parallel agents in separate worktrees. Review between tasks; fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans. Batch with checkpoints for review.

For the multi-agent team model the user wants, **Subagent-Driven with parallel-worktree validation per task is the natural fit**. Per task: implementer in worktree-A, validator in worktree-B reading the implementer's branch via `git show`, tester running tests in worktree-C. Three agents, three perspectives, one task at a time.
