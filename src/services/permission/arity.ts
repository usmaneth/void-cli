/**
 * Bash command *arity* classifier — infers a set of semantic {@link BashScope}s
 * from a bash command string by walking the tree-sitter-bash AST.
 *
 * Inspired by opencode's `permission/arity.ts` (which maps command prefixes to
 * token arities), extended to extract scopes (`read-only`, `write-file`,
 * `network`, `exec`, `danger`, ...) the permission layer can pattern-match
 * against user-defined allow/deny lists.
 *
 * The classifier is intentionally over-inclusive on the risky side — if a
 * command's scope is ambiguous, it gets `exec` (requires prompt) rather than
 * `read-only` (may auto-allow). When the parser fails entirely, the
 * {@link classifyArity} result carries `parseFailed: true` and **no scopes**,
 * which callers MUST treat as "prompt everything" (fail-closed).
 *
 * Performance: parses are cached LRU — see {@link classifyArity} cache below.
 */

import { PARSE_ABORTED, parseCommandRaw, type Node } from '../../utils/bash/parser.js'
import type { BashScope } from './scopes.js'

// ───────────────────────────── Public types ─────────────────────────────

export interface ArityResult {
  /** Set of scopes the command was classified with. Empty only if parse failed. */
  scopes: Set<BashScope>
  /** True if any command in the pipeline/list mutates the filesystem. */
  mutatesFs: boolean
  /** True if any command performs network I/O. */
  hasNetwork: boolean
  /** True if any command invokes another program (sh -c, xargs, exec, eval). */
  hasExec: boolean
  /**
   * Best-effort list of filesystem paths referenced by commands
   * (argv arguments that look like paths, plus redirect targets).
   * Never exhaustive — don't rely on this for security, only UI hints.
   */
  targetPaths: string[]
  /**
   * True if the tree-sitter parse failed or was aborted. Callers MUST
   * fall back to "prompt everything" when this is set.
   */
  parseFailed: boolean
  /**
   * First command name encountered (argv[0] of the first command node).
   * Used by the UI for short labels ("grep" rather than the full command).
   */
  primaryCommand?: string
}

// ───────────────────────── Command classifier tables ─────────────────────────
// Maps a bare command name to the set of scopes it implies. Tables below are
// non-exhaustive by design — unknown commands default to `exec` (prompt).
//
// SAFETY CONTRACT:
//   • If a command is in READ_ONLY_COMMANDS it gets {read-only}.
//   • If in WRITE_COMMANDS it gets {write-file}.
//   • If in DELETE_COMMANDS it gets {delete-file} and {write-file}.
//   • If in NETWORK_COMMANDS it gets {network}.
//   • If in EXEC_WRAPPERS it gets {exec} — and its argument command is classified recursively.
//   • Anything unknown → {exec} (conservative; means "we don't know → prompt").

/** Pure readers: no filesystem mutation. */
const READ_ONLY_COMMANDS = new Set<string>([
  // file readers
  'cat', 'head', 'tail', 'less', 'more', 'file', 'stat', 'wc', 'md5sum',
  'sha1sum', 'sha256sum', 'sha512sum', 'cksum', 'base64',
  // listings/nav
  'ls', 'll', 'la', 'dir', 'pwd', 'tree', 'readlink', 'realpath',
  'basename', 'dirname', 'which', 'whereis', 'command', 'type',
  'whoami', 'id', 'groups', 'hostname', 'uname', 'tty', 'date',
  // search
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'locate',
  // diff/inspect
  'diff', 'cmp', 'comm', 'colordiff',
  // processes/monitoring
  'ps', 'top', 'htop', 'pgrep', 'pstree', 'jobs', 'lsof', 'fuser',
  'df', 'du', 'free', 'uptime', 'w', 'who', 'last', 'env', 'printenv',
  // text processing (non-mutating when not redirected)
  'awk', 'gawk', 'sort', 'uniq', 'cut', 'paste', 'tr', 'rev', 'fold',
  'column', 'nl', 'expand', 'unexpand', 'tac',
  // git read-only (most git subcommands are read-only; write gets special-cased)
  // handled via GIT_WRITE_SUBCOMMANDS below
  // misc
  'echo', 'printf', 'true', 'false', 'yes', 'sleep', 'seq', 'test', '[',
  'getconf', 'locale', 'readelf', 'nm', 'strings', 'objdump', 'hexdump',
  'xxd', 'od',
])

/** Commands that create / modify / move files. */
const WRITE_COMMANDS = new Set<string>([
  'touch', 'mkdir', 'cp', 'mv', 'ln', 'install',
  'chmod', 'chown', 'chgrp', 'chattr', 'setfacl',
  'sed', // typically with -i or redirect
  'tee', 'dd',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz',
  '7z', '7za',
  'patch',
  'truncate',
  // package managers modify system state
  'apt', 'apt-get', 'dpkg', 'yum', 'dnf', 'pacman', 'zypper', 'apk', 'snap',
  'brew', 'port', 'flatpak',
  // language package managers modify node_modules/site-packages/etc.
  // (most users want to prompt on these anyway, but they're write-scope)
])

/** Commands that explicitly delete things. */
const DELETE_COMMANDS = new Set<string>([
  'rm', 'rmdir', 'unlink', 'shred',
])

/** Commands that perform network I/O. */
const NETWORK_COMMANDS = new Set<string>([
  'curl', 'wget', 'fetch', 'http', 'httpie',
  'ssh', 'scp', 'sftp', 'rsync', 'rclone',
  'nc', 'ncat', 'netcat', 'socat', 'telnet', 'ftp',
  'ping', 'ping6', 'traceroute', 'tracepath', 'mtr',
  'nslookup', 'dig', 'host', 'whois',
  'git', // git fetch/push/clone are network — see GIT_* below
  'gh', // GitHub CLI — hits api.github.com
  'npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'cargo', 'go', 'gem',
  // ^ package installs hit a registry. "go build" is local but "go mod
  //   download" / "go get" network. Conservative: tag the whole family.
  'docker', 'podman', // pull/push hit registries
  'kubectl', 'helm', 'terraform', // usually hit APIs
  'aws', 'gcloud', 'az', // cloud CLIs
])

/**
 * Commands whose first non-flag argument is itself a command to be
 * exec'd. Classifying these requires recursing into the wrapped command.
 *
 * The value is the 0-based index into the *stripped* (flags removed) argv
 * where the wrapped command starts. -1 means "just take everything after flags".
 */
const EXEC_WRAPPERS = new Map<string, number>([
  ['sudo', -1],
  ['doas', -1],
  ['pkexec', -1],
  ['env', -1],
  ['nohup', -1],
  ['nice', -1],
  ['stdbuf', -1],
  ['timeout', 1], // timeout DURATION CMD ARGS...
  ['time', -1],
  ['xargs', -1],
  ['exec', -1],
])

/** Commands that evaluate or execute user-provided code strings. */
const EVAL_COMMANDS = new Set<string>([
  'eval', 'source', '.', 'exec', 'trap',
])

/** Shells — first arg after flags is often `-c 'code'`. */
const SHELLS = new Set<string>([
  'sh', 'bash', 'zsh', 'fish', 'ksh', 'dash', 'csh', 'tcsh',
  'ash', 'busybox',
])

/** git subcommands that write to the repo / network. */
const GIT_WRITE_SUBCOMMANDS = new Set<string>([
  'add', 'commit', 'merge', 'rebase', 'cherry-pick', 'reset', 'revert',
  'checkout', 'switch', 'restore', 'branch', 'tag', 'mv', 'rm',
  'stash', 'apply', 'am', 'bisect', 'clean', 'gc', 'prune',
  'update-ref', 'update-index', 'write-tree', 'commit-tree',
  'init', 'clone',
])
const GIT_NETWORK_SUBCOMMANDS = new Set<string>([
  'push', 'pull', 'fetch', 'clone', 'remote',
  'ls-remote', 'submodule',
])

// ───────────────────────── AST node type helpers ─────────────────────────

const COMMAND_TYPES = new Set(['command', 'declaration_command'])

// ───────────────────────── Core classifier ─────────────────────────

/**
 * LRU-ish cache: we memoize on the command string. Keyed simply by string
 * because the classifier result is a function of input only; environment /
 * cwd does not change classification. Bounded to avoid runaway growth in
 * long sessions.
 */
const ARITY_CACHE = new Map<string, ArityResult>()
const MAX_CACHE_ENTRIES = 512

function cacheGet(command: string): ArityResult | undefined {
  const hit = ARITY_CACHE.get(command)
  if (hit === undefined) return undefined
  // LRU bump
  ARITY_CACHE.delete(command)
  ARITY_CACHE.set(command, hit)
  return hit
}

function cacheSet(command: string, result: ArityResult): void {
  if (ARITY_CACHE.size >= MAX_CACHE_ENTRIES) {
    // delete oldest
    const firstKey = ARITY_CACHE.keys().next().value
    if (firstKey !== undefined) ARITY_CACHE.delete(firstKey)
  }
  ARITY_CACHE.set(command, result)
}

export function clearArityCache(): void {
  ARITY_CACHE.clear()
}

/**
 * Classify a bash command string into a set of {@link BashScope}s.
 *
 * SAFETY: if the parse fails (tree-sitter unavailable, timeout, etc.), the
 * returned `parseFailed` is true and `scopes` is empty. Callers MUST treat
 * that as "prompt, don't auto-allow". The caller that actually implements
 * scope-based auto-allow is {@link shouldAutoAllowByScope} below.
 */
export async function classifyArity(command: string): Promise<ArityResult> {
  const trimmed = command.trim()
  if (!trimmed) {
    return {
      scopes: new Set(),
      mutatesFs: false,
      hasNetwork: false,
      hasExec: false,
      targetPaths: [],
      parseFailed: false,
    }
  }
  const cached = cacheGet(trimmed)
  if (cached) return cached

  const root = await parseCommandRaw(trimmed)
  if (root === null || root === PARSE_ABORTED) {
    const r: ArityResult = {
      scopes: new Set(),
      mutatesFs: false,
      hasNetwork: false,
      hasExec: false,
      targetPaths: [],
      parseFailed: true,
    }
    cacheSet(trimmed, r)
    return r
  }

  const scopes = new Set<BashScope>()
  const paths: string[] = []
  let primary: string | undefined
  let sawCommand = false

  const visit = (node: Node): void => {
    const type = node.type

    // Pipelines contribute the `pipe` scope.
    if (type === 'pipeline') {
      scopes.add('pipe')
    }

    // `&` trailing → background.
    if (type === '&' || (type === 'list' && hasAsyncTerminator(node))) {
      scopes.add('background')
    }

    // Command substitution `$(...)` / backticks — treat the inner like a
    // separate command; it's literally an `exec` from the outer shell's POV.
    if (type === 'command_substitution' || type === 'process_substitution') {
      scopes.add('exec')
    }

    // Redirects: scan the redirect node's operator children.
    if (
      type === 'redirected_statement' ||
      type === 'file_redirect' ||
      type === 'heredoc_redirect' ||
      type === 'herestring_redirect'
    ) {
      scopes.add('shell-redirect')
      classifyRedirect(node, scopes, paths)
    }

    if (type === 'heredoc_redirect' || type === 'heredoc_body') {
      scopes.add('shell-redirect')
    }

    if (COMMAND_TYPES.has(type)) {
      const argv = commandArgv(node)
      if (argv.length > 0) {
        if (!sawCommand) {
          primary = argv[0]
          sawCommand = true
        }
        classifyCommand(argv, scopes, paths)
      }
    }

    for (const child of node.children) visit(child)
  }

  visit(root)

  // If we never saw any command node and didn't fail to parse, treat as
  // empty program — no scopes.
  if (!sawCommand && !scopes.has('exec') && scopes.size === 0) {
    const r: ArityResult = {
      scopes: new Set(),
      mutatesFs: false,
      hasNetwork: false,
      hasExec: false,
      targetPaths: [],
      parseFailed: false,
      primaryCommand: primary,
    }
    cacheSet(trimmed, r)
    return r
  }

  // If we saw a command but couldn't classify it (no read/write/network tags),
  // fall back to `exec`. This is the key safety fallback for unknown binaries.
  if (
    sawCommand &&
    !scopes.has('read-only') &&
    !scopes.has('write-file') &&
    !scopes.has('delete-file') &&
    !scopes.has('network') &&
    !scopes.has('exec')
  ) {
    scopes.add('exec')
  }

  // Danger heuristics, applied last so they see the full scope set.
  applyDangerHeuristics(trimmed, scopes)

  const result: ArityResult = {
    scopes,
    mutatesFs: scopes.has('write-file') || scopes.has('delete-file'),
    hasNetwork: scopes.has('network'),
    hasExec: scopes.has('exec'),
    targetPaths: dedupe(paths),
    parseFailed: false,
    primaryCommand: primary,
  }
  cacheSet(trimmed, result)
  return result
}

// ───────────────────────── Node helpers ─────────────────────────

function hasAsyncTerminator(listNode: Node): boolean {
  // list children look like: cmd `&` cmd `&`. A trailing `&` makes the
  // preceding command async. We only care that some `&` operator exists.
  return listNode.children.some(c => c.type === '&')
}

/** Extract argv from a command/declaration_command node, with quotes stripped. */
function commandArgv(cmdNode: Node): string[] {
  const argv: string[] = []
  for (const child of cmdNode.children) {
    const t = child.type
    if (t === 'variable_assignment') continue // leading env vars
    if (t === 'command_name' || t === 'word' || t === 'number') {
      argv.push(stripQuotes(child.text))
    } else if (t === 'string' || t === 'raw_string') {
      argv.push(stripQuotes(child.text))
    } else if (t === 'concatenation') {
      argv.push(stripQuotes(child.text))
    }
    // We stop scanning into substitutions — they're handled via recursion in visit().
  }
  return argv
}

function stripQuotes(text: string): string {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1)
  }
  return text
}

/** Mutates `scopes` and `paths` from a redirect subtree. */
function classifyRedirect(node: Node, scopes: Set<BashScope>, paths: string[]): void {
  // Walk children to find redirect operators + targets.
  for (const child of node.children) {
    const t = child.type
    if (t === '>' || t === '>>' || t === '&>' || t === '&>>' || t === '>|') {
      scopes.add('write-file')
      scopes.add('shell-redirect')
    } else if (t === '<<<') {
      scopes.add('shell-redirect')
    } else if (t === '<' || t === '<<' || t === '<&' || t === '>&') {
      scopes.add('shell-redirect')
    } else if (t === 'word' || t === 'string' || t === 'raw_string') {
      const target = stripQuotes(child.text)
      if (target) paths.push(target)
    }
  }
}

/** Classify a single command's argv into scopes. */
function classifyCommand(
  argv: string[],
  scopes: Set<BashScope>,
  paths: string[],
): void {
  const name = bareCommandName(argv[0] ?? '')
  if (!name) return

  // Shell with `-c CODE`: classify CODE as embedded exec.
  if (SHELLS.has(name)) {
    scopes.add('exec')
    // Don't recurse into the -c string here — parser already sees it as a
    // string literal. A separate scan of the string could parse it, but
    // we conservatively tag exec and let the caller prompt.
    return
  }

  // Eval-like builtins.
  if (EVAL_COMMANDS.has(name)) {
    scopes.add('exec')
    return
  }

  // Exec wrappers: strip wrapper flags / env assignments and classify the wrapped command.
  if (EXEC_WRAPPERS.has(name)) {
    scopes.add('exec')
    const wrappedStart = findWrappedCommandStart(name, argv)
    if (wrappedStart < argv.length) {
      classifyCommand(argv.slice(wrappedStart), scopes, paths)
    }
    return
  }

  // git is a special hybrid.
  if (name === 'git') {
    const sub = argv.slice(1).find(a => !a.startsWith('-'))
    if (sub) {
      if (GIT_NETWORK_SUBCOMMANDS.has(sub)) scopes.add('network')
      if (GIT_WRITE_SUBCOMMANDS.has(sub)) {
        scopes.add('write-file')
      } else {
        scopes.add('read-only')
      }
    } else {
      scopes.add('read-only') // bare `git` just prints help
    }
    // git always execs a subprocess
    scopes.add('exec')
    return
  }

  if (READ_ONLY_COMMANDS.has(name)) {
    scopes.add('read-only')
    collectArgPaths(argv, paths)
    // sed -i mutates in-place.
    if (name === 'sed' && argv.some(a => a === '-i' || /^-i/.test(a))) {
      scopes.delete('read-only')
      scopes.add('write-file')
    }
    return
  }
  if (DELETE_COMMANDS.has(name)) {
    scopes.add('delete-file')
    scopes.add('write-file')
    collectArgPaths(argv, paths)
    return
  }
  if (WRITE_COMMANDS.has(name)) {
    scopes.add('write-file')
    collectArgPaths(argv, paths)
    return
  }
  if (NETWORK_COMMANDS.has(name)) {
    scopes.add('network')
    scopes.add('exec')
    return
  }

  // Unknown: conservative `exec`.
  scopes.add('exec')
}

function bareCommandName(raw: string): string {
  // Strip path (`/usr/bin/curl` → `curl`), strip trailing `:` ENV quirks.
  const noPath = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  return noPath.trim()
}

const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

function findWrappedCommandStart(wrapper: string, argv: string[]): number {
  // Skip flags on the wrapper.
  let i = 1
  while (i < argv.length) {
    const a = argv[i] ?? ''
    // `env` and `sudo` accept KEY=value assignments before the command.
    if ((wrapper === 'env' || wrapper === 'sudo') && ENV_ASSIGN_RE.test(a)) {
      i++
      continue
    }
    if (!a.startsWith('-')) break
    // Some wrapper flags take an argument: sudo -u USER, timeout -k TIME.
    if (wrapper === 'sudo' && (a === '-u' || a === '-g' || a === '-p')) {
      i += 2
      continue
    }
    if (wrapper === 'timeout' && (a === '-k' || a === '-s')) {
      i += 2
      continue
    }
    if (wrapper === 'xargs' && (a === '-I' || a === '-L' || a === '-n')) {
      i += 2
      continue
    }
    if (wrapper === 'env' && a === '-i') {
      i++
      continue
    }
    i++
  }
  if (wrapper === 'timeout' && i < argv.length) {
    // skip DURATION
    i++
  }
  return i
}

function collectArgPaths(argv: string[], paths: string[]): void {
  // Very loose heuristic: non-flag args with a `.`, `/`, or that are recognizably
  // a filename. Not exhaustive; UI hint only.
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a.startsWith('-')) continue
    if (a.includes('/') || a.includes('.') || a === '.' || a === '..') {
      paths.push(a)
    }
  }
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

// ───────────────────────── Danger heuristics ─────────────────────────

/**
 * Pattern-match extra-dangerous constructs the token-level classifier
 * wouldn't catch on its own. Runs on the *original* command string because
 * some of these (pipe-to-shell, fork bombs) are about the textual shape.
 */
function applyDangerHeuristics(command: string, scopes: Set<BashScope>): void {
  const c = command

  // rm -rf / targeting catastrophic paths.
  if (
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr|--recursive\s+--force|--force\s+--recursive)\b/.test(c) &&
    /\s(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/.test(c)
  ) {
    scopes.add('danger')
  }

  // pipe-to-shell: `curl … | sh`, `wget -O- … | bash`, etc.
  if (
    scopes.has('pipe') &&
    scopes.has('network') &&
    /\|\s*(sh|bash|zsh|fish|ksh|dash)\b/.test(c)
  ) {
    scopes.add('danger')
  }

  // dd writing to a block device.
  if (/\bdd\s+[^|&;]*of\s*=\s*\/dev\//.test(c)) {
    scopes.add('danger')
    scopes.add('write-file')
  }

  // mkfs / fdisk — destroy-fs class.
  if (/\b(mkfs(\.[a-z0-9]+)?|fdisk|parted|wipefs)\b/.test(c)) {
    scopes.add('danger')
    scopes.add('write-file')
  }

  // Fork bomb.
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;\s*:/.test(c)) {
    scopes.add('danger')
    scopes.add('exec')
  }

  // chmod 777 anywhere recursive.
  if (/\bchmod\s+(-R\s+)?[0-7]*7[0-7]*7[0-7]*7\b/.test(c)) {
    scopes.add('danger')
  }

  // Privilege escalation prefixes.
  if (/^\s*(sudo|doas|pkexec)\b/.test(c)) {
    scopes.add('danger')
    scopes.add('exec')
  }

  // Clobbering shell init / history files.
  if (/>\s*~\/(\.bash_history|\.zsh_history|\.bashrc|\.zshrc|\.profile)\b/.test(c)) {
    scopes.add('danger')
  }

  // `curl | sudo bash`, etc.
  if (/\|\s*sudo\s+(sh|bash|zsh)\b/.test(c)) {
    scopes.add('danger')
  }
}

// ───────────────────────── Allow/deny policy ─────────────────────────

export interface ScopePolicy {
  allowScopes?: readonly BashScope[]
  denyScopes?: readonly BashScope[]
}

/**
 * Decide whether a given {@link ArityResult} should auto-allow, auto-deny,
 * or prompt based on the user's policy.
 *
 *   - If any inferred scope is in `denyScopes` → 'deny'.
 *   - Else if the command parsed AND every inferred scope is in `allowScopes` → 'allow'.
 *   - Else 'prompt'.
 *
 * Empty `allowScopes` means no auto-allow (everything prompts, modulo deny).
 * Failed-parse (`parseFailed: true`) always returns 'prompt' — even if
 * allowScopes is very permissive — because we can't prove what the command is.
 */
export function evaluateScopePolicy(
  arity: ArityResult,
  policy: ScopePolicy,
): 'allow' | 'deny' | 'prompt' {
  if (arity.parseFailed) return 'prompt'
  if (arity.scopes.size === 0) return 'prompt'

  const deny = new Set(policy.denyScopes ?? [])
  for (const s of arity.scopes) {
    if (deny.has(s)) return 'deny'
  }
  // 'danger' scope is NEVER auto-allowed, even if explicitly listed.
  if (arity.scopes.has('danger')) return 'prompt'

  const allow = new Set(policy.allowScopes ?? [])
  if (allow.size === 0) return 'prompt'

  for (const s of arity.scopes) {
    if (!allow.has(s)) return 'prompt'
  }
  return 'allow'
}

/**
 * Convenience: classify + apply policy in one call.
 * Returns {decision, arity} so callers can use the scope set for UI labels.
 */
export async function shouldAutoAllowByScope(
  command: string,
  policy: ScopePolicy,
): Promise<{ decision: 'allow' | 'deny' | 'prompt'; arity: ArityResult }> {
  const arity = await classifyArity(command)
  return { decision: evaluateScopePolicy(arity, policy), arity }
}
