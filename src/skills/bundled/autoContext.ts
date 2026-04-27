import { registerBundledSkill } from '../bundledSkills.js'

/**
 * Relative path (from the project root) where the auto-context addendum is
 * written. The `.claude/rules/` directory is auto-discovered by the memory
 * loader (`src/utils/voidmd.ts:910`), so any `.md` file placed here with the
 * correct frontmatter is folded into the system prompt on every session.
 */
export const AUTO_CONTEXT_RELATIVE_PATH = '.claude/rules/auto-context.md'

const AUTO_CONTEXT_PROMPT = `# Auto-Context: per-codebase prompt addendum

You are generating a compact, high-signal addendum that will be loaded into every future session in this repository. The goal is to give future-you (or any other agent) a 20-second orientation on how this project is built, tested, and shipped — without re-scanning the tree.

## Mode

The user may have passed \`--refresh\` to force regeneration. Read the args provided below.

- If args contain \`--refresh\`: regenerate unconditionally. Overwrite \`${AUTO_CONTEXT_RELATIVE_PATH}\` if it exists.
- Otherwise: check if \`${AUTO_CONTEXT_RELATIVE_PATH}\` already exists. If it does, STOP. Report that the file exists and suggest the user pass \`--refresh\` to rebuild. Do not regenerate.

## Budget (hard limits)

- Read at most **30 files**. No exceptions.
- Emitted file size: **≤ 3 KB**. Aim for 1.5-2 KB.
- Run git commands sparingly. Three or four calls total is plenty.

## Detection steps

Execute in this order. Skip any step where the evidence is absent — do not speculate.

1. **Stack** — glob for manifest files at the repo root:
   \`package.json\`, \`pnpm-workspace.yaml\`, \`bun.lock\`, \`Cargo.toml\`, \`go.mod\`, \`pyproject.toml\`, \`requirements.txt\`, \`Gemfile\`, \`composer.json\`, \`build.gradle*\`, \`pom.xml\`, \`mix.exs\`, \`Package.swift\`. Read the ones that exist. Note language, runtime (node vs bun vs deno), and top-level frameworks declared as dependencies.
2. **Testing** — grep configs for test frameworks: \`vitest\`, \`jest\`, \`mocha\`, \`pytest\`, \`cargo test\`, \`go test\`, \`rspec\`, etc. Check \`package.json\` scripts for a \`test\` entry. Record the exact command.
3. **Linting / Formatting** — look for \`.eslintrc*\`, \`oxlint.*\`, \`biome.json*\`, \`.prettierrc*\`, \`ruff.toml\`, \`rustfmt.toml\`, \`.golangci.*\`. Record which tool runs and the exact command (usually from \`package.json\` scripts).
4. **Build** — identify the build command from scripts or build configs. Node projects usually have \`build\` or \`dev\` scripts; Rust uses \`cargo build\`; Go uses \`go build\`.
5. **Commit style** — run \`git log --oneline -20\` (or \`-30\` if short). Observe: conventional commits (\`feat:\`, \`fix:\`)? Sentence case? Title length? Ticket prefixes? One example line is worth ten words of description.
6. **Layout** — list the top-level directories (no recursion). Briefly note what each contains based on obvious names (e.g. "src/ — source", "packages/ — workspace packages"). Skip node_modules, .git, dist, build, target.
7. **Gotchas** — only include items you can cite directly from a config or source file. Examples: "uses bun, not node, for scripts", "monorepo with pnpm workspaces", "Vite 7 with SolidJS", "TypeScript strict mode via tsconfig extends". If you are guessing, leave it out.

## Output format

Write exactly this to \`${AUTO_CONTEXT_RELATIVE_PATH}\`. Use Write, not Edit. The frontmatter is required — the loader parses it.

\`\`\`markdown
---
name: Auto-generated codebase context
description: Per-repo stack/tooling/commit-style addendum. Regenerate with /auto-context --refresh.
paths: ["**/*"]
---

# Auto-Context

Generated: <YYYY-MM-DD>.

## Stack
- <one line per item>

## Testing
- <framework>
- Command: \\\`<exact command>\\\`

## Linting / Formatting
- <tool>
- Command: \\\`<exact command>\\\`

## Build
- Command: \\\`<exact command>\\\`

## Commit style
- <one-line characterization>
- Example: \\\`<paste one real commit subject>\\\`

## Layout
- \\\`<dir>/\\\` — <one-line purpose>

## Gotchas
- <only items with direct evidence>
\`\`\`

Sections with no evidence should be written as \`- (none detected)\` — do not omit the heading, and do not invent content.

## Finishing

After writing, respond with a two- or three-line summary: what was detected, file path written, next step (if any). Do not repeat the file contents back to the user.
`

export function registerAutoContextSkill(): void {
  registerBundledSkill({
    name: 'auto-context',
    description:
      'Scan the current repo and write a compact per-codebase addendum to .claude/rules/auto-context.md (stack, testing, linting, build, commit style, layout). Auto-loaded on every future session.',
    whenToUse:
      'Run once when entering a new codebase to give future sessions a quick orientation. Pass --refresh to regenerate after substantial changes to tooling or structure.',
    argumentHint: '[--refresh]',
    userInvocable: true,
    // Keep the scout in a forked subagent so its 30 file reads and git calls
    // don't pollute the parent conversation's context.
    context: 'fork',
    async getPromptForCommand(args) {
      const trimmed = args.trim()
      const header = trimmed
        ? `## Invocation args\n\n\`${trimmed}\`\n\n`
        : '## Invocation args\n\n(none)\n\n'
      return [{ type: 'text', text: header + AUTO_CONTEXT_PROMPT }]
    },
  })
}
