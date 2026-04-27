# History — three views of past sessions

**Status:** design · **Owner:** Usman · **Date:** 2026-04-27

## Intent

The flat session list every CLI ships is fine for "open the most recent" and useless for everything else. Past sessions carry real information: which projects had momentum, which got abandoned, what you figured out and when. We expose that data through **three coordinated views** of the same underlying session log: a searchable list (default), a project-clustered map, and a multi-project timeline. Tab-key toggle between them.

The constellation/starfield variant — beautiful but easily overwhelming with 138+ sessions — is intentionally not shipping. Practical wins.

## The three views

### 1. List (default)

Searchable, sortable, ranked. Familiar.

```
▶ /history · search: gpt-5_

★ 2026-04-23 · void-cli                    today  18h
   gpt-5.5 OAuth port + visual specs · 8 specs · 12 commits

★ 2026-04-23 · void-cli                  today   3h
   portal/black hole boot+exit cinema design

✦ 2026-04-22 · trading-bot               1d   6h
   council layers — auth fixes, deepseek routing

★ 2026-04-21 · anuma-text                2d   4h
   memoryless API integration · 3 PRs merged
```

Each row: status glyph + date + project + summary + duration. Status: `★` shipped (committed), `✦` in-progress, `×` abandoned, `·` empty/no-output.

### 2. Clustered (project-grouped)

Each project gets a row of stars. Time flows left-to-right within a cluster. Connecting lines show causal chains within a project.

```
┌─ void-cli ────────── 42 sessions ─────────────────┐
│  ★─★─★     ✦      ★      ★─★     ◆ today        │
└─────────────────────────────────────────────────┘

┌─ trading-bot ─────── 28 sessions ──────────────┐
│       ★    ★─★      ✦      ×       ★          │
└─────────────────────────────────────────────────┘

┌─ anuma-text ──────── 19 sessions ──────────────┐
│  ★     ★       ★     ★─★─★         ✦          │
└─────────────────────────────────────────────────┘
```

Best for "which projects have momentum, which stalled, which got abandoned."

### 3. Timeline (gantt-y, multi-project)

Time on x-axis (calendar-aligned), projects on y-axis (one row each).

```
    apr 7    apr 12     apr 18      apr 23   today
    │─────────────────────────────────────────│
    ●───●─────●────●────●─●─────●─●───◆  void-cli
    ●────────────●───×───────●─────────●  trading-bot
    ·─────────●───●─●─●────●─────✦  anuma-text
    ·────────●───●─●─●───────────●─────·  trading/council
```

Best for "what have I actually been up to" portfolio view. Selected session pops a summary at the bottom.

## Trigger / interaction

| Action | Result |
|---|---|
| `/history` | Opens default view (list, recent first) |
| `/history list` | Force list view |
| `/history map` | Force clustered view |
| `/history timeline` | Force timeline view |
| `tab` (in any view) | Cycle: list → map → timeline → list |
| `/<query>` (in any view) | Filter by substring across summary, project, files-touched, model |
| `↑↓` (list) / `←→` (timeline) / `tab` between clusters (map) | Navigate |
| `enter` on any session | Show session detail panel (summary, files, commits, cost, model) |
| `enter` again | Resume session (`claude --resume <id>`) |
| `d` | Delete selected session (soft delete, recoverable) |
| `f` | Filter by current project (cwd) |
| `Esc` | Close history view |

Default sort in list view: most-recent-first. Sort options: recency, duration, cost, project, status.

## Data model

Sessions are already persisted in `~/.void/sessions/` (jsonl rollouts). We add a lightweight index:

```typescript
type SessionIndexEntry = {
  id: string                    // uuid
  project: string               // cwd basename, e.g. "void-cli"
  projectPath: string           // full path, for grouping
  startTime: number             // epoch ms
  endTime: number               // epoch ms
  durationMs: number            // computed; cached
  summary: string               // first user prompt or auto-generated 1-line
  status: 'shipped' | 'in_progress' | 'abandoned' | 'empty'
  commits: string[]             // commit hashes if any were made
  filesTouched: string[]        // unique files touched in session
  cost: number                  // dollars; 0 for sub
  model: string                 // primary model used
  toolCallCount: number
  parentSessionId?: string      // if this resumed/branched from another
}
```

Index file: `~/.void/sessions/index.json` — array of entries, sorted by startTime desc. Rebuilt on session end. Read once on `/history` invocation.

`status` derivation:
- `shipped` if any commit was made during the session
- `in_progress` if no commit but tool calls happened
- `abandoned` if user ran `/exit` and rolled back, or session was force-killed without progress
- `empty` if no tool calls and no model output

## Architecture

```
src/components/history/
  HistoryView.tsx              — top-level, owns view state, hosts search/filter
  ListView.tsx                 — default
  ClusteredView.tsx            — project-grouped
  TimelineView.tsx             — gantt-y
  SessionDetailPanel.tsx       — when a session is selected
  index.ts

src/services/sessionIndex/
  SessionIndex.ts              — load + save + query the index file
  rebuild.ts                   — scan ~/.void/sessions/ to rebuild index
  hooks.ts                     — useSessionIndex(), useFilteredSessions(query)
  index.ts
```

Search uses fuzzy match (existing `utils/fuzzy/index.ts`) across `summary + project + filesTouched.join(' ') + model`. Sort by score desc when query is non-empty.

## Performance

- Session index loaded once per `/history` invocation, cached in memory for that view session.
- Index rebuild: triggered on session end (cheap — appends one entry). Full rescan only if index file is missing or corrupted.
- Filter/search: O(n) across index entries; acceptable up to 5000 sessions (~6 months at typical rate).
- Timeline view layout: O(n) — one pass, x-coord = `(startTime - earliestSession) / range * width`.
- Clustered view: groups by `project` field; sorted within group by `startTime`.

## Testing

- `SessionIndex` unit tests: load, save, append, rebuild from disk, corruption recovery (delete + rescan).
- Status derivation: parameterized tests covering all four status states.
- Snapshot tests for each view at 5/50/500-session fixtures.
- Search behavior: known-query → expected ranking, empty query, no-match.
- Manual: tab cycles between views without losing selection or query, enter resumes correctly, `d` soft-deletes (and the entry returns on rebuild if file still exists).

## Configuration

| Setting | Type | Default |
|---|---|---|
| `historyDefaultView` | `'list' \| 'map' \| 'timeline'` | `'list'` |
| `historySoftDeletedRetentionDays` | number | `30` |
| `historySearchScope` | `'summary' \| 'all'` | `'all'` (summary + project + files + model) |

## Non-goals

- Pure-constellation/starfield view. Beautiful but at 100+ sessions becomes noise. Cut.
- Cross-machine session sync. The index is per-machine. Multi-device sync is its own concern (vault for that).
- Session merging / forking from history view. You can resume; the actual fork point is at runtime, not in /history.
- Editing session metadata. The summary line is auto-generated; users can `/rename <id> <new-summary>` from inside the resumed session, not from history.
- Calendar/grid view (e.g., GitHub contribution graph). Considered, dropped — timeline view already covers the temporal axis better.
