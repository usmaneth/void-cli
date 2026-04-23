import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  isLoopDynamicEnabled,
  scheduleLoopWakeup,
} from '../../utils/loopWakeup.js'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
  SCHEDULE_WAKEUP_TOOL_NAME,
} from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    delaySeconds: z
      .number()
      .describe(
        'Seconds from now to wake up. Clamped to [60, 3600] by the runtime.',
      ),
    reason: z
      .string()
      .describe(
        'One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific.',
      ),
    prompt: z
      .string()
      .describe(
        `The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. For autonomous /loop (no user prompt), pass the literal sentinel \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` instead (the dynamic-pacing variant, not the CronCreate-mode \`${AUTONOMOUS_LOOP_SENTINEL}\`).`,
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    scheduledFor: z
      .number()
      .describe('Epoch ms timestamp when the next wakeup will fire'),
    clampedDelaySeconds: z
      .number()
      .describe('Actual delay used after clamping to runtime bounds'),
    wasClamped: z
      .boolean()
      .describe('True if the requested delaySeconds was outside [60, 3600]'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ScheduleWakeupOutput = z.infer<OutputSchema>

/**
 * ScheduleWakeup — called by the model at end-of-turn during /loop dynamic
 * (self-paced) mode. The model picks a delaySeconds (clamped to the
 * [MIN_DELAY_SECONDS, MAX_DELAY_SECONDS] range by the runtime) and a reason;
 * the runtime wakes the agent back up after that delay and re-injects the
 * supplied prompt.
 *
 * Replaces the older blocking SleepTool — this tool is non-blocking. The
 * actual scheduling is handed off to a runtime wake-scheduler module (see
 * Integration TODO in the port notes). If no scheduler is wired up (or /loop
 * dynamic mode is disabled), the tool returns scheduledFor: 0 to signal that
 * no wakeup was scheduled and the loop has effectively ended.
 *
 * Matches the 2.1.118 Claude Code schema exactly (delaySeconds / reason /
 * prompt input; scheduledFor / clampedDelaySeconds / wasClamped output).
 */
export const ScheduleWakeupTool = buildTool({
  name: SCHEDULE_WAKEUP_TOOL_NAME,
  searchHint:
    'self-pace next iteration: pick a delay before resuming work or running the next /loop tick',
  maxResultSizeChars: 1000,
  shouldDefer: true,

  userFacingName() {
    return ''
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isReadOnly() {
    // Scheduling a future wakeup has no side effect on the filesystem or
    // any external resource — the runtime just stores an in-memory timer.
    return true
  },

  isConcurrencySafe() {
    return true
  },

  async description() {
    return DESCRIPTION
  },

  async prompt() {
    return PROMPT
  },

  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },

  toAutoClassifierInput(input) {
    return `${input.delaySeconds}s: ${input.reason}`
  },

  async call({ delaySeconds, reason, prompt }) {
    // When /loop dynamic mode is not armed (no active session, or the
    // KAIROS_LOOP_DYNAMIC gate is off), return scheduledFor=0 so the model
    // sees the "Wakeup not scheduled — loop ended" branch in
    // mapToolResultToToolResultBlockParam. This matches the 2.1.118 runtime
    // which treats a null scheduleLoopWakeup result as "loop terminated".
    if (!isLoopDynamicEnabled()) {
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
        },
      }
    }

    const result = scheduleLoopWakeup(delaySeconds, prompt, reason)
    // Defensive: scheduleLoopWakeup returns null only when the gate is off,
    // which we checked above. Still — if state drifted mid-call, fall back
    // to the not-scheduled branch rather than return stale clamp values.
    if (result === null) {
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
        },
      }
    }

    return { data: result }
  },

  mapToolResultToToolResultBlockParam(
    { scheduledFor, clampedDelaySeconds, wasClamped },
    toolUseID,
  ) {
    if (scheduledFor === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content:
          'Wakeup not scheduled. Either the /loop dynamic runtime gate is off or the loop reached its maximum duration — the loop has ended; do not re-issue.',
      }
    }
    const when = new Date(scheduledFor).toTimeString().slice(0, 8)
    const remaining = Math.max(
      0,
      Math.round((scheduledFor - Date.now()) / 1000),
    )
    const clampedSuffix = wasClamped
      ? ` (clamped to ${clampedDelaySeconds}s from your requested value)`
      : ''
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: `Next wakeup scheduled for ${when} (in ${remaining}s)${clampedSuffix}.`,
    }
  },

  renderToolUseMessage,
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, ScheduleWakeupOutput>)
