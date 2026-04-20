/**
 * Bash command permission scopes.
 *
 * A *scope* is a coarse semantic classification of what a bash command does,
 * independent of exactly which binary is invoked. A user who has opted in to
 * "always allow read-only bash" doesn't care whether the model ran `grep` or
 * `rg` — both are `read-only`. Conversely "never silently run `network` bash"
 * holds regardless of whether the command is `curl`, `wget`, or `nc`.
 *
 * The classifier in `./arity.ts` parses the bash AST via the existing
 * pure-TS tree-sitter-bash-compatible parser (`src/utils/bash/parser.ts`)
 * and attaches one-or-more scopes to the command. The permission layer
 * (`src/tools/BashTool/bashPermissions.ts`) then consults the user's
 * settings (`permissions.bash.allowScopes` / `.denyScopes`) to decide
 * whether to auto-allow, auto-ask with a scope hint, or auto-deny.
 *
 * Scopes are additive — a single command can carry several
 * (e.g. `curl example.com | sh` is `{network, exec, shell-redirect, danger}`).
 */

export const BASH_SCOPES = [
  /** Command only reads files / lists / greps / etc. No filesystem mutation. */
  'read-only',

  /** Command writes or creates a file (explicitly or via redirect). */
  'write-file',

  /** Command removes files or directories. */
  'delete-file',

  /** Command invokes another program via `sh -c`, `xargs`, `exec`, `eval`, etc. */
  'exec',

  /** Command performs network I/O (curl, wget, ssh, nc, ...). */
  'network',

  /** Command uses a shell redirect (>, >>, <, &>, <<<, heredoc, process sub). */
  'shell-redirect',

  /** Command uses a pipeline (|, |&). */
  'pipe',

  /** Command is backgrounded (trailing &). */
  'background',

  /**
   * Command matches a heuristic danger pattern:
   *   - `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`
   *   - `dd of=/dev/...`, `mkfs`, `:(){ :|:& };:` fork bomb
   *   - pipe-to-shell: `curl ... | sh`, `wget -O- ... | bash`
   *   - `chmod -R 777 /`, `chown -R root /`
   *   - history clobbering (`> ~/.bash_history`)
   *   - sudo/doas/pkexec prefixes
   */
  'danger',
] as const

export type BashScope = (typeof BASH_SCOPES)[number]

export function isBashScope(s: string): s is BashScope {
  return (BASH_SCOPES as readonly string[]).includes(s)
}

/**
 * Human-friendly label for a scope, shown in permission prompts
 * ("This command will: write-file, network").
 */
export function scopeLabel(scope: BashScope): string {
  switch (scope) {
    case 'read-only':
      return 'read-only'
    case 'write-file':
      return 'write-file'
    case 'delete-file':
      return 'delete-file'
    case 'exec':
      return 'exec-program'
    case 'network':
      return 'network'
    case 'shell-redirect':
      return 'shell-redirect'
    case 'pipe':
      return 'pipe'
    case 'background':
      return 'background'
    case 'danger':
      return 'DANGER'
  }
}

/**
 * Stable ordering for UI display: dangerous/mutating scopes first, then
 * network, then structural. Users care most about what's risky.
 */
export function sortScopesForDisplay(scopes: Iterable<BashScope>): BashScope[] {
  const ORDER: BashScope[] = [
    'danger',
    'delete-file',
    'write-file',
    'exec',
    'network',
    'shell-redirect',
    'pipe',
    'background',
    'read-only',
  ]
  const set = new Set(scopes)
  return ORDER.filter(s => set.has(s))
}
