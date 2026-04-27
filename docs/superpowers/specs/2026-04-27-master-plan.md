# Master Plan — visual identity rollup

**Status:** plan · **Owner:** Usman · **Date:** 2026-04-27

## Scope

Seven feature specs from the visual brainstorm session, plus their shared infrastructure. Order, sequencing, parallelization, risks, and what to cut if scope tightens.

## The seven specs

1. **Palette + per-model accent** — `2026-04-27-palette-design.md` · the foundation
2. **Portal + black hole** — `2026-04-24-portal-blackhole-boot-exit-design.md` · boot/exit cinema
3. **Living gutter** — `2026-04-24-living-gutter-design.md` · in-session left rail
4. **Status panel** — `2026-04-24-status-line-design.md` · 5-row hero panel
5. **Session map** — `2026-04-24-session-map-design.md` · 3-view session geography
6. **Breathing document** — `2026-04-27-breathing-document-design.md` · inline confidence
7. **History views** — `2026-04-27-history-views-design.md` · 3-view past sessions
8. **Ambient motion** — `2026-04-27-ambient-motion-design.md` · spinners + idle + phrases

## Shared infrastructure

Three primitives needed by multiple features. Build first.

| Primitive | Location | Used by |
|---|---|---|
| Theme context + palette tokens | `src/theme/` | All visual features |
| `useFrame(count, period)` animation primitive | `src/components/cinema/frames.ts` | Portal/black hole, ambient motion (spinners + idle diamond), status panel (effort dot pulse) |
| `useModelAccent()` hook | `src/theme/modelAccents.ts` | Status panel, cinema, gutter, ambient motion |

`useFrame` is ~20 lines. Theme is ~50. ModelAccent is a lookup. Total foundation: half a day of work.

Three feature-specific stores are also new infrastructure but only one feature uses each:

| Store | Spec | Effort |
|---|---|---|
| `ActivityLog` | Session map | 1 day |
| `ClassifierService` (regex layer) | Breathing document | 1 day |
| `SessionIndex` | History | 1 day |

## Phasing

### Phase 0 — foundation (~1 day)

Ships before any feature touches code.

- `src/theme/palette.ts` + `modelAccents.ts` + `index.ts`
- `useFrame` primitive in `src/components/cinema/frames.ts`
- ESLint rule: forbid hex/color-name literals outside `src/theme/`
- One-pass migration of existing components from raw colors to palette tokens (mechanical find-replace, ~half a day)

**Done state:** all current TUI rendering reads from the palette. No visual change yet, but the substrate is in place.

### Phase 1 — identity layer (~2 days)

The most-seen pixels. Ships changes the user sees on every single keystroke.

- **Status panel** (full): replaces flat status line. 5-row panel with hero letterspacing, per-model accent frame, context gradient, breathing effort dot. Auto-fallback to 3-row at <90 cols, single rail at <60 cols.
- **Ambient motion** (idle diamond + 8 spinner vocabulary + phrase library): the "void feels alive" bundle. Touches every long-running operation.

**Done state:** every Void session looks distinctly Void from the moment the prompt appears. Without any of the cinema yet.

### Phase 2 — cinema layer (~2 days)

The dramatic moments. First-frame and last-frame of every session.

- **Portal entry** (full + 0.5s compressed variants): 4 concentric rings, banner crystallization, first-of-day vs subsequent-boot policy via `~/.void/last-cinema-boot` mtime.
- **Black hole exit** (full + 0.5s compressed): 104 synthetic particles spiraling in, singularity flash, screen-clear. Triggered on `/exit` and Ctrl-D. Skipped on Ctrl-C, SIGHUP, non-TTY.

**Done state:** entering and leaving Void feels cinematic. The day-rate gating (full once per day, compressed thereafter) is in place so it never gets old.

### Phase 3 — inline narrative (~3 days)

The two features that touch the transcript-renderer mid-session. Land together because both modify how messages render and conflicts/double-renders need to be designed away in one pass.

- **Living gutter** (3 density levels): violet/cyan/amber/green/red rail, heartbeat glyphs, framed columns at level 1, density toggle via `/density` or Ctrl+G.
- **Breathing document** (inline confidence): regex classifier (Layer 1 always on), color spans on hedge/blocked/confident/code-ref, paragraph rail color summarizes. LLM fuzzy classifier (Layer 2) flag-gated off.

**Done state:** every model response renders with role-coded gutter + confidence-tinted spans. Dual narrative — what role is talking + how confident they are.

### Phase 4 — map + history (~3 days)

The "look at your work" features. Lower-frequency than phases 1-3 but high-value when used.

- **Session map** (horizon strip ambient + `/map` dashboard with territory/ley/timeline views, cross-linked highlighting via shared `ActivityLog`).
- **History** (`/history` rewrite with list/clustered/timeline views over `SessionIndex`).

**Done state:** void users have a real picture of what they did this session and what they've been doing for the past month.

## Total effort

Single dev, sequential: ~9-10 days of concentrated work.

With parallelization possible:
- Phase 0 must ship first.
- Phase 1's two pieces (status panel, ambient motion) can run concurrently — different files.
- Phase 2's two pieces (portal, black hole) can run concurrently — same `cinema/` directory but distinct components.
- Phase 3's two pieces (gutter, breathing doc) **must serialize** — both touch transcript rendering.
- Phase 4's two pieces (map, history) can run concurrently — different command paths.

With 2 devs in parallel: ~6 working days.
With 3 devs: ~5 (Phase 3 is the constraint that doesn't shrink past 3 days).

## Critical path

```
Phase 0 (palette, useFrame, modelAccents)
   │
   ├─→ Phase 1.a (status panel)         ─┐
   └─→ Phase 1.b (ambient motion)       ─┤
                                         │
   ┌────────────── Phase 1 done ─────────┘
   │
   ├─→ Phase 2.a (portal entry)         ─┐
   └─→ Phase 2.b (black hole exit)      ─┤
                                         │
   ┌────────────── Phase 2 done ─────────┘
   │
   └─→ Phase 3 (gutter → breathing)
        │
        └─→ Phase 4.a (session map)     ─┐
            Phase 4.b (history)         ─┤
                                         │
                                         ▼
                                       SHIP
```

## Risk callouts

- **Inline classifier accuracy** (Phase 3) — the regex patterns might over- or under-classify. Plan: tune against 50 fixture paragraphs from real Void sessions before ship; the spec already has a test plan around this. Worst case, ship with the classifier off by default and let users opt-in.
- **Cinema stutter on slow terminals** (Phase 2) — already mitigated in spec via 40ms frame budget + auto-abort. Real risk is that the abort-fallback feels janky. Plan: test on slow-terminal targets (raspberry pi over SSH, Windows ConHost legacy) before declaring done.
- **ActivityLog scope creep** (Phase 4) — the log is tempted to grow. Cap is hard-coded at 5000 events; resist requests to make it configurable.
- **Density toggle interaction with breathing doc** (Phase 3) — gutter level 3 (minimal) and breathing doc inline-coloring may visually conflict (both color the rail). Spec resolution: minimal gutter dominates the rail color; breathing doc keeps inline span coloring. Test before ship.

## What gets cut if scope tightens

In priority order (last item cut first):

1. **LLM fuzzy classifier in breathing doc** (Layer 2) — it's already feature-flagged off; cutting means "ship without it."
2. **Easter-egg phrases** (1-in-50 in ambient motion) — cute, not load-bearing.
3. **Ley network full-screen view** in session map — keep it as part of `/map` dashboard, drop the `l` keybind expansion.
4. **Compressed cinema variants** — fall back to `--intro off` for repeat boots if the day-rate logic is more work than expected.
5. **History timeline view** — list + clustered are enough; timeline can ship in a follow-up.
6. **Cinema entirely** — defer Phase 2 if needed; Phases 0/1/3/4 still produce a coherent, distinctive Void.

## Settings surface

By the end, Void exposes these new settings (all opt-out flags default to "on"):

```jsonc
{
  "ambientMotion": "on",
  "idleDiamond": "on",
  "loadingPhrases": "standard",
  "intro": "full",
  "density": "full",
  "confidenceColoring": "on",
  "fuzzyConfidence": "off",
  "historyDefaultView": "list"
}
```

Plus the `--intro {full,quick,off}` CLI flag and `VOID_NO_CINEMA=1` env opt-out for cinema.

## Done definition

The work is done when:

1. All 7 feature specs have shipping implementations matching their locked design decisions.
2. A new user opening Void on first run sees the portal animation, lands on the new status panel, and starts in a session whose every response renders through the gutter + breathing document.
3. `/map`, `/history`, `/density`, `/intro {off,quick,full}`, Ctrl+G all work.
4. All 7 specs' test plans pass.
5. Manual verification across the 7-terminal matrix (iTerm2, Terminal.app, Alacritty, Ghostty, tmux-inside-Terminal, small terminal 50×10, wide terminal 200×50).
6. No raw color literals remain outside `src/theme/`.
7. Bun tsc --noEmit clean. Existing tests still pass. New tests added for each phase pass.

## Next step

This master plan is itself a design document. To go from here to actual code, **invoke writing-plans** to break Phase 0 into a concrete implementation plan. Then start.

The other phases get their own plans as they come up — better to plan one phase at a time than try to plan all six up front and discover wrong assumptions five plans deep.
