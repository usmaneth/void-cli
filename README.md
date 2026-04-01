
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
| 1 | Core CLI — rebrand, theming, boot sequence | Done |
| 2 | Multi-model engine — OpenRouter, model switching | Planned |
| 3 | Interaction redesign — tool cards, cost footers | Planned |
| 4 | Agent council — multi-agent orchestration | Planned |
| 5 | Knowledge graph memory — persistent context | Planned |
| 6 | Native integrations — GitHub, Slack, Notion | Planned |
| 7 | Visual output — charts, diagrams, images | Planned |

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
