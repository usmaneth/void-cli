
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

Void is an agentic AI coding assistant that lives in your terminal. It understands your codebase, writes production code, fixes bugs, runs tests, manages git, and ships features — all through natural language. Built on top of Claude Code with 24 additional feature phases ported from the best open-source AI coding tools.

---

## Why Void?

Void takes the best features from every major AI coding tool and puts them in one CLI:

| Feature | Void | Claude Code | aider | Cursor |
|---------|------|-------------|-------|--------|
| Multi-provider (Anthropic + OpenRouter + Bedrock + Vertex) | ✅ | ❌ | ✅ | ✅ |
| Repo map (code indexing with reference ranking) | ✅ | ❌ | ✅ | ❌ |
| Architect mode (plan model + code model) | ✅ | ❌ | ✅ | ❌ |
| Workspace checkpoints (undo any AI change) | ✅ | ❌ | ❌ | ❌ |
| Watch mode (auto-lint/test feedback loops) | ✅ | ❌ | ✅ | ❌ |
| Custom commands (.md templates) | ✅ | ❌ | ❌ | ❌ |
| Tiered permissions (suggest/auto-edit/full-auto) | ✅ | ❌ | ❌ | ❌ |
| Agent council (multi-model consensus) | ✅ | ❌ | ❌ | ❌ |
| .voidhints (hierarchical project context) | ✅ | ❌ | ❌ | ❌ |
| Edit guardrails (auto-syntax validation) | ✅ | ❌ | ❌ | ❌ |
| Output compression (token-saving strategies) | ✅ | ❌ | ❌ | ❌ |
| Headless HTTP server (CI/CD API) | ✅ | ❌ | ❌ | ❌ |
| MCP (Model Context Protocol) | ✅ | ✅ | ❌ | ❌ |
| Background agents | ✅ | ✅ | ❌ | ❌ |
| Thinking mode toggle | ✅ | ✅ | ❌ | ❌ |
| Knowledge graph memory | ✅ | ❌ | ❌ | ❌ |

---

## Install

### Requirements

- [Bun](https://bun.sh) v1.1+
- macOS or Linux
- An API key (Anthropic, OpenRouter, AWS Bedrock, or Google Vertex)

### Quick start

```bash
# Clone and install
git clone https://github.com/usmaneth/void-cli.git
cd void-cli && bun install

# Add to PATH
echo 'export PATH="$HOME/void-cli/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Set your API key (pick one or use multiple)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENROUTER_API_KEY="sk-or-..."   # optional, for 200+ models

# Launch
void
```

### One-liner

```bash
git clone https://github.com/usmaneth/void-cli.git && cd void-cli && bun install && echo 'export PATH="$HOME/void-cli/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

---

## Multi-Provider Setup

Void supports **5 providers simultaneously**. You can use native Anthropic for Claude models and OpenRouter for everything else — at the same time.

### Provider priority

Void checks providers in this order:

1. **AWS Bedrock** (`VOID_USE_BEDROCK=1`)
2. **Google Vertex** (`VOID_USE_VERTEX=1`)
3. **Azure Foundry** (`VOID_USE_FOUNDRY=1`)
4. **OpenRouter** (`VOID_USE_OPENROUTER=1`)
5. **Anthropic direct** (default)

### Using Anthropic + OpenRouter together

This is the recommended setup for maximum model access:

```bash
# Native Anthropic for Claude models (fastest, cheapest for Claude)
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenRouter for everything else (GPT-4o, Gemini, Llama, Mistral, etc.)
export OPENROUTER_API_KEY="sk-or-..."
```

**How routing works:**

- Models with `/` in the name (e.g., `openai/gpt-4o`) automatically route to OpenRouter
- Claude models route to Anthropic directly
- Set `VOID_USE_OPENROUTER=1` to route ALL models through OpenRouter

```bash
# Use Claude via Anthropic (direct)
void --model sonnet

# Use GPT-4o via OpenRouter (auto-detected from the /)
void --model openai/gpt-4o

# Use Llama via OpenRouter
void --model meta-llama/llama-3.1-70b-instruct

# Switch models mid-session
/model openai/gpt-4o
/model sonnet
```

### Using AWS Bedrock

```bash
export VOID_USE_BEDROCK=1
export AWS_REGION="us-east-1"
# Uses your AWS credentials (IAM role, env vars, or ~/.aws/credentials)
void
```

### Using Google Vertex AI

```bash
export VOID_USE_VERTEX=1
export ANTHROPIC_VERTEX_PROJECT_ID="my-project"
export CLOUD_ML_REGION="us-east5"
void
```

### All provider environment variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic | Direct Claude API key |
| `OPENROUTER_API_KEY` | OpenRouter | Access to 200+ models |
| `OPENROUTER_MODEL` | OpenRouter | Default model override |
| `VOID_USE_OPENROUTER` | OpenRouter | Force all traffic through OpenRouter |
| `VOID_USE_BEDROCK` | AWS | Use AWS Bedrock |
| `AWS_REGION` | AWS | Bedrock region |
| `VOID_USE_VERTEX` | Google | Use Google Vertex AI |
| `ANTHROPIC_VERTEX_PROJECT_ID` | Google | Vertex project ID |
| `VOID_USE_FOUNDRY` | Azure | Use Azure Foundry |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Azure | Foundry endpoint |

---

## Void vs. Other Tools

### vs. Claude Code

Void is built on Claude Code's foundation, so you get everything Claude Code has plus 24 additional feature phases. Key additions:

- **Multi-provider**: Use Claude, GPT-4o, Gemini, Llama — all from one CLI. Claude Code is locked to Anthropic only.
- **Repo map**: PageRank-inspired code indexing gives the AI a smart codebase overview (from aider)
- **Architect mode**: Strong model plans, fast model implements (from aider)
- **Workspace checkpoints**: Undo any AI change with git-based snapshots (from Cline)
- **Watch mode**: Auto-runs lint and tests after changes, feeds errors back to AI (from aider)
- **Agent council**: Run multiple models in parallel and pick the best response
- **Custom commands**: Reusable `.md` prompt templates with arguments (from opencode)
- **Tiered permissions**: suggest/auto-edit/full-auto modes (from Codex CLI)
- **.voidhints**: Hierarchical project context files at any directory level (from Goose)
- **Edit guardrails**: Syntax validation after every edit (from SWE-agent)

### vs. aider

Void ports aider's best features (repo map, architect mode, watch mode, auto-lint/test loops) and adds multi-provider support, workspace checkpoints, agent council, knowledge graph memory, and a richer terminal UI. aider is Python-based and focused on git-integrated pair programming.

### vs. Cursor

Void is terminal-native while Cursor is an IDE. Void supports more models (200+ via OpenRouter), has workspace checkpoints, repo map, agent council, and custom commands. Cursor has inline code completion, which Void doesn't (terminal limitation).

---

## Usage

### Interactive mode

```bash
void                                    # Start a new session
void --model opus                       # Use a specific model
void --model openai/gpt-4o             # Use GPT-4o via OpenRouter
void -c                                 # Resume last conversation
void -r                                 # Pick from recent sessions
```

### Headless mode (CI/CD)

```bash
void -p "add error handling to the API routes"    # Single prompt
void -p "review this diff" < changes.patch         # Pipe input
void serve --port 3456                             # HTTP server mode
```

### @-file references

Mention files inline to inject their content as context:

```
> @src/auth.ts why is the login failing?
> refactor @src/utils/helpers.ts to use async/await
> compare @src/old.ts and @src/new.ts
```

### Common flags

| Flag | Description |
|------|-------------|
| `-p, --print` | Non-interactive mode (pipe-friendly) |
| `-c, --continue` | Resume last conversation |
| `-r, --resume` | Resume by session ID or pick interactively |
| `--model <model>` | Choose model (e.g., `opus`, `sonnet`, `openai/gpt-4o`) |
| `--add-dir <dirs>` | Add directories to the context |
| `--dangerously-skip-permissions` | Skip all permission prompts |
| `--verbose` | Show detailed operation logs |
| `-v, --version` | Print version |

---

## Slash Commands

Inside a Void session, use `/` commands for power features:

### Core

| Command | What it does |
|---------|-------------|
| `/help` | Show all available commands |
| `/model` | Switch AI model mid-session |
| `/theme` | Change color theme |
| `/clear` | Start a fresh conversation |
| `/login` | Authenticate with your API provider |
| `/compact` | Auto-compact context (summarize + compress) |

### Code Intelligence

| Command | What it does |
|---------|-------------|
| `/repomap` | Show ranked code symbols and file relationships |
| `/architect` | Toggle two-model pipeline (plan then implement) |
| `/think` | Toggle deep reasoning mode for complex tasks |
| `/clarify` | Pre-generation ambiguity analysis and clarification |
| `/guardrails` | Edit guardrails — syntax validation and auto-lint |
| `/compress` | LM-optimized output compression |

### Workflow

| Command | What it does |
|---------|-------------|
| `/commit` | Stage and commit changes |
| `/review` | Code review your changes |
| `/diff-review` | Unified multi-file diff viewer |
| `/watch` | File watcher with auto-lint/test feedback |
| `/checkpoint` | Workspace checkpoints (list, diff, restore, undo) |
| `/session` | Save, resume, search, export sessions |

### Configuration

| Command | What it does |
|---------|-------------|
| `/mode` | Switch permission modes (suggest/auto-edit/full-auto) |
| `/cmd` | Run custom .md command templates |
| `/hints` | Manage .voidhints project context files |
| `/mcp` | Manage MCP server connections |
| `/completion` | Output shell completion scripts (bash/zsh/fish) |
| `/serve` | Start headless HTTP server for CI/CD |

---

## Key Features

### Repo Map

Void indexes your codebase using regex-based parsing across 6 languages (TypeScript, Python, Go, Rust, Java, JavaScript). Symbols are ranked by how often they're referenced — the most important code surfaces first.

```bash
/repomap show          # Top symbols by reference count
/repomap stats         # File/symbol counts by language
/repomap related src/auth.ts  # Files connected to auth.ts
```

### Architect Mode

Split complex tasks into planning and implementation. A strong model designs the solution, a fast model writes the code.

```bash
/architect on                    # Enable architect mode
/architect model architect opus  # Use Opus for planning
/architect model coder sonnet    # Use Sonnet for coding
/architect plan "add OAuth"      # Just plan, don't code
```

### Watch Mode

Void monitors your files and automatically runs lint + tests when you make changes. Errors are fed back to the AI for self-correction.

```bash
/watch start                          # Start watching
/watch start --lint "npm run lint"    # Custom lint command
/watch start --test "npm test"        # Custom test command
/watch comments                       # Scan for // AI: comments
```

Put `// AI: fix this function` in your code and Void will see it.

### Workspace Checkpoints

Every file-modifying operation creates a checkpoint. You can view diffs and restore any previous state.

```bash
/checkpoint list             # Show all checkpoints
/checkpoint diff abc123      # View what changed
/checkpoint restore abc123   # Restore to that point
```

### Custom Commands

Create reusable prompt templates as `.md` files:

```bash
/cmd init                    # Create starter templates
/cmd list                    # List available commands
/cmd run review              # Run the review template
/cmd run git:commit          # Run nested command
```

Templates go in `~/.void/commands/` (global) or `.void/commands/` (project). Use `$PLACEHOLDER` for arguments.

### Tiered Permissions

Three safety levels:

```bash
/mode suggest      # Read-only — AI proposes changes, doesn't apply them
/mode auto-edit    # AI edits files freely, confirms shell commands
/mode full-auto    # Everything runs without confirmation
```

Set project defaults in `.void/config.json`:

```json
{ "permissionMode": "auto-edit" }
```

### .voidhints

Create `.voidhints` files at any directory level to guide the AI:

```bash
/hints init                    # Create a template
/hints init src/api/           # Create one for a subdirectory
/hints context src/api/auth.ts # See what context the AI gets
```

Hints are hierarchical — a `.voidhints` in `src/api/` inherits from the root `.voidhints`.

### Agent Council

Run multiple models in parallel and compare their responses:

```bash
/council duo     # Claude Opus + Sonnet
/council trinity # Claude + GPT-4o + Gemini
/council full    # All available models
```

### Edit Guardrails

Automatic syntax validation after every AI edit:

```bash
/guardrails on                     # Enable
/guardrails check src/main.ts      # Validate a file
/guardrails block vendor/           # Block a path from edits
```

### Output Compression

Save tokens on large command output:

```bash
/compress on                       # Enable compression
/compress strategy smart           # Smart (preserves errors, deduplicates)
/compress strategy summary         # Compact summary only
```

---

## Configuration

### Config locations

| Path | Purpose |
|------|---------|
| `~/.void/` | Global config directory |
| `~/.void/sessions/` | Saved sessions |
| `~/.void/checkpoints/` | Workspace checkpoints |
| `~/.void/commands/` | Global custom commands |
| `~/.void/memory/` | Knowledge graph data |
| `~/.void/repomap/` | Cached repo maps |
| `.void/` | Project-level config |
| `.void/commands/` | Project-level custom commands |
| `.void/config.json` | Project settings (permission mode, blocked paths) |
| `.voidhints` | Project/directory context for AI |
| `VOID.md` | Project instructions (read at session start) |

### Shell completions

```bash
# Bash
eval "$(void completion bash)"

# Zsh
eval "$(void completion zsh)"

# Fish
void completion fish | source
```

### Environment diagnostics

```bash
void /doctor-diag
```

Checks: Node.js version, Bun, Git, API keys, config directory, VOID.md, disk space, network connectivity.

---

## Architecture

Void is built on:

- **TypeScript** — End-to-end type safety
- **Bun** — Fast runtime and module resolution
- **Ink + React** — Terminal UI framework
- **Anthropic SDK** — Claude model integration
- **OpenAI Shim** — OpenRouter/non-Claude model support
- **MCP** — Model Context Protocol for tool extensibility

### Project structure

```
void-cli/
├── src/
│   ├── entrypoints/     # CLI entry point
│   ├── components/      # Ink/React UI components (ToolCard, SessionHUD, etc.)
│   ├── tools/           # Built-in tools (Bash, Edit, Read, Write, etc.)
│   ├── services/        # API clients, MCP, analytics
│   ├── utils/           # Shared utilities
│   ├── screens/         # REPL, Doctor, Resume screens
│   ├── architect/       # Architect mode (two-model pipeline)
│   ├── autocompact/     # Context window auto-compaction
│   ├── checkpoints/     # Workspace checkpoints (undo/redo)
│   ├── clarify/         # Pre-generation clarification
│   ├── commands/        # Slash command implementations
│   ├── completions/     # Shell completions + diagnostics
│   ├── compress/        # Output compression
│   ├── council/         # Multi-model agent council
│   ├── fileref/         # @-file reference parsing
│   ├── guardrails/      # Edit guardrails (syntax validation)
│   ├── hints/           # .voidhints hierarchical context
│   ├── integrations/    # GitHub, Slack, Notion
│   ├── memory/          # Knowledge graph memory
│   ├── permissions/     # Tiered permission modes
│   ├── repomap/         # Code indexing + reference ranking
│   ├── review/          # Multi-file diff review
│   ├── server/          # Headless HTTP server
│   ├── sessions/        # Session persistence
│   ├── thinking/        # Thinking mode
│   ├── visual/          # Charts, diagrams, tables
│   └── watch/           # File watcher + auto-lint/test
├── bin/
│   └── void             # Launcher script
└── package.json
```

---

## Development

```bash
# Full check (typecheck + lint + tests)
bun run check

# Individual steps
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint
bun run test        # vitest run

# Build (TypeScript compilation)
bun run build

# Run from source
bun run src/entrypoints/cli.tsx

# Run with debug logging
void --debug
```

---

## Testing

Void uses [vitest](https://vitest.dev) for its unit test suite and
[oxlint](https://oxc.rs) for linting. Tests and lint are wired into
CI — every push and pull request runs against Ubuntu and macOS.

```bash
# Run the full suite once
bun run test

# Watch mode while iterating
bun run test:watch

# Open the vitest UI in a browser
bun run test:ui

# Lint the TypeScript sources
bun run lint
```

Test files live alongside the code they cover, either as colocated
`*.test.ts` files or under a `__tests__/` directory. Current coverage
targets regression-critical behaviour rather than raw line coverage:

- `src/utils/model/__tests__/providers.test.ts` — env-var-driven API
  provider routing (Bedrock → Vertex → Foundry → OpenRouter → Anthropic).
- `src/council/__tests__/config.test.ts` — council preset shape
  (`duo`, `trinity`, `full`, `open-source`) and member weighting.
- `src/services/mcp/__tests__/config.test.ts` — MCP dedup by signature,
  CCR proxy URL unwrapping.
- `src/utils/settings/__tests__/validation.test.ts` — settings
  permission-rule validation and filtering.
- `src/entrypoints/__tests__/smoke.test.ts` — `bin/void --help`
  exits 0.

Tests run with `VOID_FEATURE_FLAGS=none` to skip feature-gated
`require()` branches that only resolve under Bun's build-time DCE.
Individual tests can opt back in by setting `process.env.VOID_FEATURE_FLAGS`
before importing the module under test.

---

## Feature Origins

Void's features are inspired by the best open-source AI coding tools:

| Feature | Inspired by |
|---------|-------------|
| Repo map (code indexing) | [aider](https://github.com/paul-gauthier/aider) |
| Architect mode | [aider](https://github.com/paul-gauthier/aider) |
| Watch mode + auto-lint/test | [aider](https://github.com/paul-gauthier/aider) |
| Workspace checkpoints | [Cline](https://github.com/cline/cline) |
| Custom commands (.md templates) | [opencode](https://github.com/opencode-ai/opencode) |
| Auto-compact context | [opencode](https://github.com/opencode-ai/opencode) |
| Session persistence | [opencode](https://github.com/opencode-ai/opencode) |
| Tiered permissions | [Codex CLI](https://github.com/openai/codex) |
| @-file references | [Kimi Code](https://www.kimi.com) |
| Thinking mode | [Kimi Code](https://www.kimi.com) |
| .voidhints context files | [Goose](https://github.com/block/goose) |
| Edit guardrails | [SWE-agent](https://github.com/princeton-nlp/SWE-agent) |
| Output compression | [SWE-agent](https://github.com/princeton-nlp/SWE-agent) |
| Multi-file diff review | [Zed](https://zed.dev) |
| Clarification questions | [GPT Engineer](https://github.com/AntonOsika/gpt-engineer) |
| Headless HTTP server | [opencode](https://github.com/opencode-ai/opencode) / [Continue](https://github.com/continuedev/continue) |

---

## License

Private. All rights reserved.

---

<p align="center">
  <strong>Void</strong> — the space between thought and code.
</p>
