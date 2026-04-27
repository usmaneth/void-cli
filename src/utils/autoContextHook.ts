/**
 * SessionStart hook that nudges the user to run /auto-context when the
 * per-codebase addendum is missing. This is a purely declarative hint — no
 * file I/O beyond a single stat, and no subagent spawn. The actual scout runs
 * only when the user (or model) invokes the skill.
 *
 * Why a hook and not a synchronous startup check: sessionStart.ts explicitly
 * forbids warmup logic. A callback hook scoped to SessionStart runs after the
 * session is already live, so it doesn't delay startup and only fires when
 * the hook infrastructure is already iterating event handlers.
 */
import { stat } from 'fs/promises'
import { join } from 'path'
import { registerHookCallbacks } from '../bootstrap/state.js'
import type { HookInput, HookJSONOutput } from '../entrypoints/agentSdkTypes.js'
import type { HookCallback } from '../types/hooks.js'
import { getCwd } from './cwd.js'
import { AUTO_CONTEXT_RELATIVE_PATH } from '../skills/bundled/autoContext.js'

const HINT_MESSAGE = [
  `No per-codebase auto-context found (\`${AUTO_CONTEXT_RELATIVE_PATH}\` is missing).`,
  '',
  'If the user is starting work in this repo and you need an orientation on its stack, testing, linting, build, or commit style, suggest running `/auto-context` — it scans the repo once and caches a compact addendum that is auto-loaded in every future session.',
  '',
  'This is a one-time setup hint. Do not run `/auto-context` automatically; only surface it if the user asks "what does this project use" or similar, or if you are about to make non-trivial changes and would benefit from the orientation.',
].join('\n')

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function handleAutoContextSessionStart(
  input: HookInput,
  _toolUseID: string | null,
  _abort: AbortSignal | undefined,
): Promise<HookJSONOutput> {
  if (input.hook_event_name !== 'SessionStart') return {}

  // Only fire on a fresh startup — not on /clear, /compact, or resume. Those
  // paths already re-read memory from disk, so the hint would be redundant,
  // and we want to avoid spamming additionalContext on every rewake.
  if (input.source !== 'startup') return {}

  const cwd = getCwd()
  const targetPath = join(cwd, AUTO_CONTEXT_RELATIVE_PATH)

  if (await fileExists(targetPath)) {
    // File exists, auto-loaded via .claude/rules/ plumbing. Nothing to do.
    return {}
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: HINT_MESSAGE,
    },
  }
}

/**
 * Register the auto-context SessionStart nudge. Called during CLI
 * initialization alongside other internal callbacks.
 */
export function registerAutoContextHook(): void {
  const hook: HookCallback = {
    type: 'callback',
    callback: handleAutoContextSessionStart,
    timeout: 1, // file stat only; 1s is plenty
    internal: true,
  }

  registerHookCallbacks({
    SessionStart: [{ hooks: [hook] }],
  })
}
