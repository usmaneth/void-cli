/**
 * Tool detection: locate void/claude/codex/opencode on PATH and capture
 * their currently-installed versions.
 *
 * Used by `/measure` to drive cross-tool comparison. The point of recording
 * versions is so reports stay interpretable later — "void@2.1.94 lost to
 * claude@2.1.119 on cost" is actionable; "void lost to claude" is not.
 *
 * Detection uses `which` (or `where` on Windows) plus `<binary> --version`
 * with a short timeout. Tools that aren't installed are silently omitted
 * from the result; nothing here throws on a missing binary.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { TOOL_NAMES, type DetectedTool, type ToolName } from './types.js'

/** Per-tool env var override for explicit binary path. */
const TOOL_ENV_VARS: Record<ToolName, string> = {
  void: 'VOID_BIN',
  claude: 'CLAUDE_BIN',
  codex: 'CODEX_BIN',
  opencode: 'OPENCODE_BIN',
}

const VERSION_TIMEOUT_MS = 5_000

/** Run a command and capture stdout with a hard timeout. Never throws. */
async function runCapture(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string }> {
  return await new Promise(resolve => {
    let settled = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!settled) controller.abort()
    }, timeoutMs)

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: controller.signal,
      })
    } catch {
      clearTimeout(timer)
      settled = true
      resolve({ ok: false, stdout: '' })
      return
    }

    let out = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', c => {
      if (out.length < 4096) out += c
    })
    // Drain stderr so the child doesn't block on a full pipe.
    child.stderr?.on('data', () => {})

    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout: '' })
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout: out.trim() })
    })
  })
}

/**
 * Resolve a tool's binary path. Order:
 *  1. Per-tool env var (e.g. $VOID_BIN, $CLAUDE_BIN)
 *  2. For void only: `process.argv[1]` (the script that started this CLI)
 *  3. Shell `command -v <name>` lookup on PATH
 *
 * Returns null when nothing resolved or the resolved path doesn't exist.
 */
export async function resolveToolBinary(
  name: ToolName,
): Promise<string | null> {
  const envVar = TOOL_ENV_VARS[name]
  const envPath = process.env[envVar]
  if (envPath && envPath.length > 0 && existsSync(envPath)) {
    return envPath
  }
  // Self-resolution: when measuring void, prefer the binary we're already
  // running. This guarantees we measure THIS build of void rather than
  // whatever's on PATH (which might be a stale globally-installed copy).
  if (name === 'void' && process.argv[1] && existsSync(process.argv[1])) {
    return process.argv[1]
  }

  // PATH lookup via `command -v`. Avoids depending on `which` (not on every
  // PATH) and works on macOS/Linux. On Windows we fall back to spawning the
  // binary by name and trusting the OS to resolve.
  const cmd = process.platform === 'win32' ? 'where' : 'command'
  const args =
    process.platform === 'win32' ? [name] : ['-v', name]
  const got = await runCapture(cmd, args, 2_000)
  if (!got.ok) return null
  // `command -v` prints one path per line. `where` prints multiple. Take the
  // first non-empty line.
  const line = got.stdout
    .split('\n')
    .map(s => s.trim())
    .find(s => s.length > 0)
  if (!line) return null
  if (!existsSync(line)) return null
  return line
}

/** Capture the version string from `<binary> --version`. */
export async function captureToolVersion(binary: string): Promise<string> {
  const got = await runCapture(binary, ['--version'], VERSION_TIMEOUT_MS)
  if (!got.ok) return 'unknown'
  // Take the first line and trim — most tools emit a single version line.
  const first = got.stdout.split('\n')[0]
  return first?.trim() || 'unknown'
}

/** Detect a single tool. Returns null if not installed/resolvable. */
export async function detectTool(
  name: ToolName,
): Promise<DetectedTool | null> {
  const binary = await resolveToolBinary(name)
  if (!binary) return null
  const version = await captureToolVersion(binary)
  return { name, binary, version }
}

/**
 * Detect every known tool in parallel. Returns only those that resolved to
 * a real binary. The order in the returned array matches `TOOL_NAMES` so
 * report output is deterministic.
 */
export async function detectAllTools(): Promise<DetectedTool[]> {
  const results = await Promise.all(TOOL_NAMES.map(detectTool))
  // Filter nulls while preserving the canonical TOOL_NAMES order.
  return results.filter((t): t is DetectedTool => t !== null)
}

/**
 * Resolve a user-requested list of tool names to DetectedTool objects.
 * Tools that aren't installed are omitted and listed in `missing`.
 */
export async function resolveRequestedTools(
  names: ToolName[],
): Promise<{ found: DetectedTool[]; missing: ToolName[] }> {
  const found: DetectedTool[] = []
  const missing: ToolName[] = []
  await Promise.all(
    names.map(async name => {
      const t = await detectTool(name)
      if (t) found.push(t)
      else missing.push(name)
    }),
  )
  // Reorder `found` to match the requested order.
  const byName = new Map(found.map(t => [t.name, t]))
  const ordered = names
    .map(n => byName.get(n))
    .filter((t): t is DetectedTool => t !== undefined)
  return { found: ordered, missing }
}

/**
 * Validate a string against the known tool name list.
 * Used to filter user `--tools foo,bar,void` inputs.
 */
export function isToolName(s: string): s is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(s)
}
