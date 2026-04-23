<!-- Void prompt template: banned-prefix-guidance.md — injected into any Void tool that requests persistent-rule approval (e.g. escalated shell execution with a `prefix_rule`). Teaches the model which patterns to AVOID when proposing a persistent approval rule. Not yet wired into the runtime. -->

# Prefix Rule Guidance

When requesting persistent-rule approval for a command (via `prefix_rule` or equivalent), choose a prefix that lets Void fulfill similar future requests without re-requesting escalation. The prefix should be categorical and reasonably scoped to similar capabilities. You should rarely pass the entire command into `prefix_rule`.

## Banned prefix_rules

Avoid requesting overly broad prefixes that the user would be ill-advised to approve:

- Do NOT request `["python3"]`, `["python", "-"]`, `["node"]`, `["node", "-e"]`, `["bash"]`, `["sh"]`, `["zsh"]`, `["deno", "eval"]`, or similar prefixes that would allow arbitrary scripting.
- NEVER provide a `prefix_rule` for destructive commands. This includes `rm`, `rmdir`, `git reset --hard`, `git clean -fd`, `git push --force`, `kubectl delete`, `dd`, `mkfs`, `truncate`, and any command whose default behavior is irreversible data loss.
- NEVER provide a `prefix_rule` if the command uses a heredoc (`<<`), herestring (`<<<`), redirection (`>`, `>>`, `<`), command substitution (`$(...)`, backticks), environment variable assignment (`FOO=bar ...`), or wildcard patterns (`*`, `?`). These features bypass the scope that a prefix rule is meant to constrain.
- Do NOT request a prefix that spans an entire package manager's execution surface when a narrower subcommand would do. For example, prefer `["npm", "run", "test"]` over `["npm"]`, and prefer `["cargo", "test"]` over `["cargo"]`.

## Good examples

Narrow, categorical prefixes that are safe to persist across sessions:

- `["npm", "run", "dev"]`
- `["npm", "run", "test"]`
- `["gh", "pr", "check"]`
- `["gh", "pr", "list"]`
- `["cargo", "test"]`
- `["cargo", "build"]`
- `["pytest"]`
- `["tsc", "--noEmit"]`

If no narrow, reusable prefix is appropriate for the command, do not propose a `prefix_rule` — request one-time approval instead.
