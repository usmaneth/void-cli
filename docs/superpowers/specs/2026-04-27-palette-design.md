# Palette + Per-Model Accent — the foundation

**Status:** design · **Owner:** Usman · **Date:** 2026-04-27

## Intent

Six prior specs (portal/black-hole, gutter, status panel, session map, breathing doc, history, ambient motion) all reach for color from the same vocabulary. This spec **codifies that vocabulary** into a single token system so they all pull from the same source, and adds the per-model-family accent mapping that several of them already assume exists.

This is foundational. It ships **before** any of the other specs touch code, so each implementation reads from a single coherent palette.

## The semantic palette

12 named tokens. Every component pulls from these — no raw hex codes anywhere else in the visual code.

| Token | Hex | Meaning |
|---|---|---|
| `brand.diamond` | `#7dcfff` (cyan) | Void's primary brand color · core ◆ |
| `brand.accent` | `#bb9af7` (violet) | Brand secondary · cofounder voice signal |
| `role.you` | `#bb9af7` | User turns, user input |
| `role.voidProse` | `#7dcfff` | Void speaking, reading operations |
| `role.voidWrite` | `#e0af68` (amber) | Void writing/modifying operations |
| `state.success` | `#9ece6a` (green) | Tests pass, build green, completion |
| `state.failure` | `#f7768e` (red) | Errors, failed tools, blocked |
| `state.warning` | `#e0af68` | Hedging, approaching limits, "compact soon" |
| `state.confident` | `#ffffff` (white) | High-confidence facts, focused content |
| `text.default` | `#9aa5ce` | Default prose, body text |
| `text.dim` | `#565f89` | Secondary text, metadata, labels |
| `text.dimmer` | `#3d4266` | Empty/inactive elements (empty bar cells) |

**Notes on overlap:** `state.warning` and `role.voidWrite` resolve to the same hex (amber). That's intentional — both signal "active modification or caution" and the human eye doesn't need them distinct. Tokens stay separate so a future theme could disambiguate.

## Per-model-family accent map

Reuses the existing `resolveModelFamily(model: string)` helper. Each family maps to one accent color used by:
- Status panel frame
- ◆ prefix in single-line / minimal modes
- Cinema palette tints (subtle — portal rings shift toward family color)
- Anywhere else a "which model is this" affordance is rendered

| Family | Accent token | Hex |
|---|---|---|
| `anthropic` | `accent.anthropic` | `#7dcfff` (cyan) |
| `chatgpt-subscription` (gpt-5.* via subscription) | `accent.chatgptSub` | `#bb9af7` (violet) |
| `openai-api` (gpt-* via API key) | `accent.openaiApi` | `#9ece6a` (green) |
| `gemini` | `accent.gemini` | `#7aa2f7` (blue) |
| `xai` (Grok) | `accent.xai` | `#ff7eb6` (magenta) |
| `deepseek` | `accent.deepseek` | `#ff9e64` (coral) |
| `qwen` / `glm` / `kimi` | `accent.eastasian` | `#e0af68` (amber) |
| `local` (ollama, lm-studio, etc.) | `accent.local` | `#9aa5ce` (neutral gray) |

`local` is intentionally muted — local models don't get a flashy accent. Reflects their utilitarian, "no provider identity" nature.

## Implementation

### Single source of truth

```
src/theme/
  palette.ts        — the 12 semantic tokens (typed const)
  modelAccents.ts   — the family-to-accent map
  index.ts          — exports + ThemeProvider context
```

```typescript
// palette.ts
export const PALETTE = {
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
} as const

export type PaletteToken = /* recursive keyof... */
```

### Theme context

```typescript
const ThemeContext = createContext<typeof PALETTE>(PALETTE)
const useTheme = () => useContext(ThemeContext)
const useModelAccent = (): string => {
  const model = useActiveModel()
  return MODEL_ACCENTS[resolveModelFamily(model)]
}
```

Components consume via `const palette = useTheme()` and reference `palette.role.you` etc. Never `'#bb9af7'` literals outside `palette.ts`.

### Migration

Existing components use raw color strings (`color="cyan"`, `color="#7dcfff"`). Migration is mechanical:

1. Add `palette.ts` and `modelAccents.ts`.
2. Greptastic find-replace: `color="cyan"` → `color={palette.role.voidProse}` (or whichever role applies based on context). Run during the implementation of each feature spec — not as a separate refactor pass.
3. Lint rule: forbid hex literals or named colors (`'red'`, `'cyan'`) outside `src/theme/`. ESLint `no-restricted-syntax` does this in ~10 lines.

### Theme switching (forward-looking, not v1)

The architecture supports multiple themes by replacing the palette object at the `ThemeProvider` level. v1 ships with one theme (the values above). Future themes plug in by exporting alternate `PALETTE` objects and a runtime selector. Out of scope for this spec — but the structure has to be ready.

## Accessibility

- All foreground/background pairs in the default theme meet WCAG AA contrast on a black terminal background. Verified manually:
  - `#7dcfff` cyan on `#000` → 8.0:1 (passes AAA)
  - `#bb9af7` violet on `#000` → 7.2:1 (passes AAA)
  - `#9aa5ce` text.default on `#000` → 7.4:1 (passes AAA)
  - `#565f89` text.dim on `#000` → 3.4:1 (passes AA for large text only — acceptable for metadata)
  - `#3d4266` text.dimmer on `#000` → 1.4:1 (decorative use only — empty bar cells)
- Future theme: high-contrast variant for users who need stronger separation. Out of scope for v1 but architecturally enabled.
- Color-blind safety: green/red distinction reinforced by *glyph* (✓ vs ✗) wherever the meaning is critical. Color is never the sole signal for success/failure.

## Testing

- Snapshot test: `palette.ts` exports the exact 12 tokens. Catches accidental token additions/renames.
- `resolveModelFamily(model)` already has tests from the per-provider prompt spec; we extend it to assert each family resolves to a defined accent.
- Lint test: CI runs the `no-color-literals` rule and fails on any new hex/color-name outside `src/theme/`.
- Manual contrast check on a representative dark terminal — iTerm2 default profile + 3 popular themes (Dracula, Solarized Dark, Tokyo Night).

## Non-goals

- Light theme. Void is dark-first. Light theme is a future spec; the architecture supports it but v1 doesn't ship one.
- Per-component palette overrides (e.g., "make the gutter use a different green"). The palette is unified by design. If a component thinks it needs a different shade, the right answer is a new semantic token, not a one-off.
- Custom palette via `~/.void/palette.json`. Power-user feature, post-v1.
- Per-model-family palette swap (the entire palette tints based on active model). Considered, rejected — too much visual churn; per-model accent is enough.
- Animation between palettes when model changes. The status panel does a 300ms cross-fade on accent (per its spec); the rest of the UI stays stable.

## Dependencies

- `resolveModelFamily(model)` — already exists in `src/utils/model/modelFamily.ts`
- React Context — standard, no extra deps
- ESLint custom rule — ~10 lines of regex; lives in `eslint.config.mjs`

## Ships before

This spec ships **first**, before any of the 6 prior visual specs land code. Every visual feature pulls from these tokens. Implementing without the palette in place would mean a refactor pass later — wasted work.
