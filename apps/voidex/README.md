# Voidex

Voidex is Void's desktop coding agent — a Codex-style chat app powered by the Void orchestrator.

## Run

```bash
# from the repo root
bun run voidex
# or
npx electron apps/voidex
```

The CLI wires this up with the `/voidex` slash command. You can also pass
context through environment variables:

| Variable | Meaning |
| --- | --- |
| `VOIDEX_MODE` | `chat` \| `swarm` \| `deliberate` \| `plan` |
| `VOIDEX_PROMPT` | Prefill the composer with a prompt |
| `VOIDEX_CWD` | Project root (defaults to the launch directory) |
| `VOIDEX_MODEL` | Default model (e.g., `sonnet`, `openai/gpt-4o`) |
| `VOIDEX_MODELS` | Comma-separated models for swarm/deliberate |
| `VOIDEX_ROUNDS` | Rounds for deliberate mode |
| `VOIDEX_SESSION_ID` | Link back to an existing Void session |
| `VOIDEX_HANDOFF` | Path to a JSON file with all of the above at once |

## Layout

- **Sidebar** — Projects, Threads, Skills (Swarm, Deliberate, Review, Plan)
- **Main** — Chat thread with `Ask` / `Code` dual submit buttons
- **Right drawer** — Diff review panel (opens from the Skills sidebar)

## Status

This is the first cut. The Electron shell runs, persists threads under
`~/.void/voidex/threads/`, and stages calls to `/swarm`, `/deliberate`, and
`/architect`. A full WebSocket bridge to the Void CLI for live streaming is
the next step.
