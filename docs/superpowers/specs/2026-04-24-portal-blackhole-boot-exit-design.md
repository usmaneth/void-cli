# Portal + Black Hole — boot & exit cinema

**Status:** design · **Owner:** Usman · **Date:** 2026-04-24

## Intent

Void's boot and exit should feel like *entering* and *leaving the void*. Today boot is a static banner, exit is silent process death. The boot-moment is load-bearing for brand: it's the single most-seen frame of the app. We're replacing both ends of the session lifecycle with a paired cinematic treatment: **portal** opens on entry, **black hole** collapses on exit. Symmetric metaphor, ~3 seconds of theater once per day, gated for non-interactive contexts.

## The pair

**Entry — portal (2.2s).** Four concentric rings pulse outward from the center point, staggered 400ms apart. Each ring's color shifts along its expansion: bright white at the core → cyan mid-expansion → violet at the rim, fading to zero as it exits the viewport. Banner crystallizes through the rings during the last ~700ms — opacity 0→1 under a blur-to-sharp filter approximated by dim→normal→bright color progression in the terminal.

**Exit — black hole (2.8s).** Every glyph currently on screen is treated as a particle. Particles are sampled from the terminal buffer at animation start (banner, last model response, status line — all of it). Each particle spirals inward with 720° rotation (approximated in the terminal by cycling through ◆ ▲ ▼ · glyphs) and scale-crush, reaching the center over 2.5s. At 2.5s a singularity flash: a single bright ◆ with maximal text-shadow for one frame. Then the buffer clears. Control returns to the shell.

**Asymmetry is intentional.** Exit is 0.6s longer than entry. Saying goodbye gets the extra beat, and the singularity flash needs room to land.

## Trigger rules

| Event | Action |
|---|---|
| First session start of the calendar day | Full portal (2.2s) |
| Subsequent session starts that day | Compressed portal (0.5s — 1 ring pulse, banner fade-in) |
| `/exit` slash command | Full black hole (2.8s) |
| Ctrl-D on empty input | Full black hole (2.8s) |
| Ctrl-C (any context) | Skip cinema. Process exits immediately. |
| `SIGTERM` / `SIGHUP` | Skip cinema. |
| Launched with `--intro quick` | Always compressed variant |
| Launched with `--intro off` | Always skip |
| Non-TTY stdout (pipe, redirect, `-p` headless) | Always skip |
| Terminal width < 40 cols or height < 15 rows | Always skip |
| `VOID_NO_CINEMA=1` env | Always skip |

"First of the day" uses `mtime` of `~/.void/last-cinema-boot` — updated on full-play completion. Trivial to reason about; no state beyond one file.

## Architecture

Two new Ink components plus a lifecycle hook, added to the existing entrypoint in `src/entrypoints/cli.ts`.

```
src/components/cinema/
  PortalEntry.tsx       — the ring-expansion + banner crystallization animation
  BlackHoleExit.tsx     — the particle-collapse + singularity-flash animation
  frames.ts             — shared frame-schedule primitives (useAnimationFrame,
                          easing helpers, compress(spec, factor))
  cinemaState.ts        — first-of-day check, ~/.void/last-cinema-boot write,
                          "should we play?" resolver given flags + env + TTY
  index.ts              — exports playEntry() / playExit() imperative helpers
```

### Boundaries & responsibilities

- **PortalEntry** — pure renderer. Given a `duration` prop, plays the ring+banner animation and calls `onDone()` when finished. No knowledge of settings, env, or state. Testable in isolation by mounting with varied durations and asserting final frame.
- **BlackHoleExit** — same contract. Extra: captures the current terminal buffer via Ink's stdout capture and feeds it into the particle system on mount. Calls `onDone()` when the singularity flash completes.
- **cinemaState** — all policy logic: read env, read flags, check TTY, read mtime. One exported function: `resolveCinemaMode(): 'full' | 'compressed' | 'skip'`. Stateless, pure except the mtime read + write.
- **frames.ts** — animation-independent utilities: 60fps-target render loop using `setInterval(fn, 16)`, a `compress(keyframes, factor)` helper that scales timings, standard easing functions. Used by both components.
- **cli.ts integration** — two small edits: call `playEntry()` just before the REPL mounts if mode is `full | compressed`; wrap the exit-handler chain so `/exit` / Ctrl-D run `playExit()` before calling `process.exit()`.

### Frame model

Both animations use a 60Hz render loop (`setInterval(16ms)`). Each component holds a `frameIndex` state, increments on tick, and computes visual state as a pure function of `frameIndex / totalFrames`. This keeps state minimal and makes each frame deterministic / snapshot-testable.

Targeting 60Hz is aspirational — terminals often render slower, and Ink batches. In practice we'll see ~30-45fps. The animations are designed to degrade gracefully: each frame computes from the ratio, so dropped frames just mean chunkier motion, not broken motion.

### Compressed variant generation

Rather than maintaining two separate animations, the compressed version applies `compress(spec, 0.22)` which scales frame timings to fit within 500ms. Visually: 1 ring pulse and the banner fade (full has 4 rings). For exit: same particle motion and singularity flash, just 4x faster. Keeps the two variants consistent; only one source of truth per animation.

## The portal implementation

Ring representation: four concentric ASCII circles at radii 3, 6, 10, 14 cells (scaled to terminal dimensions). Each radius has a pre-computed set of `(x, y, char)` tuples using Bresenham's circle algorithm. Rings "expand" by cycling which radius set they render, with opacity approximated by cycling `dim → normal → bright` cyan then fading to violet for the outermost position.

Banner crystallization: render the existing banner ASCII art at the center, with color mapping `transparent → dim gray → dim cyan → normal cyan` over frames 60% through 100%. "Blur" approximated by replacing non-dense characters with `·` during the blurred phase, swapping in the sharp characters as it resolves.

## The black hole implementation

Capture: at `playExit()` invocation, read the current stdout buffer via `process.stdout.getColorDepth()`-aware scraping. Each non-whitespace character becomes a particle with position (x, y), original glyph, and a target center (terminal midpoint).

Spiral motion: for each frame `f / totalFrames = t`:
- `position = lerp(start, center, easeInCubic(t))` — accelerating collapse
- `rotation` applied by cycling glyph: `◆ → ▲ → ▼ → ·` every (1 / (t + 0.1) * 10) frames — rotation appears faster near singularity
- `color` shifts `normal → violet → cyan → white` as the particle approaches center
- Once particle is within 1 cell of center: despawn

Singularity flash: at t=0.88, render a single full-bright `◆` with maximum text-shadow at center. At t=1.0, clear the buffer. Final frame is empty terminal.

## Error handling

- **Animation crash mid-play** — both components wrap their render loop in a try/catch. Any exception calls `onDone()` immediately and logs to debug. Session proceeds. Never block on cinema.
- **Buffer capture failure on exit** — if stdout capture throws (unlikely, but e.g. on exotic terminals), exit falls back to 0.5s fade-to-black instead of particle spiral. User still gets *some* ceremony; we don't abandon the exit.
- **Slow terminal detection** — if the first 5 frames take > 500ms cumulative, abort the animation and fall through to static banner (entry) or immediate exit. "Bad terminal" shouldn't punish the user with a 10-second stutter.

## Testing

- **Unit tests** for `cinemaState.resolveCinemaMode()` covering the full matrix of flag × env × TTY × first-of-day combinations. Mock `fs` for the mtime check.
- **Snapshot tests** for each component at 5 fixed frame indices (0, 25%, 50%, 75%, 100%). These catch regressions in the animation shape without being brittle to single-pixel changes.
- **Integration smoke test** — spawn void in a pty, look for the banner frame in the output buffer within 2.5s, look for the prompt within 3s. Skipped on CI where TTY is unavailable; runs locally via `bun test:local`.
- **Manual verification checklist** in the PR description: tested on iTerm2, Terminal.app, Alacritty, Ghostty, tmux-inside-Terminal, small terminal (50x10), wide terminal (200x50), piped stdout (cinema should skip), `--intro off` (should skip), `--intro quick` (should use compressed), second launch within a day (should use compressed).

## Open questions

- **Do we want the exit animation on `/exit` only, or also when the user closes the terminal window?** Closing the window kills the process — we can trap `SIGHUP` and play the exit, but it'll race with the parent terminal's close. Leaning toward: play on `/exit` and Ctrl-D, skip on window close. User can always opt-in via a flag later.
- **Should `/exit` accept a `--quiet` flag?** For scripted sessions ending programmatically. Probably yes; cheap to add.

## Non-goals

- Configurable animation parameters (ring count, duration, colors). Ships as designed; bike-shedding not welcome.
- Audio. Tempting (terminal bell on singularity flash) but out of scope — cross-platform audio in a TUI is its own project.
- Alternate themes that swap the animation style. Portal and black hole are *the* void treatment. Later themes reskin colors, not motion.
- Mid-session re-triggering (e.g., `/portal` command to replay the entry). Cute but purposeless.

---

## v2 · Locked implementation decisions

These replace the hand-wavy prose above. Written concrete enough that the implementation plan has no remaining design calls to make.

### 1. Synthetic particles, not buffer capture

Exit does NOT read the terminal state. Instead, particles are spawned from three synthetic sources:

- **Banner perimeter** — 48 particles distributed around the banner's bounding box (12 per side), sampled glyphs from `['◆', '▲', '▼', '·']`
- **Status-line row** — 24 particles spread along the bottom status line position
- **Random interior scatter** — 32 particles at random (x, y) within the viewport, Perlin-noise seeded for repeatable test output

Total particle cap: **104**. Always bounded regardless of terminal size. Performance predictable. Skips the entire "how to read terminal state" problem.

### 2. Ring characters (portal)

Four concentric rings, radii 3 / 6 / 10 / 14 cells. Each ring is a pre-computed set of (x, y, char) tuples from Bresenham's circle. Character assignment by cell-angle:

- Cardinal points (N/E/S/W, ±5° slack): `◆`
- Mid-cardinals (NE/SE/SW/NW): `▲` (NE/SE) or `▼` (SW/NW)
- All other cells: `·`

Gives the rings structured asymmetry — reads as "diamond-y" rather than generic circle. Matches void's existing banner vocabulary.

### 3. Blur approximation (character density mapping)

Banner characters classified into three density tiers:

| Tier | Chars | Blur replacement |
|---|---|---|
| Dense | `█ ▓ ◆ ▲ ▼` | Stays — these survive blur |
| Medium | `│ ─ ┌ ┐ └ ┘ V O I D` | Replace with `·` during blur |
| Light | `· space punctuation` | Replace with space during blur |

Banner fades in via three-phase progression: all-blurred (frames 0-10) → medium-tier-sharp (frames 11-18) → dense-tier-sharp (frames 19-24) → full resolution (frames 25+).

### 4. Ring color progression

Linear interpolation between three waypoints across the ring's lifecycle (frames 0 → totalRingFrames):

- t=0.0: `#ffffff` (bright white)
- t=0.5: `#7dcfff` (cyan)
- t=1.0: `#bb9af7` with opacity 0 (violet, fading out)

Ink renders color changes via text color property. Opacity approximated by downshifting to `#3d4266` (dim variant) at t>0.85, then omitting render at t>0.95.

### 5. compress(spec, factor) helper shape

```typescript
type AnimationSpec = {
  totalFrames: number
  keyframes: Array<{ atFrame: number; state: FrameState }>
  onFrame: (index: number, total: number) => void
}

function compress(spec: AnimationSpec, factor: number): AnimationSpec
```

Returns a new spec with `totalFrames *= factor` and each keyframe's `atFrame *= factor`. Callers re-invoke `onFrame` against the scaled indices. Pure function, easy to test.

Compressed-variant factor for both animations: `0.18` (yields ~0.5s from 2.2-2.8s source). Matches the "compressed" cadence rule in the trigger table.

### 6. Glyph rotation rate (black hole)

For each particle at frame index `f / totalFrames = t`:

```
swapEvery = max(1, round(18 * (1 - t)))
```

At t=0: particle glyph swaps every 18 frames (slow). At t=0.5: every 9. At t=0.9: every 2 (rapid). At t=1.0: every 1 frame (hyperspeed).

Glyph rotation cycle: `◆ → ▲ → ▼ → · → ◆`. Index into the cycle increments by 1 each swap. Visual effect: particles "spin faster" as they approach the singularity.

### 7. Terminal size scaling

All pixel-like values computed from terminal dimensions:

- `ringRadii = baseRadii.map(r => r * (cols / 80))` — the reference design assumes 80-col terminal
- `centerCol = floor(cols / 2)`, `centerRow = floor(rows / 2)` — animations always center-anchor
- Minimum renderable: 40 cols × 15 rows (below that, cinema skips per the trigger matrix)
- Maximum useful: 200 cols. Beyond that, rings clamp at radius 25 so the animation doesn't feel lost in empty space.

### 8. Performance safeguards

- **Frame budget**: if any single `onFrame` call exceeds 40ms wall-time, abort the animation. Log to debug. Fall through to static banner (entry) or immediate exit (exit).
- **Total-runtime cap**: animation must complete within `duration * 1.3`. If it hasn't, force-complete and call `onDone()`. Prevents pathological slow terminals from hanging session start/end.
- **Render-loop interval**: `setInterval(16ms)` is the target; Ink's batched renderer will coalesce. Actual achieved framerate logged to debug on exit for tuning.

### Open questions — resolved

- **Window-close `SIGHUP` exit** — resolved: skip cinema on SIGHUP. Window close is already a mini-cinema (the terminal closing); adding our own on top is redundant.
- **`/exit --quiet` flag** — resolved: ship it. One line to add. Scripts that pipe output benefit.
