# Ambient Motion — spinner vocabulary + idle pulse + phrase library

**Status:** design · **Owner:** Usman · **Date:** 2026-04-27

## Intent

Three coordinated polish details that make Void feel alive without demanding attention. Each is small. Together they give the harness a motion grammar — your peripheral vision learns to read the state of the system from movement alone, without parsing words. After a week of use you'd recognize "subagent spawned" from the diamond pulse before reading the label.

## The three components

### 1. Per-category spinner vocabulary

Eight operation categories, eight distinct motion patterns. The visible spinner during any long-running operation tells you *what kind* of operation is running.

| Category | Motion | Frames | Period |
|---|---|---|---|
| Bash command | Filling progress bar | `▰▱▱▱▱▱` → `▰▰▱▱▱▱` → … → `▰▰▰▰▰▰` (6 frames) | 1.2s |
| Web fetch | Rotating quarter-circle | `◐ ◓ ◑ ◒` (4 frames) | 1.6s |
| File edit | Vertical bar shimmer | `▌ ▎ ▍` (3 frames) | 0.8s |
| Model thinking | Density wave | `░ ▒ ▓ █` (4 frames) | 1.4s |
| Subagent spawned | Diamond pulse | `◆` size/opacity wave | 2.0s |
| Compaction running | Collapsing arrows | `▶◀` and `▷◁` alternating | 1.0s |
| MCP server call | Filling circle | `◯ ◔ ◑ ◕ ●` (5 frames) | 1.5s |
| Remote agent in flight | Arrow march | `▷ ▶ ⏵ ⏵⏵` (4 frames) | 1.0s |

Each spinner takes its color from the operation's role:
- Bash, MCP, remote, web → cyan (read-ish operations)
- File edit, compaction → amber (write-ish)
- Subagent, model thinking → violet (cognitive)

### 2. Idle ambient diamond

Single `◆` glyph in the bottom-right corner of the viewport. Always present. Pulses at one of two rates:

- **Idle (no model activity):** 2.0s breath cycle. Opacity 0.3 → 1.0 → 0.3. Calm.
- **Stream active (model responding):** 0.5s breath cycle. Faster. Implicit "I'm thinking."

If void crashes or hangs, the breathing stops. **Implicit health signal** — you'd notice the stillness before any error appeared.

Color: violet at all times. Doesn't track per-model accent (that's the status panel's job; this stays consistent so you have one always-stable element).

### 3. Loading phrase library

Replaces the current single phrase ("Fracturing…") with a vocabulary of ~50 phrases across 5 operation categories.

```typescript
type PhraseCategory = 'generic' | 'bash' | 'fileEdit' | 'subagent' | 'compaction'

const PHRASES: Record<PhraseCategory, string[]> = {
  generic: [
    'fracturing reality…',
    'channeling the void…',
    'folding context…',
    'the cursor ponders…',
    'feeling the weight of the void…',
    'consulting the silence…',
    'reading between the bytes…',
    'the void considers…',
    'unfolding…',
    'aligning the diamond…',
  ],
  bash: [
    'consulting the shell oracle…',
    'summoning subprocess…',
    'piping the impossible…',
    'feeding bash a question…',
    'asking the kernel politely…',
  ],
  fileEdit: [
    'bending bytes…',
    're-stitching the file…',
    'careful surgery…',
    'rewriting the line…',
    'placing the comma…',
  ],
  subagent: [
    'spawning a fragment…',
    'the void multiplies…',
    'lighting another candle…',
    'sending a worker…',
    'splitting attention…',
  ],
  compaction: [
    'condensing the past…',
    'folding history into a single sigh…',
    'compressing the memory of memory…',
    'shedding load…',
    'remembering less, better…',
  ],
}

const EASTER_EGGS = [
  'the void remembers',
  'everything here is yours',
  '◆',
  'ready when you are',
  'the cursor ends, the void begins',
]
```

**Rotation rules:**
- Phrase changes every 2 seconds while loading.
- Selection: random from the active category, with a "no-repeat-within-last-5-picks" buffer.
- Easter-egg phrases: 1 in 50 odds, drawn from `EASTER_EGGS` instead of the category list.
- Category resolution: the current operation determines category; falls back to `generic` if no specific category applies.

## Architecture

```
src/components/ambientMotion/
  CategorySpinner.tsx      — picks the right motion based on op category
  IdleDiamond.tsx          — bottom-right ◆ pulse, 2s/0.5s based on stream state
  LoadingPhrase.tsx        — rotating phrase from the library
  motionLibrary.ts         — the 8 spinner frame definitions
  phraseLibrary.ts         — the 50+ phrases + easter eggs
  index.ts
```

### How they integrate

- `CategorySpinner` replaces existing scattered spinner components. Tools dispatch with a `category` prop; spinner picks the motion. New tools default to `generic` (density wave).
- `IdleDiamond` mounts once at the root layout. Subscribes to a single global "is-stream-active" hook (already exists). Pulses regardless of what else is on screen.
- `LoadingPhrase` replaces the existing `Spinner` text. Auto-categorizes from current operation context (last tool fired, or active model state).

### Frame model

All three use the same `useInterval(period_ms / frame_count)` pattern with state-incremented frame index. `period_ms` is per-component; `frame_count` derives from the motion definition.

```typescript
function useFrame(frameCount: number, periodMs: number): number {
  const [frame, setFrame] = useState(0)
  useInterval(() => {
    setFrame((f) => (f + 1) % frameCount)
  }, periodMs / frameCount)
  return frame
}
```

Single primitive. Powers all 3 components.

## Performance

- 3 useInterval timers running at any moment. ~5ms overhead total.
- Phrase rotation: 2s, single string swap. Negligible.
- IdleDiamond: 0.5s or 2s alpha cycle, single character render. Negligible.
- Spinner motion: per-operation. Only renders when an operation is active.

## Configuration

| Setting | Type | Default |
|---|---|---|
| `ambientMotion` | `'on' \| 'off'` | `'on'` |
| `idleDiamond` | `'on' \| 'off'` | `'on'` |
| `loadingPhrases` | `'standard' \| 'minimal'` | `'standard'` |

`'minimal'` for `loadingPhrases` reverts to a single static "loading…" — for users who find the rotating phrases distracting. `'off'` for `ambientMotion` disables all three components (replaces with a static `…` indicator).

## Testing

- Snapshot tests for each spinner at frames 0, mid, and final. Locks the motion shape.
- Phrase rotation: unit test the no-repeat-within-5 buffer logic + easter-egg odds (statistical test over 5000 draws asserting ~2% rate).
- IdleDiamond pulse rate: integration test verifying the pulse period changes when stream-active state toggles.
- Manual: open void, run a bash command, watch the spinner; spawn a subagent, watch the diamond pulse; let the session idle, watch the corner diamond breathe.

## Non-goals

- Per-model spinner colors. Spinners color by *operation category*, not active model. Per-model accent is the status panel's job; keeping these separate avoids visual confusion.
- Frame-by-frame easing curves. Steps-based motion is fine for terminals — easing in a TUI is overkill and looks weird.
- Sound. Mentioned in earlier brainstorms; out of scope for the visual bundle. Cross-platform terminal audio is its own project.
- User-defined spinners or phrases. Maybe a future feature flag, but the curated library is what defines void's voice — letting users override defeats the point of having a brand voice.
- Localization of phrase library. English-only at v1. i18n would require careful re-translation of the dry-witty tone, separate spec when Void supports localized output.
