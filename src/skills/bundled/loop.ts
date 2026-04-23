import { feature } from '../../bun-bundle-shim.js'
import {
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
  isKairosCronEnabled,
} from '../../tools/ScheduleCronTool/prompt.js'
import { SCHEDULE_WAKEUP_TOOL_NAME } from '../../tools/ScheduleWakeupTool/constants.js'
import { enableLoopDynamic } from '../../utils/loopWakeup.js'
import { registerBundledSkill } from '../bundledSkills.js'

const USAGE_MESSAGE = `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval (interval mode), or
omit the interval to let the model self-pace the cadence (dynamic mode).

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.

Examples:
  /loop 5m /babysit-prs              (interval mode, every 5 min)
  /loop 30m check the deploy         (interval mode, every 30 min)
  /loop check the deploy             (dynamic mode — model picks the cadence)
  /loop babysit the migration        (dynamic mode)
  /loop check the deploy every 20m   (interval mode via 'every' clause)`

/**
 * Try to extract an interval from the input. Returns `{interval, prompt}` if
 * an interval is present (rule 1 or rule 2), or `null` if the input has no
 * interval (rule 3 — triggers dynamic mode).
 *
 * Rules mirror the skill prompt documentation so the TypeScript pre-parse
 * stays in sync with the model's instructions for the interval branch.
 *   - Rule 1: leading token matches /^\d+[smhd]$/
 *   - Rule 2: trailing "every <N><unit>" or "every <N> <unit-word>" clause
 *     where the time expression is at the END of the input (so `check every
 *     PR` doesn't match — "PR" isn't a time expression).
 */
function parseIntervalFromInput(
  input: string,
): { interval: string; prompt: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Rule 1: leading token
  const leadingMatch = trimmed.match(/^(\d+[smhd])(\s+(.*))?$/)
  if (leadingMatch) {
    const [, interval, , rest] = leadingMatch
    return { interval: interval!, prompt: (rest ?? '').trim() }
  }

  // Rule 2: trailing "every N<unit>" or "every N <unit-word>".
  // Matches ONLY when the time expression is the last thing in the input.
  // Units: s, m, h, d (single letter) OR second(s), minute(s), hour(s), day(s).
  const trailingMatch = trimmed.match(
    /^(.*?)\s+every\s+(\d+)\s*(s|m|h|d|seconds?|minutes?|hours?|days?)\s*$/i,
  )
  if (trailingMatch) {
    const [, prompt, nStr, unitRaw] = trailingMatch
    const n = parseInt(nStr!, 10)
    const unit = unitRaw!.toLowerCase()
    const letter = unit.startsWith('s')
      ? 's'
      : unit.startsWith('min')
        ? 'm'
        : unit === 'm'
          ? 'm'
          : unit.startsWith('h')
            ? 'h'
            : 'd'
    return { interval: `${n}${letter}`, prompt: prompt!.trim() }
  }

  return null
}

function buildIntervalPrompt(
  interval: string,
  prompt: string,
  originalInput: string,
): string {
  return `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it with ${CRON_CREATE_TOOL_NAME}.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.

The runtime already parsed this input and detected an interval: \`${interval}\` with prompt \`${prompt}\`. Use these values (you may re-validate).

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop — do not call ${CRON_CREATE_TOOL_NAME}.

## Interval → cron

Supported suffixes: \`s\` (seconds, rounded up to nearest minute, min 1), \`m\` (minutes), \`h\` (hours), \`d\` (days). Convert:

| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| \`Nm\` where N ≤ 59   | \`*/N * * * *\`     | every N minutes                          |
| \`Nm\` where N ≥ 60   | \`0 */H * * *\`     | round to hours (H = N/60, must divide 24)|
| \`Nh\` where N ≤ 23   | \`0 */N * * *\`     | every N hours                            |
| \`Nd\`                | \`0 0 */N * *\`     | every N days at midnight local           |
| \`Ns\`                | treat as \`ceil(N/60)m\` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. \`7m\` → \`*/7 * * * *\` gives uneven gaps at :56→:00; \`90m\` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.

## Action

1. Call ${CRON_CREATE_TOOL_NAME} with:
   - \`cron\`: the expression from the table above
   - \`prompt\`: the parsed prompt, verbatim (slash commands are passed through unchanged)
   - \`recurring\`: \`true\`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that they can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

${originalInput}`
}

function buildDynamicPrompt(prompt: string): string {
  return `# /loop — dynamic (self-paced) mode

The user invoked \`/loop\` without an interval, which means **dynamic mode**: you choose the cadence of each iteration by calling ${SCHEDULE_WAKEUP_TOOL_NAME} at the end of every turn. There is NO cron. Do NOT call ${CRON_CREATE_TOOL_NAME} for this invocation.

## The task

Do the work implied by the prompt below. When you're done with this turn's work, call ${SCHEDULE_WAKEUP_TOOL_NAME} with:
  - \`delaySeconds\`: your chosen delay (see guidance below)
  - \`reason\`: one short, specific sentence explaining the chosen delay
  - \`prompt\`: the literal string \`${prompt}\` (pass it through verbatim so the next turn re-enters this skill with the same task)

**Omit the ${SCHEDULE_WAKEUP_TOOL_NAME} call to end the loop.** When the task is complete or the user's intent has been satisfied, just don't call it — the loop ends naturally.

## Picking delaySeconds

The Anthropic prompt cache has a 5-minute TTL. Sleeping past 300 seconds means the next wake-up reads your full conversation context uncached — slower and more expensive. So the natural breakpoints:

- **Under 5 minutes (60s–270s)**: cache stays warm. Right for active work — checking a build, polling for state that's about to change, watching a process you just started.
- **5 minutes to 1 hour (300s–3600s)**: pay the cache miss. Right when there's no point checking sooner — waiting on something that takes minutes to change, or genuinely idle.

**Don't pick 300s.** It's the worst-of-both: you pay the cache miss without amortizing it. If you're tempted to "wait 5 minutes," either drop to 270s (stay in cache) or commit to 1200s+ (one cache miss buys a much longer wait). Don't think in round-number minutes — think in cache windows.

For idle ticks with no specific signal to watch, default to **1200s–1800s** (20–30 min). The loop checks back, you don't burn cache 12× per hour for nothing, and the user can always interrupt if they need you sooner.

Think about what you're actually waiting for, not just "how long should I sleep." If you kicked off an 8-minute build, sleeping 60s burns the cache 8 times before it finishes — sleep ~270s twice instead.

The runtime clamps to [60, 3600], so you don't need to clamp yourself.

## The reason field

One short sentence on what you chose and why. Goes to telemetry and is shown back to the user. "checking long bun build" beats "waiting." The user reads this to understand what you're doing without having to predict your cadence in advance — make it specific.

## Execute now

Start the work. Do the first iteration now, then at the end of the turn call ${SCHEDULE_WAKEUP_TOOL_NAME} to schedule the next iteration. If the task is already done after this one turn, simply don't call ${SCHEDULE_WAKEUP_TOOL_NAME} — the loop ends.

## Task

${prompt}`
}

/**
 * Whether dynamic /loop mode is runtime-enabled. Gated behind
 * KAIROS_LOOP_DYNAMIC since ScheduleWakeupTool is also gated there — if the
 * tool isn't registered there's no way to call it, so dynamic mode should
 * fall back to the 10-minute cron default.
 */
function isLoopDynamicRuntimeEnabled(): boolean {
  return feature('KAIROS_LOOP_DYNAMIC')
}

const CRON_FALLBACK_INTERVAL = '10m'

export function registerLoopSkill(): void {
  registerBundledSkill({
    name: 'loop',
    description:
      'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo), or omit the interval to let the model self-pace',
    whenToUse:
      'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval (e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.',
    argumentHint: '[interval] <prompt>',
    userInvocable: true,
    isEnabled: isKairosCronEnabled,
    async getPromptForCommand(args) {
      const trimmed = args.trim()
      if (!trimmed) {
        return [{ type: 'text', text: USAGE_MESSAGE }]
      }

      // Parse the input here (rather than delegating entirely to the model)
      // so we can deterministically route between interval and dynamic mode.
      // The model still sees the parsed interval in the prompt and may
      // re-validate / correct edge cases (e.g. 90m → 1.5h).
      const parsed = parseIntervalFromInput(trimmed)

      if (parsed === null) {
        // Rule 3: no interval. Switch to dynamic mode when the runtime
        // supports it; otherwise fall back to the legacy 10m cron default
        // so users on the KAIROS_LOOP_DYNAMIC=off path aren't left with a
        // /loop that does nothing.
        if (isLoopDynamicRuntimeEnabled()) {
          // Arm the wake scheduler BEFORE the model runs, so when it calls
          // ScheduleWakeupTool at end-of-turn, isLoopDynamicEnabled() returns
          // true and the wakeup actually schedules. Passes the prompt so
          // subsequent ScheduleWakeup calls (which re-pass the prompt) have
          // a consistent baseline.
          enableLoopDynamic(trimmed)
          return [{ type: 'text', text: buildDynamicPrompt(trimmed) }]
        }
        // Legacy cron-default fallback: synthesize a 10m interval and
        // proceed with the interval prompt.
        return [
          {
            type: 'text',
            text: buildIntervalPrompt(
              CRON_FALLBACK_INTERVAL,
              trimmed,
              trimmed,
            ),
          },
        ]
      }

      if (!parsed.prompt) {
        // Interval parsed but prompt is empty (e.g. input was just `5m`).
        return [{ type: 'text', text: USAGE_MESSAGE }]
      }

      return [
        {
          type: 'text',
          text: buildIntervalPrompt(parsed.interval, parsed.prompt, trimmed),
        },
      ]
    },
  })
}
