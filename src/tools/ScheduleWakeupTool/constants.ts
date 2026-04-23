export const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'

/**
 * The runtime clamps any requested delay into this range before scheduling
 * the next wakeup. Mirrors the 2.1.118 Claude Code bounds so the tool's
 * documented contract (wasClamped, clampedDelaySeconds) stays accurate.
 */
export const MIN_DELAY_SECONDS = 60
export const MAX_DELAY_SECONDS = 3600

/**
 * Literal sentinel passed back as the `prompt` field when a /loop was
 * invoked without a user prompt (autonomous dynamic mode). The runtime
 * resolves this to the autonomous-loop instructions at fire time.
 *
 * Distinct from AUTONOMOUS_LOOP_SENTINEL — this one is specific to the
 * dynamic (self-paced) variant used by ScheduleWakeup. CronCreate-based
 * autonomous loops use the non-dynamic sentinel.
 */
export const AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = '<<autonomous-loop-dynamic>>'
export const AUTONOMOUS_LOOP_SENTINEL = '<<autonomous-loop>>'
