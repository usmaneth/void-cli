
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
