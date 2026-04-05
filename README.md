
```
 ██╗   ██╗ ██████╗ ██╗██████╗
 ██║   ██║██╔═══██╗██║██╔══██╗
 ██║   ██║██║   ██║██║██║  ██║
 ╚██╗ ██╔╝██║   ██║██║██║  ██║
  ╚████╔╝ ╚██████╔╝██║██████╔╝
   ╚═══╝   ╚═════╝ ╚═╝╚═════╝
```

# Void

**Your terminal is the IDE. Your AI is the engineer.**

Void is an agentic AI coding assistant that lives in your terminal. It reads your codebase, edits files, runs commands, manages git, and ships features — all through natural language. No browser. No GUI. Just you and the void.

---

## What can Void do?

- **Write code** — Describe what you want. Void reads your codebase, understands the architecture, and writes production code across multiple files.
- **Fix bugs** — Paste an error. Void traces it through your stack, identifies the root cause, and patches it.
- **Refactor** — "Convert this to TypeScript" or "Split this into smaller functions." Void handles multi-file refactors atomically.
- **Run commands** — Void executes shell commands, runs tests, checks builds, and iterates until things pass.
- **Git workflow** — Commits, branches, diffs, PRs. Void manages your git workflow without you touching `git`.
- **Read anything** — Files, images, PDFs, Jupyter notebooks. Void is multimodal.
- **MCP servers** — Connect external tools (databases, APIs, services) via the Model Context Protocol.
- **Background agents** — Spawn parallel agents to research, build, or test independently.
- **Resume sessions** — Pick up exactly where you left off. Every conversation is persistent.

---

## Install

### Requirements

- [Bun](https://bun.sh) v1.1+
- macOS or Linux
- An Anthropic API key

### Quick start

```bash
# Clone the repo
git clone https://github.com/usmaneth/void-cli.git
cd void-cli

# Install dependencies
bun install

# Add to your PATH
echo 'export PATH="$HOME/void-cli/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Set your API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Launch
void
```

### One-liner

```bash
git clone https://github.com/usmaneth/void-cli.git && cd void-cli && bun install && echo 'export PATH="$HOME/void-cli/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

---

## Usage

### Interactive mode (default)

```bash
void
```

Opens a REPL where you chat with Void. It sees your codebase, can edit files, run commands, and iterate.

### Single prompt

```bash
void -p "add error handling to the API routes"
```

Runs a single prompt, prints the result, and exits. Great for scripts and CI.

### Resume a conversation

```bash
void --continue          # Resume the last session in this directory
void --resume             # Pick from recent sessions
```

### Common flags

| Flag | Description |
|------|-------------|
| `-p, --print` | Non-interactive mode (pipe-friendly) |
| `-c, --continue` | Resume last conversation |
| `-r, --resume` | Resume by session ID or pick interactively |
| `--model <model>` | Choose model (e.g., `opus`, `sonnet`, `haiku`) |
| `--add-dir <dirs>` | Add directories to the context |
| `--dangerously-skip-permissions` | Skip all permission prompts |
| `--verbose` | Show detailed operation logs |
| `-v, --version` | Print version |

### Slash commands

Inside a Void session, use `/` commands:

| Command | What it does |
|---------|-------------|
| `/help` | Show available commands |
| `/theme` | Switch color themes |
| `/model` | Change the AI model |
| `/compact` | Summarize and compress the conversation |
| `/clear` | Start fresh |
| `/commit` | Stage and commit changes |
| `/review` | Code review your changes |
| `/resume` | Browse and resume past sessions |
| `/mcp` | Manage MCP server connections |
| `/login` | Authenticate with your API provider |
| `/checkpoint` | Manage workspace checkpoints (list, diff, restore) |
| `/watch` | File watcher with auto-lint/test feedback |
| `/session` | Save, resume, search, export sessions |
| `/cmd` | Run custom command templates |
| `/architect` | Toggle architect mode (two-model pipeline) |
| `/mode` | Switch permission modes (suggest/auto-edit/full-auto) |
| `/repomap` | Repository map — ranked code symbols and file relationships |
| `/completion` | Output shell completion scripts (bash/zsh/fish) |
| `/serve` | Start headless HTTP server for CI/CD integration |
| `/think` | Toggle thinking mode for complex reasoning |
| `/clarify` | Pre-generation clarification questions |
| `/hints` | Manage hierarchical .voidhints project context |
| `/guardrails` | Edit guardrails — auto-lint and syntax validation |
| `/compress` | LM-optimized output compression |
| `/diff-review` | Unified multi-file diff review |

---

## Configuration

Void stores config in `~/.void.json` and `~/.void/`.

### API key

Set via environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or configure via settings:

```bash
void /login
```

### VOID.md

Create a `VOID.md` file in your project root to give Void persistent instructions:

```markdown
# Project instructions

- Use TypeScript strict mode
- Write tests for all new functions
- Follow the existing naming conventions
- Never modify files in /vendor
```

Void reads this file at the start of every session.

### Themes

Void ships with 6 themes:

- **Dark mode** (default)
- **Light mode**
- **Dark mode (colorblind-friendly)**
- **Light mode (colorblind-friendly)**
- **Dark mode (ANSI colors only)**
- **Light mode (ANSI colors only)**

Switch with `/theme` or `--theme`.

---

## Architecture

Void is built on:

- **TypeScript** — End-to-end type safety
- **Bun** — Fast runtime and module resolution
- **Ink + React** — Terminal UI framework
- **Anthropic SDK** — Claude model integration
- **MCP** — Model Context Protocol for tool extensibility

### Project structure

```
void-cli/
├── src/
│   ├── entrypoints/     # CLI entry point
│   ├── components/      # Ink/React UI components
│   ├── tools/           # Built-in tools (Bash, Edit, Read, Write, etc.)
│   ├── services/        # API clients, MCP, analytics
│   ├── utils/           # Shared utilities
│   └── screens/         # REPL, Doctor, Resume screens
├── bin/
│   └── void             # Launcher script
└── package.json
```

---

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Core CLI — rebrand, theming, boot sequence | ✅ Done |
| 2 | Multi-model engine — OpenRouter, model switching | ✅ Done |
| 3 | Interaction redesign — tool cards, cost footers, spinners, diff rendering | ✅ Done |
| 4 | Agent council — multi-model orchestration, consensus voting | ✅ Done |
| 5 | Knowledge graph memory — persistent context across sessions | ✅ Done |
| 6 | Native integrations — GitHub, Slack, Notion | ✅ Done |
| 7 | Visual output — charts, diagrams, tables, sparklines | ✅ Done |
| 8 | Auto-compact — context window management with auto-summarization | ✅ Done |
| 9 | Workspace checkpoints — git-based undo/redo with diff viewing | ✅ Done |
| 10 | Watch mode — file watcher with auto-lint/test feedback loops | ✅ Done |
| 11 | Session persistence — save, resume, search, export sessions | ✅ Done |
| 12 | Custom commands — user-defined .md templates with placeholders | ✅ Done |
| 13 | Architect mode — two-model pipeline (plan then implement) | ✅ Done |
| 14 | Tiered permissions — suggest / auto-edit / full-auto modes | ✅ Done |
| 15 | Repo map — regex-based code indexing with reference ranking | ✅ Done |
| 16 | Shell completions & diagnostics — bash/zsh/fish + void doctor | ✅ Done |
| 17 | Headless HTTP server — CI/CD integration via JSON API | ✅ Done |
| 18 | @-file references — inline file context injection | ✅ Done |
| 19 | Thinking mode — deep reasoning toggle for complex tasks | ✅ Done |
| 20 | Clarification — pre-generation ambiguity analysis | ✅ Done |
| 21 | .voidhints — hierarchical project context files | ✅ Done |
| 22 | Edit guardrails — syntax validation and auto-lint on edit | ✅ Done |
| 23 | Output compression — LM-optimized token-saving compression | ✅ Done |
| 24 | Multi-file diff review — unified diff viewer with navigation | ✅ Done |

### Phase details

**Phase 2 — Multi-model engine**
- OpenRouter integration via OpenAI Chat Completions shim
- Dual-provider routing: Anthropic direct + OpenRouter for 50+ models
- Env: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `VOID_USE_OPENROUTER`

**Phase 3 — Interaction redesign**
- ToolCard: Color-coded bordered cards for 10 tool types
- SessionHUD: Context window bar, token counts, session duration, cost
- ContextualSpinner: Tool-specific loading messages
- EnhancedDiff: Syntax-aware diff rendering with line numbers
- PromptStatusBar: Model, branch, permission mode, token budget
- MessageGutter/Divider: Visual message type differentiation

**Phase 4 — Agent council**
- Run multiple models in parallel (Claude, GPT-4o, Gemini, Llama, etc.)
- 4 presets: duo, trinity, full, open-source
- 4 consensus methods: leader-picks, voting, longest, first
- `/council` command with full management

**Phase 5 — Knowledge graph memory**
- Persistent entity/relation graph at `~/.void/memory/graph.json`
- Auto-learns from file reads, edits, commands, patterns
- 10 entity types, 8 relation types, graph traversal
- `/memory` command for search, recall, manage

**Phase 6 — Native integrations**
- GitHub: Issues, PRs, comments (auto-detects repo from git remote)
- Slack: Webhook messages, code blocks, session summaries
- Notion: Pages, session logs, search
- `/integrate` command for all three services

**Phase 7 — Visual output**
- Bar charts, sparklines, pie charts, heatmaps, progress bars
- Tree diagrams, box diagrams, ASCII tables, flowcharts
- React/Ink components for inline rendering
- `/visual` command for all chart types

**Phase 8 — Auto-compact**
- Tracks cumulative token usage per conversation turn
- Warns at 80% context window, auto-compacts at 90%
- Heuristic summarization: extracts key decisions, files modified, task state
- `/compact status`, `/compact now`, `/compact threshold <percent>`

**Phase 9 — Workspace checkpoints**
- Git stash-based snapshots before every file-modifying tool call
- Per-project checkpoint storage at `~/.void/checkpoints/`
- `/checkpoint list`, `/checkpoint diff <id>`, `/checkpoint restore <id>`, `/checkpoint prune`

**Phase 10 — Watch mode**
- Recursive file watcher with debouncing (500ms default)
- Auto-runs lint and test commands on file changes
- Parses ESLint, TypeScript, Jest error formats
- Scans for `// AI: ...` trigger comments in changed files
- `/watch start`, `/watch stop`, `/watch status`, `/watch config`

**Phase 11 — Session persistence**
- JSONL-based message storage at `~/.void/sessions/`
- Auto-generated session titles from first user message
- Session tagging and search
- `/session list`, `/session save`, `/session resume`, `/session export`

**Phase 12 — Custom commands**
- User-defined `.md` templates in `~/.void/commands/` (global) or `.void/commands/` (project)
- `$PLACEHOLDER` syntax for template arguments
- Subdirectory organization (e.g., `git/commit.md` → `git:commit`)
- Default templates: review, explain, commit, refactor
- `/cmd list`, `/cmd run <name>`, `/cmd create`, `/cmd init`

**Phase 13 — Architect mode**
- Two-stage pipeline: architect model plans, coder model implements
- Structured JSON plans with steps, files affected, risks
- Configurable models for each role (works with OpenRouter)
- `/architect on|off`, `/architect plan <task>`, `/architect model`

**Phase 15 — Repo map**
- Regex-based code indexing for TypeScript, Python, Go, Rust, Java
- Reference-count ranking (PageRank-inspired — most-referenced symbols first)
- Compact file map for LLM context injection
- Related file discovery via import graph
- Disk-cached with 10-minute TTL
- `/repomap show`, `/repomap build`, `/repomap file`, `/repomap related`, `/repomap stats`

**Phase 16 — Shell completions & diagnostics**
- `void completion bash|zsh|fish` — output completion scripts
- `/doctor-diag` — run environment diagnostics (Node.js, git, API keys, disk, network)
- Checks: 10 diagnostic categories with pass/warn/fail + suggested fixes

**Phase 17 — Headless HTTP server**
- `void serve --port 3456` — JSON-over-HTTP API for CI/CD
- Routes: `/health`, `/status`, `/chat`, `/review`, `/sessions`
- Auth via Bearer token, CORS, concurrency limiting
- Stubbed AI handlers ready for pipeline integration

**Phase 14 — Tiered permissions**
- Three modes: suggest (read-only), auto-edit (files ok, commands confirm), full-auto (everything)
- Per-project defaults via `.void/config.json`
- Visual mode indicator in status bar
- `/mode suggest`, `/mode auto-edit`, `/mode full-auto`, `/mode permissions`

**Phase 18 — @-file references**
- Type `@path/to/file` inline in prompts to inject file content as context
- Auto-completion of file paths with directory traversal
- Supports files and directories, respects .gitignore exclusions
- Content wrapped in `<file-reference>` blocks for clean LLM context

**Phase 19 — Thinking mode**
- `/think` toggles deep reasoning for complex tasks (inspired by Kimi Code)
- Complexity analyzer scores messages 0-100 based on heuristics
- Auto-think option for messages exceeding complexity threshold
- Configurable token budget for thinking

**Phase 20 — Clarification questions**
- Ambiguity analysis before generating code (inspired by GPT Engineer)
- Detects vague scope, missing targets, multiple interpretations
- Generates targeted clarification questions
- `/clarify analyze <message>` to preview analysis

**Phase 21 — .voidhints context files**
- Hierarchical `.voidhints` files at any directory level (inspired by Goose)
- Auto-discovers and merges hints from project root to target directory
- Section types: rules, conventions, architecture, testing, context
- `/hints init` creates starter templates

**Phase 22 — Edit guardrails**
- Syntax validation after every edit (inspired by SWE-agent)
- Bracket matching, string validation, import syntax checks
- Blocked paths to prevent accidental modification
- Optional auto-lint integration with reject-on-error mode

**Phase 23 — Output compression**
- Smart compression of large command output to save tokens (inspired by SWE-agent)
- Three strategies: truncate, smart (preserves errors/structure), summary
- Specialized compressors for test, lint, build, and git output
- Auto-detects output type and applies appropriate compression

**Phase 24 — Multi-file diff review**
- Unified diff viewer for reviewing changes across files (inspired by Zed)
- Parses git diff output into structured entries with hunks and lines
- Multiple views: unified, side-by-side, summary
- Filter by file, language, change size, or status

---

## Development

```bash
# Type check
bun run check

# Build (TypeScript compilation)
bun run build

# Run from source
bun run src/entrypoints/cli.tsx

# Run with debug logging
void --debug
```

---

## License

Private. All rights reserved.

---

<p align="center">
  <strong>Void</strong> — the space between thought and code.
</p>
