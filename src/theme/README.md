# src/theme/

Visual identity foundation for Void. Every visual feature pulls from this.

## What's here

- `palette.ts` — `getPalette()` returns the active theme's semantic tokens
- `modelAccents.ts` — per-model-family accent map + `resolveModelAccent(modelId)`
- `index.ts` — public entrypoint; the only path consumers should import from

The palette tokens themselves live nested inside `Theme.palette` at `src/utils/theme.ts`. This dir is the public-facing surface.

## How to use

For role/state/brand colors:

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

For animation timing primitives (cinema, status panel pulses, ambient motion):

```tsx
import { useFrame } from '../components/cinema/frames.js'

const frameIndex = useFrame(8, 1200)  // 8 frames over 1.2 seconds
```

## What NOT to do

- Hard-coded hex colors anywhere in component code (`bun run lint:colors` will catch it)
- Hard-coded named colors like `'cyan'` or `'red'` outside this directory
- Importing from `src/theme/palette.ts` directly — go through `index.ts`
- Adding new tokens without updating the spec at `docs/superpowers/specs/2026-04-27-palette-design.md` first

## The 12 semantic tokens

| Token | Hex | When to use |
|---|---|---|
| `palette.brand.diamond` | `#7dcfff` | Void's primary brand glyph (◆) |
| `palette.brand.accent` | `#bb9af7` | Brand secondary, cofounder voice |
| `palette.role.you` | `#bb9af7` | User turns, user input |
| `palette.role.voidProse` | `#7dcfff` | Void speaking, reading operations |
| `palette.role.voidWrite` | `#e0af68` | Void writing/modifying operations |
| `palette.state.success` | `#9ece6a` | Tests pass, build green, completion |
| `palette.state.failure` | `#f7768e` | Errors, blocked, failed tools |
| `palette.state.warning` | `#e0af68` | Hedging, approaching limits |
| `palette.state.confident` | `#ffffff` | High-emphasis text, focused content |
| `palette.text.default` | `#9aa5ce` | Default prose, body text |
| `palette.text.dim` | `#565f89` | Secondary text, metadata, labels |
| `palette.text.dimmer` | `#3d4266` | Empty/inactive elements |

## The 8 model-family accents

| Family | Accent | Hex |
|---|---|---|
| `anthropic` | cyan | `#7dcfff` |
| `chatgptSubscription` | violet | `#bb9af7` |
| `openaiApi` | green | `#9ece6a` |
| `gemini` | blue | `#7aa2f7` |
| `xai` | magenta | `#ff7eb6` |
| `deepseek` | coral | `#ff9e64` |
| `eastAsian` (qwen / glm / kimi) | amber | `#e0af68` |
| `local` (ollama / lmstudio / etc.) | neutral gray | `#9aa5ce` |

`resolveModelAccent(modelId)` discriminates:
- `openai/gpt-5.4` → `openaiApi` (api billing)
- `gpt-5.5` → `chatgptSubscription` (subscription billing)
- `ollama/llama3` → `local`
- `unknown-model-xyz` → falls back to `anthropic`

## Adding a new token

1. Update the spec at `docs/superpowers/specs/2026-04-27-palette-design.md` with the new token + semantic meaning + hex
2. Add the field to the `Theme.palette` type at `src/utils/theme.ts`
3. Add the value to every theme constant in `src/utils/theme.ts` and to the loader at `src/services/themes/loader.ts:mapToVoidTheme`
4. Update `src/theme/__tests__/palette.test.ts` to assert the new token
5. Run `bunx vitest run src/theme/`; commit

## Adding a new model-family accent

1. Update `MODEL_ACCENTS` in `modelAccents.ts`
2. Add the family to the `AccentFamily` union
3. Update the switch in `resolveModelAccent`
4. Add a test case in `src/theme/__tests__/modelAccents.test.ts`

## Running the lint check

```bash
bun run lint:colors                   # full source scan
bun run lint:colors path/to/file.ts   # single-file scan
```

Exempt paths (rule does not fire):
- `src/theme/**`
- `src/utils/theme.ts`
- `src/services/themes/**`
- `src/components/design-system/color.ts`
- `src/tools/AgentTool/agentColorManager.ts` (AgentColorName enum + theme-key map — source of truth)
- `src/commands/color/color.ts` (RESET_ALIASES contains color keywords as user-input strings)
- `src/ink/colorize.ts`
- `src/ink/termio/**` (ANSI parser data, not theme decisions)
- `src/utils/swarm/backends/TmuxBackend.ts` (tmux protocol color values, not Ink colors)
- `src/utils/words.ts` (worker name word list — `coral`/`gray` are nature names, false positives)
- `src/components/design-system/RichFileHeader.tsx` (language-identity colors — TS blue, Rust orange, Python yellow — not Void theme decisions)
- `src/tools/AgentTool/built-in/**` (`color: 'orange'` is an AgentColorName enum key, not a render color)
- Test files (`**/__tests__/**`, `**/*.test.ts`, `**/*.test.tsx`)
- `scripts/**`

## Spec

Full design at `docs/superpowers/specs/2026-04-27-palette-design.md`.
