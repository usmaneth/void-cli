# Living Gutter — in-session left-rail narration

**Status:** design · **Owner:** Usman · **Date:** 2026-04-24

## Intent

The left-margin of every line in Void's main transcript carries information today: nothing. It's whitespace. We replace it with a **single-character rail** whose color and glyph narrate the session in real time. Colors map to roles (you / void / tool). Glyphs spike at significant events (turn starts, successes, failures). The peripheral vision picks up "something just happened" before your focus does. Reads like an ECG for the conversation.

Three density levels — user switches between them; same color+glyph grammar at all three. Full for craft, compressed for space, minimal for near-invisibility.

## The three levels

### Level 1 — Full (default)

Turn messages (user + void) get box-drawn frames. Heartbeat rail runs between turns. ~6 rows per turn boundary.

```
╭─ ▲ you
│ fix the auth bug in api.ts
╰─
╽
┃ reading api.ts
┃
╽ bash: git blame api.ts              312ms
╿
┃
╭─ ◆ void
│ found the issue — cookie expires_at is
│ set to 0 on logout, invalidating session.
╰─
```

### Level 2 — Compressed

Turn frames collapse to single-line headers. Heartbeat rail still runs. ~30% fewer rows.

```
╽ ▲ you · fix the auth bug in api.ts
╽ reading api.ts
╽ bash: git blame api.ts              312ms
╿
┣ ◆ void · found the issue
┃ cookie expires_at is set to 0 on logout...
```

### Level 3 — Minimal

Solid `│` only, color-switching. No glyph spikes, no frames. Purely ambient.

```
│ ▲ you · fix the auth bug in api.ts
│ reading api.ts
│ bash: git blame api.ts              312ms
│ ◆ void · found the issue
│ cookie expires_at is set to 0 on logout...
```

## Locked grammar

### Color semantics (all 3 levels)

| Role | Color | Hex |
|---|---|---|
| You (user message) | violet | `#bb9af7` |
| Void prose / reading | cyan | `#7dcfff` |
| Void writing / modifying | amber | `#e0af68` |
| Success | green | `#9ece6a` |
| Failure / blocked | red | `#f7768e` |

### Heartbeat glyphs (levels 1 & 2)

| Glyph | Meaning | When emitted |
|---|---|---|
| `┃` | Steady beat | Default rail between events |
| `╽` | Upward spike (event start) | Turn begins, tool call begins |
| `╿` | Downward spike (event end) | Tool call completes |
| `┣` | Structural branch | Void speaks after reading/thinking |
| `╋` | Intersection pulse | Successful completion (tests pass, build green) |
| `╳` | Broken beat | Failure (error, test fail, tool exception) |

### Framing glyphs (level 1 only)

| Glyph | Meaning |
|---|---|
| `╭─` | Frame top |
| `│` | Frame body |
| `╰─` | Frame bottom |

Used for user and void *message* turns. Tool calls always remain inline (skip framing).

## Density switching

| Trigger | Action |
|---|---|
| `/density full` | Set to Full |
| `/density compressed` | Set to Compressed |
| `/density minimal` | Set to Minimal |
| `Ctrl+G` | Cycle Full → Compressed → Minimal → Full |
| Terminal resize to < 80 cols | Auto-downgrade to Compressed |
| Terminal resize to < 60 cols | Auto-downgrade to Minimal |
| User-set override beats auto-downgrade | If user explicitly set `/density minimal` on a 120-col terminal, it stays minimal |

Density persists per-session (not per-project). Resets to Full on new session (or to user's `defaultDensity` in settings if set).

## Architecture

```
src/components/gutter/
  GutterRail.tsx          — the renderer. given a stream of events +
                            current density, emits the appropriate glyph
                            on each line of the transcript
  glyphGrammar.ts         — the two tables above, as typed constants
  densityResolver.ts      — reads settings + terminal size + user override,
                            returns current density. pure function.
  eventStream.ts          — subscribes to message-appended / tool-call-begin
                            / tool-call-end / success / failure events and
                            maps each to a (glyph, color, role) tuple
  index.ts                — exports
```

### How it integrates

Transcript rendering in Void currently has a `MessageRow` / `ToolCallRow` pattern. Each row renders without knowledge of the gutter. The gutter rail is a **separate left-column renderer** that composes into the transcript's layout:

```
<Box flexDirection="row">
  <GutterRail events={currentSessionEvents} density={density} />
  <Transcript>{messageRows}</Transcript>
</Box>
```

GutterRail tracks its own row count (matches the transcript's row count) and emits one glyph per row based on the event that produced it. For rows with no event (continuation lines, empty separators), it emits `┃` at the last active color.

## Performance

- **Gutter never re-renders faster than the transcript.** Ink batches; the rail composes cleanly into existing render passes.
- **Per-row cost: constant** (lookup in glyph grammar + color emit). Scales linearly with row count like everything else.
- **Resize events debounced 100ms** to prevent density flipping during window drag.

## Testing

- Unit tests for `densityResolver` covering: user override wins over auto, terminal-size breakpoints, default from settings, edge cases (80 cols exact, 60 cols exact).
- Snapshot tests for each density level against a fixed 5-turn conversation fixture.
- Manual verification in iTerm2 + Terminal.app + Alacritty + tmux + small terminal.

## Non-goals

- Custom color theming at the gutter level. Colors come from the global palette (future spec); gutter just uses role→color mapping.
- Gutter on tool output (bash output, diff renders). Tool output already has its own visual treatment. Rail appears only on transcript rows (messages + tool-call summaries).
- More than 3 density levels. Two was too few, four+ is bike-shedding.
- Animated glyphs (pulsing ╋ on success). Tempting but adds render cost and most terminals don't do it well. Stays static.
- Showing the rail in piped / non-TTY output. `-p` headless mode skips rendering entirely.
