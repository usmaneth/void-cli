// Wake-scheduler for /loop dynamic mode (self-paced loops).
//
// The model calls ScheduleWakeupTool at end-of-turn with {delaySeconds,
// reason, prompt}. The tool's call() forwards to scheduleLoopWakeup() here,
// which:
//   1. Clamps delaySeconds to [MIN_DELAY_SECONDS, MAX_DELAY_SECONDS]
//   2. Cancels any prior pending wakeup (only ONE loop at a time)
//   3. Starts a setTimeout that, on fire, enqueues `prompt` as a new user
//      turn via enqueuePendingNotification — identical to the cron path
//      (useScheduledTasks.ts) which already knows how to deliver prompts
//      back into the REPL main loop.
//
// Design decisions:
//   - Global singleton state (module-level). Only one dynamic loop active
//     at a time — mirrors the 2.1.118 bundle which maintains a single
//     "current loop" record.
//   - setTimeout instead of cron. The 2.1.118 bundle bridges through the
//     cron system (scheduleLoopWakeup → cron task with a one-off minute
//     expression). We take the simpler in-memory timer path because
//     wakeups are session-scoped and never need to survive restarts.
//   - enqueuePendingNotification (priority: 'later') so a user typing
//     while the timer fires takes precedence — mirrors cron behavior.
//   - WORKLOAD_CRON workload tag — the billing-header attribution block
//     treats self-paced /loop ticks the same as cron-driven ones.
//   - The gate function isLoopDynamicEnabled() returns true only when
//     BOTH (a) the KAIROS_LOOP_DYNAMIC feature flag is on AND (b) a
//     /loop dynamic session is actively armed (enableLoopDynamic was
//     called). This is stricter than the 2.1.118 bundle's check (flag
//     alone) so a stray ScheduleWakeup call outside /loop no-ops cleanly.

import { feature } from '../bun-bundle-shim.js'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  MAX_DELAY_SECONDS,
  MIN_DELAY_SECONDS,
} from '../tools/ScheduleWakeupTool/constants.js'
import { logForDebugging } from './debug.js'
import { enqueuePendingNotification } from './messageQueueManager.js'
import { WORKLOAD_CRON } from './workloadContext.js'

type ActiveLoop = {
  /** Active /loop prompt — re-submitted when the timer fires. */
  prompt: string
  /** Most recent pending timer handle, or null if no wakeup pending. */
  timer: ReturnType<typeof setTimeout> | null
  /** Epoch ms of the scheduled fire, or 0 if no timer pending. */
  scheduledFor: number
}

let active: ActiveLoop | null = null

export type ScheduleLoopWakeupResult = {
  scheduledFor: number
  clampedDelaySeconds: number
  wasClamped: boolean
}

/**
 * True when the KAIROS_LOOP_DYNAMIC feature flag is enabled AND a dynamic
 * /loop session has been armed this session via enableLoopDynamic().
 *
 * ScheduleWakeupTool.call() uses this to decide whether a scheduling call
 * should take effect (wires up a timer) or no-op (returns scheduledFor=0,
 * which the tool translates into the "Wakeup not scheduled — loop ended"
 * message to the model).
 */
export function isLoopDynamicEnabled(): boolean {
  if (!feature('KAIROS_LOOP_DYNAMIC')) return false
  return active !== null
}

/**
 * Arm a dynamic /loop session. Called by the /loop skill when it detects
 * the no-interval form (dynamic mode). The `prompt` argument is only used
 * as the initial value; each ScheduleWakeup call passes its own `prompt`
 * back explicitly, so this is just a default for the first fire (which
 * shouldn't fire — the skill itself drives the first turn).
 */
export function enableLoopDynamic(prompt: string): void {
  // Cancel any prior session's pending timer before overwriting. This
  // covers the edge case where /loop is re-invoked while a previous
  // dynamic loop is still pending its next wakeup.
  if (active?.timer) {
    clearTimeout(active.timer)
  }
  active = { prompt, timer: null, scheduledFor: 0 }
  logForDebugging(
    `[LoopWakeup] dynamic /loop armed with prompt (${prompt.length} chars)`,
  )
}

/**
 * Cancel the active dynamic /loop session and any pending wakeup timer.
 * Safe to call when no loop is active (no-op). Used by:
 *   - Explicit user interrupt (Ctrl-C / Esc) — REPL aborts should end the
 *     loop, not just the current turn.
 *   - The skill re-entry path (if a user runs /loop again, the prior
 *     session is superseded via enableLoopDynamic which chains cancel).
 */
export function cancelLoopWakeup(): void {
  if (active?.timer) {
    clearTimeout(active.timer)
  }
  active = null
  logForDebugging('[LoopWakeup] dynamic /loop cancelled')
}

/**
 * Schedule the next /loop wakeup. Returns {scheduledFor, clampedDelaySeconds,
 * wasClamped} matching the ScheduleWakeupTool output schema exactly, or null
 * when dynamic mode is not armed (the tool then returns scheduledFor=0 to
 * the model, signaling loop-ended).
 *
 * Idempotent in the sense that only the most recent call wins — if the
 * model calls ScheduleWakeup twice in one turn (shouldn't happen, but),
 * the second call cancels the first's timer.
 */
export function scheduleLoopWakeup(
  delaySeconds: number,
  prompt: string,
  reason: string,
): ScheduleLoopWakeupResult | null {
  if (!isLoopDynamicEnabled()) return null
  if (!active) return null // Defensive — isLoopDynamicEnabled already checked

  // Clamp. Match the tool's documented [MIN, MAX] contract exactly so
  // wasClamped reflects the caller's intent without runtime drift.
  const raw = Math.round(delaySeconds)
  const clampedDelaySeconds = Math.min(
    MAX_DELAY_SECONDS,
    Math.max(MIN_DELAY_SECONDS, Number.isFinite(raw) ? raw : MIN_DELAY_SECONDS),
  )
  const wasClamped = clampedDelaySeconds !== delaySeconds
  const scheduledFor = Date.now() + clampedDelaySeconds * 1000

  // Only-one-wakeup-at-a-time: cancel any prior pending timer. The model
  // normally calls ScheduleWakeup once per turn, but if something replays
  // or retries we want the most recent call to win.
  if (active.timer) {
    clearTimeout(active.timer)
    active.timer = null
  }

  // Update the active loop prompt so interrupt/cancel sees the latest
  // version (in case the model passed a modified prompt).
  active.prompt = prompt
  active.scheduledFor = scheduledFor

  // Resolve sentinel → textual autonomous-loop instructions. At fire
  // time we want the model to see a concrete prompt, not a literal
  // `<<autonomous-loop-dynamic>>` tag. The sentinel is only useful as an
  // in-transit marker; the runtime substitutes at delivery.
  const effectivePrompt =
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
      ? buildAutonomousLoopPrompt()
      : prompt

  const timer = setTimeout(() => {
    // Re-check we're still active — user may have cancelled between
    // schedule and fire.
    if (!active || active.timer !== timer) {
      logForDebugging(
        '[LoopWakeup] timer fired but loop was cancelled/replaced; ignoring',
      )
      return
    }
    // Clear the timer handle BEFORE enqueuing so isLoopDynamicEnabled
    // reads correctly if the enqueued prompt immediately runs and the
    // model calls ScheduleWakeup again synchronously.
    active.timer = null
    active.scheduledFor = 0
    logForDebugging(
      `[LoopWakeup] firing wakeup (reason: ${reason.slice(0, 80)})`,
    )
    enqueuePendingNotification({
      value: effectivePrompt,
      mode: 'prompt',
      priority: 'later',
      isMeta: true,
      workload: WORKLOAD_CRON,
    })
  }, clampedDelaySeconds * 1000)
  // Don't keep the process alive for a pending wakeup alone — if the user
  // has quit the REPL, let the process exit.
  timer.unref?.()
  active.timer = timer

  return { scheduledFor, clampedDelaySeconds, wasClamped }
}

/**
 * When an autonomous /loop (no user prompt) arms dynamic mode, the model's
 * `prompt` arg to ScheduleWakeup is the sentinel literal. At fire time we
 * want the next turn to see actual instructions, not the tag. This builds
 * the concrete prompt the scheduler enqueues.
 *
 * Kept minimal — the /loop skill's dynamic-mode prompt provides the full
 * instructions on each turn; this is only the "wake up and continue"
 * trigger message.
 */
function buildAutonomousLoopPrompt(): string {
  return `/loop`
}

/**
 * Test-only: inspect active state. Not exported via index; imported by
 * tests that need to assert timer state without monkey-patching timers.
 */
export function _getActiveLoopForTesting(): ActiveLoop | null {
  return active
}
