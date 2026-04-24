# Status Line — hero panel with per-model accent

**Status:** design · **Owner:** Usman · **Date:** 2026-04-24

## Intent

The status area is Void's hardest-working pixel real estate. Your eye lands here ten thousand times per session. Today it's a flat single-line ruler trying to cram model + context + tokens + cost + effort + permissions + cwd into one row. The line reads as busy and carries no provider identity.

We replace it with a **5-row accent-framed panel**. Model name rendered hero-letterspaced on top. Frame color = active model family. Context bar gradient signals health. Subscription-aware cost rendering. Pulsing effort dot for ambient liveness.

## The panel

```
╭─ G P T · 5 · 5  ◆ ChatGPT Plus/Pro ─────────────────── ● high effort ─╮
│                                                                      │
│   ▰▰▱▱▱▱▱▱▱▱ context 12%   ↑ 24.9k   ↓ 23   ·   0m   ·   sub        │
│                                                                      │
╰─ ⏵⏵ bypass perms    ~/void-cli   · zetachain ·    session 18m  ─╯
```

**Row 1 (top):** model (hero-spaced) · tier · spacer · effort indicator · frame close
**Row 2:** blank breather (inside the box — intentional whitespace)
**Row 3:** context bar · context % · tokens up · tokens down · session duration · cost
**Row 4:** blank breather
**Row 5 (bottom):** permissions mode · cwd · team · session duration

## Locked visual grammar

### Frame color = model family

The panel's frame (top/bottom/sides) takes its color from `resolveModelFamily(activeModel)`. This helper already exists in `src/utils/model/modelFamily.ts` from the per-provider prompt work.

| Family | Frame color | Hex |
|---|---|---|
| anthropic | cyan | `#7dcfff` |
| chatgpt subscription (gpt-5.*) | violet | `#bb9af7` |
| openai (api) | green | `#9ece6a` |
| gemini | blue | `#7aa2f7` |
| xai | magenta | `#ff7eb6` |
| deepseek | coral | `#ff9e64` |
| qwen / glm / kimi | amber | `#e0af68` |

Frame color is **constant per-session** unless the user switches model mid-session. On mid-session switch, frame cross-fades over 300ms to the new family color.

### Hero letterspacing

Model name uppercased and period-separated: `G P T · 5 · 5`, `O P U S · 4 · 7`, `G E M I N I · 3 · P R O`. Generated via a new helper:

```typescript
heroSpaceModelName(rawId: string): string
// "gpt-5.5" → "G P T · 5 · 5"
// "claude-opus-4-7" → "O P U S · 4 · 7"
// "gemini-3-pro" → "G E M I N I · 3 · P R O"
// "kimi-k2" → "K I M I · K · 2"
```

Stripping rules: lowercase the input, strip version suffixes like `-20260101`, split on `-.` boundaries, take meaningful tokens (skip provider prefixes like `claude-`, `gpt-` if they'd make the name redundant), uppercase each char, join with space-dot-space.

**Fallback:** below 90 cols terminal width, drop hero-spacing and render bare model id.

### Context bar

- Width: 10 cells at default size, scales with terminal width
- Character: `▰` filled, `▱` empty (unicode half-block style, finer than `█`/`░`)
- Color gradient:
  - 0-40%: cyan `#7dcfff`
  - 40-70%: amber `#e0af68`
  - 70-90%: red `#f7768e`
  - 90-100%: red, flashing (500ms toggle)
- Threshold labels on the right shift meaning:
  - Below 85%: shows `context N%`
  - 85-95%: shows `compact soon` in amber
  - Above 95%: shows `compact now` in red

### Effort dot

| State | Color | Pulse rate |
|---|---|---|
| Idle, normal context | green `#9ece6a` | 2s (subtle breathing) |
| Stream active (model responding) | green | 400ms (tempo quickens) |
| Context 85-95% | amber | 2s |
| Context >95% | red | 400ms (urgent) |

Dot character: `●` always. Pulse = alpha/intensity cycling, not character swap.

### Subscription-aware cost

- **API-keyed providers** (Anthropic direct, OpenAI direct, Gemini direct, etc.): real dollars, `$0.042`.
- **Subscription providers** (ChatGPT sub): label `sub`, no bogus dollar amount. Not "$0.00" — the placeholder is the word `sub`.
- **Mixed-provider sessions** (rare, via swarm or multi-model): `sub · $0.04 api` — both figures shown, colon-separated tags. Preserves truthfulness.

## Narrow-terminal fallback

| Terminal width | Rendering |
|---|---|
| ≥ 90 cols | Full 5-row panel, hero letterspacing, full labels |
| 60 - 89 cols | 3-row panel (drop breather rows), bare model id (no hero-spacing), shortened labels (`perms` → `⏵⏵`, `session 18m` → `18m`) |
| < 60 cols | No panel frame. Revert to single-line rail with colored `◆` prefix + minimal stats |

All three fallbacks share the **same color grammar** — just less chrome.

## Architecture

```
src/components/statusPanel/
  StatusPanel.tsx           — the renderer. pure function of (model, usage,
                              mode, cwd, terminal-size, stream-active?).
  heroSpaceModelName.ts     — string transformer with tests
  contextBar.tsx            — the filled/empty bar renderer + color gradient
  effortDot.tsx             — the pulsing dot (uses useInterval for pulse)
  panelLayout.ts            — size-resolver: picks 5-row / 3-row / 1-row
                              mode based on terminal width + setting override
  index.ts
```

### How it replaces the existing status

Current status is rendered in `src/components/StatusLine.tsx` (and related). The new `StatusPanel` fully replaces it. `StatusLine.tsx` becomes a thin shim that reads current terminal size + settings and delegates to `StatusPanel` in one of its three modes. Existing hooks (`useAppState`, cost tracking) all stay unchanged — `StatusPanel` just reads them.

## Integration points

- `resolveModelFamily(model)` — already exists, used for frame color
- `getActiveModel()` — already exists
- `getUsage()` — already exists, provides { contextTokens, inputTokens, outputTokens, cost }
- `getCurrentEffortLevel()` — already exists
- `getPermissionsMode()` — already exists (returns `normal | bypass | plan`)
- `getCwd()`, `getTeamName()`, `getSessionDuration()` — all already exist
- NEW: `isSubscriptionProvider(provider)` — trivial lookup table returning boolean
- NEW: Stream-active state. Ink hook `useIsStreaming()` — true while a model response is streaming. Drives effort dot pulse rate.

## Performance

- StatusPanel re-renders only when: (a) model changes, (b) usage delta exceeds 100 tokens, (c) context % crosses a threshold boundary, (d) effort level changes, (e) terminal resizes (debounced 100ms).
- Pulse animation: `useInterval(16ms)` drives a frame counter, alpha computed from `sin(frame / 30)`. Ink renders color with the new alpha when the frame changes.
- Resize cross-fade: 300ms color transition between old and new frame color. Interpolated via HSL. Throttled to max 3 mid-session model swaps per minute to prevent pulse-cross-fade stacking.

## Testing

- **heroSpaceModelName** gets a full unit-test table: known-good transforms for each model family, edge cases (numbers in the middle, version suffixes, unknown providers).
- **panelLayout** size-resolver: unit tests for each breakpoint boundary.
- **StatusPanel** snapshot tests at 5 fixed states: idle chatgpt 12%, active claude 58%, critical any-model 91%, narrow terminal fallback, minimal terminal fallback.
- **Context gradient color** test: parameterized test sweeping 0% → 100% in 10% increments, asserting color matches spec at each step.
- **Manual checklist** in PR: iTerm2 · Terminal.app · Alacritty · Ghostty · tmux · 50-col · 80-col · 200-col · model swap mid-session · context crossing 90% during stream.

## Non-goals

- User-configurable panel content. The fields and order are fixed. If a user wants something different they can hide the panel (`/status off` → falls back to minimal rail).
- Multi-line model IDs (e.g. `openrouter/anthropic/claude-sonnet-4-6` as-displayed). Always resolve to the family's canonical display name: `C L A U D E · S O N N E T · 4 · 6`. OpenRouter and other gateways stay transparent at the status level.
- Live cost breakdowns by tool/turn. Too noisy for the status area; better suited to a `/cost` command (separate feature).
- Frame-color cross-fade longer than 300ms. Want it snappy, not theatrical.
