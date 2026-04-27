# Session Map — three views of the work

**Status:** design · **Owner:** Usman · **Date:** 2026-04-24

## Intent

A session has shape — files touched, tools fired, edits attempted, tests run, time elapsed. Today none of that is visible after the fact. The transcript scrolls past, the work disappears.

We expose it as **three coordinated views of one shared activity log**: a hierarchical territory tree, a spatial ley-line network, and a temporal horizon strip. Horizon stays ambient above the prompt. The other two are dispatched on-demand via `/map`. All three read from the same in-memory event store, so they're always coherent.

## The three views

### Horizon (ambient, always visible)

Two-row strip above the prompt input. Rendered every frame.

```
    │─────────────────────────────────────────────────│
    ●───●──●────●─●──●──●───────●──●───◆
    18m ago ·············································· now
```

- Left edge = session start, right edge = now (`◆` marker).
- Each `●` = one file touch event. Color encodes operation: cyan read, amber edit, green test/success, red fail.
- Time scale: linear from session start to now.
- Hover/select via `Ctrl+H` jumps focus to that event in the transcript.

### Territory (on-demand, hierarchical)

Familiar file-tree layout, but only nodes that have been touched this session render. Heat bar to the right of each file shows interaction count.

```
src/
 ├─ tools/
 │   ├─ api.ts        ▰▰▰▰▰▱▱▱
 │   └─ cookie.ts     ▰▰▰▱▱▱▱▱
 ├─ session/
 │   ├─ session.ts    ▰▰▱▱▱▱▱▱
 │   └─ refresh.ts    ▰▱▱▱▱▱▱▱
 └─ tests/
     └─ auth.test.ts  ▰▰▰▰▱▱▱▱
```

- Heat bar: 8 cells, filled by `min(8, touchCount)` per file.
- File color: cyan = read only, amber = edited, green = tested.
- Untouched files don't render. Untouched directories collapse out.
- Best for "what did I actually change in this session."

### Ley lines (on-demand, spatial network)

Geometric ASCII diagram. Files as nodes, edges drawn between files referenced in the same turn or the same tool-call sequence.

```
            ●─────────○
            │api.ts   │session.ts
           █         │
            │       ╱
            │      ╱
          ○──●──★
       cookie.ts  tests/auth
```

- Node glyph encodes operation: `●` hot (5+ touches), `○` touched, `█` edited, `★` tested.
- Edges: drawn when two files appear in the same turn's read-set or edit-set. Edge intensity reflects co-occurrence count (dim → bright).
- Layout: simple force-directed-ish heuristic, deterministic per session (seeded from session id so same session re-opens to same layout).
- Best for "what's connected to what."

## Trigger / interaction model

| Action | Result |
|---|---|
| Always-on | Horizon strip rendered in 2 rows above the prompt input |
| `/map` | Opens full dashboard: territory + ley + horizon visible at once |
| `h` (in dashboard) | Expand horizon view full-screen — adds step-by-step annotations |
| `t` (in dashboard) | Expand territory full-screen |
| `l` (in dashboard) | Expand ley network full-screen |
| `/` (in any view) | Filter by file name substring |
| Click / select a file in any view | All three views highlight that file |
| `Esc` | Close dashboard, return to REPL |
| `/map off` | Hide horizon strip too — full ambient silence |
| `/map on` | Re-enable horizon |

## Data model — the shared activity log

One in-memory store, append-only during a session:

```typescript
type ActivityEvent =
  | { type: 'fileRead'; path: string; turnId: string; timestamp: number }
  | { type: 'fileEdit'; path: string; turnId: string; timestamp: number; success: boolean }
  | { type: 'toolCall'; tool: string; turnId: string; timestamp: number; durationMs: number }
  | { type: 'testRun'; path: string; turnId: string; timestamp: number; passed: boolean }
  | { type: 'turnBoundary'; turnId: string; role: 'user' | 'assistant'; timestamp: number }

class ActivityLog {
  events: ActivityEvent[]
  add(e: ActivityEvent): void
  byFile(): Map<string, ActivityEvent[]>      // for Territory
  edges(): Array<[string, string, number]>     // for Ley (file pairs + co-occurrence count)
  ordered(): ActivityEvent[]                   // for Horizon
  highlight(path: string): void                // sets currently-highlighted node, all views read
}
```

The log is populated by hooks already present in Void's tool-dispatch path. Tools like `FileReadTool`, `FileEditTool`, `BashTool` (test detection), and `TurnTracker` push events on completion. No new instrumentation in those tools — just an event sink.

## Architecture

```
src/components/sessionMap/
  HorizonStrip.tsx          — the always-on 2-row strip above prompt
  MapDashboard.tsx          — the /map full view, composes the three sub-views
  TerritoryTree.tsx         — file-tree renderer with heat bars
  LeyNetwork.tsx            — node-edge ASCII layout
  ExpandedHorizon.tsx       — full-screen horizon with step annotations
  ExpandedTerritory.tsx     — full-screen tree (folder navigation)
  ExpandedLey.tsx           — full-screen ley graph (zoomable)
  layoutLey.ts              — force-directed layout function (deterministic, seeded)
  highlightStore.ts         — global state for "selected file" cross-linking
  index.ts

src/services/activityLog/
  ActivityLog.ts            — the append-only event store
  hooks.ts                  — useActivityLog(), useByFile(), useEdges(), useOrdered()
  index.ts
```

## Layout sizing

| Terminal width | Horizon | Dashboard layout |
|---|---|---|
| ≥ 120 cols | 2-row strip, full timeline | Territory left (40 cols) · Ley right (60 cols) · Horizon bottom |
| 80-119 cols | 2-row strip, compressed timeline | Territory + Ley stacked vertically · Horizon at bottom |
| 60-79 cols | 1-row strip, dots only | `/map` opens single-view (default territory) with `h/t/l` to swap |
| < 60 cols | Hidden | `/map` shows tab-strip header + one view at a time |

Auto-disabled in non-TTY contexts.

## Performance

- ActivityLog is in-memory only, capped at 5000 events per session. Older events drop off the front (sessions never run that long anyway).
- Horizon strip re-renders only when a new event is appended. Fixed-cost layout (linear time mapping).
- Territory and ley views render lazily on `/map` invocation, not before.
- Ley layout cache keyed by `(sessionId, eventCount)`. Re-layout only on event-count delta.
- Highlight propagation: O(1) — single store update, all three subscribed views re-render their own highlight cell.

## Testing

- ActivityLog unit tests: append, byFile aggregation, edges aggregation, ordered output preserves insertion order, 5000-event cap behavior.
- Snapshot tests for each renderer at fixed activity-log fixtures (10 events, 50 events, 500 events).
- Layout determinism test for ley: same seed + same events → identical (x, y) positions.
- Manual verification: `/map` open/close/expand transitions, highlight cross-linking, narrow-terminal fallbacks.

## Non-goals

- Real-time graph animation as files get touched. Snapshots on `/map` invocation; horizon updates ambiently. No live ley re-layout — would be expensive and visually noisy.
- Persistence across sessions. The map is for the *current* session. Cross-session views are the future "stellar history" feature (separate spec).
- Manual edit of the activity log (e.g., user marking a file "important"). Pure read-only view of what actually happened.
- Integration with the diff/patch system. The map shows that a file was edited; it doesn't show what was edited. Diffs stay in their own surfaces.
