/**
 * `/measure` — cross-tool eval harness skill.
 *
 * Default invocation samples N recent prompts for the current project from
 * `~/.void/history.jsonl`, replays each against every detected tool
 * (void/claude/codex/opencode) at its currently-installed version, and
 * writes a markdown report to `~/vault/measurements/`.
 *
 * The point isn't model A/B testing — it's "is void still keeping pace
 * with claude code, codex, opencode at their latest versions, and where
 * are the gaps?" Every run uses whatever is installed today; bumping a
 * tool changes the comparison set on the next run.
 *
 * Args:
 *   -n COUNT              Sample N recent prompts (default 10, max 50)
 *   --tools LIST          Comma-separated: void,claude,codex,opencode
 *                         (default: auto-detect every installed tool)
 *   --models LIST         Comma-separated models (only crosses with void;
 *                         e.g. `--models opus,sonnet` adds void@opus +
 *                         void@sonnet variants alongside the cross-tool set)
 *   --parallel N          Concurrent replays (default 2, max 4)
 *   --timeout SEC         Per-replay timeout in seconds (default 60)
 *   --list                Print detected tools + versions and exit (no replays)
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { homedir } from 'os'
import { join } from 'path'
import { registerBundledSkill } from '../../bundledSkills.js'
import { sampleRecentPrompts } from './corpus.js'
import { runPortSuggest } from './portSuggest.js'
import { replayBatch } from './replay.js'
import { writeReport } from './report.js'
import { scoreByVariant } from './score.js'
import {
  detectAllTools,
  isToolName,
  resolveRequestedTools,
} from './tools.js'
import {
  DEFAULT_N,
  DEFAULT_PARALLEL,
  DEFAULT_TIMEOUT_MS,
  MAX_N,
  MAX_PARALLEL,
  type DetectedTool,
  type MeasureOptions,
  type ToolName,
  type Variant,
} from './types.js'

/**
 * Operating modes. `/measure` defaults to `measure`; the first non-flag
 * token chooses a different mode (e.g. `/measure suggest`).
 */
export type MeasureMode = 'measure' | 'suggest' | 'apply' | 'loop'

const MODE_NAMES: readonly MeasureMode[] = [
  'measure',
  'suggest',
  'apply',
  'loop',
] as const

function isMode(s: string): s is MeasureMode {
  return (MODE_NAMES as readonly string[]).includes(s)
}

export type ParsedMeasureArgs = {
  mode: MeasureMode
  /** Positional arg following the mode, e.g. plan-id for `/measure apply <id>`. */
  modeArg?: string
  n: number
  tools: ToolName[] | 'auto'
  models: string[]
  parallel: number
  timeoutMs: number
  list: boolean
}

/** Pure parser; tested directly. */
export function parseMeasureArgs(args: string): ParsedMeasureArgs {
  const allTokens = args.trim().split(/\s+/).filter(t => t.length > 0)

  // Mode dispatch: if the first token is a known mode name, peel it off
  // (and one optional positional argument) before the flag parser runs.
  let mode: MeasureMode = 'measure'
  let modeArg: string | undefined
  let tokens = allTokens
  if (allTokens[0] && isMode(allTokens[0])) {
    mode = allTokens[0] as MeasureMode
    tokens = allTokens.slice(1)
    // Peel off a positional arg only when the next token isn't a flag.
    if (tokens[0] && !tokens[0].startsWith('-')) {
      modeArg = tokens[0]
      tokens = tokens.slice(1)
    }
  }

  let n = DEFAULT_N
  let tools: ToolName[] | 'auto' = 'auto'
  let models: string[] = []
  let parallel = DEFAULT_PARALLEL
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let list = false

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t === '-n' || t === '--count') {
      const v = tokens[i + 1]
      if (v !== undefined) {
        const parsed = parseInt(v, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          n = Math.min(parsed, MAX_N)
        }
        i++
      }
    } else if (t === '--tools' || t === '-t') {
      const v = tokens[i + 1]
      if (v !== undefined) {
        const requested = v
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0)
          .filter(isToolName)
        if (requested.length > 0) tools = requested
        i++
      }
    } else if (t === '--models' || t === '-m') {
      const v = tokens[i + 1]
      if (v !== undefined) {
        models = v
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0)
        i++
      }
    } else if (t === '--parallel' || t === '-p') {
      const v = tokens[i + 1]
      if (v !== undefined) {
        const parsed = parseInt(v, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          parallel = Math.min(parsed, MAX_PARALLEL)
        }
        i++
      }
    } else if (t === '--timeout') {
      const v = tokens[i + 1]
      if (v !== undefined) {
        const parsed = parseInt(v, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          timeoutMs = parsed * 1000
        }
        i++
      }
    } else if (t === '--list' || t === '-l') {
      list = true
    }
  }

  return { mode, modeArg, n, tools, models, parallel, timeoutMs, list }
}

/**
 * Build the variant list from detected tools + optional model overrides.
 *
 * Rule:
 *  - For every detected tool, emit at least one variant at the tool's
 *    default model (id: `<tool>` or `<tool>@<version>` if collisions).
 *  - When `models` is non-empty, ALSO emit variants for `void` at each
 *    model. Model overrides only apply to void here — other tools have
 *    their own model namespaces (codex uses gpt-5/o3, opencode varies),
 *    so cross-tool model swaps would be apples-to-oranges.
 */
export function buildVariants(
  tools: DetectedTool[],
  models: string[],
): Variant[] {
  const variants: Variant[] = []
  for (const t of tools) {
    variants.push({
      id: t.name,
      tool: t.name,
      binary: t.binary,
      version: t.version,
    })
    if (t.name === 'void') {
      for (const m of models) {
        variants.push({
          id: `void@${m}`,
          tool: 'void',
          binary: t.binary,
          version: t.version,
          model: m,
        })
      }
    }
  }
  return variants
}

/** Build the full set of MeasureOptions. */
export function buildMeasureOptions(
  parsed: ParsedMeasureArgs,
  variants: Variant[],
  ctx: { cwd: string; home: string },
): MeasureOptions {
  return {
    n: parsed.n,
    variants,
    projectPath: ctx.cwd,
    historyPath: join(ctx.home, '.void', 'history.jsonl'),
    vaultDir: join(ctx.home, 'vault', 'measurements'),
    timeoutMs: parsed.timeoutMs,
    parallel: parsed.parallel,
  }
}

/** Resolve the requested tool set (or auto-detect everything installed). */
async function resolveTools(
  spec: ToolName[] | 'auto',
): Promise<{ found: DetectedTool[]; missing: ToolName[] }> {
  if (spec === 'auto') {
    const found = await detectAllTools()
    return { found, missing: [] }
  }
  return resolveRequestedTools(spec)
}

/** Build a human-readable list of detected tools — used by --list. */
export function formatDetectedTools(
  found: DetectedTool[],
  missing: ToolName[],
): string {
  const lines: string[] = []
  if (found.length === 0) {
    lines.push('No tools detected.')
  } else {
    lines.push('Detected tools:')
    for (const t of found) {
      lines.push(`  - ${t.name}: ${t.version}`)
      lines.push(`    ${t.binary}`)
    }
  }
  if (missing.length > 0) {
    lines.push('')
    lines.push('Requested but not installed:')
    for (const m of missing) {
      lines.push(`  - ${m}`)
    }
  }
  return lines.join('\n')
}

/** Run the full pipeline; returns a status string and the report path. */
export async function runMeasure(
  opts: MeasureOptions,
): Promise<{ status: string; reportPath: string | null }> {
  const startedAt = new Date()

  if (opts.variants.length === 0) {
    return {
      status: 'No variants resolved — install at least one of void/claude/codex/opencode and re-run.',
      reportPath: null,
    }
  }

  const corpus = await sampleRecentPrompts({
    n: opts.n,
    projectPath: opts.projectPath,
    historyPath: opts.historyPath,
  })

  if (corpus.length === 0) {
    return {
      status: `No replayable prompts found for project \`${opts.projectPath}\` in ${opts.historyPath}. Ask in this project for a while, then re-run.`,
      reportPath: null,
    }
  }

  // Cartesian product (prompt × variant) for replay.
  const pairs: Array<{ prompt: string; variant: Variant }> = []
  for (const entry of corpus) {
    for (const variant of opts.variants) {
      pairs.push({ prompt: entry.display, variant })
    }
  }

  const results = await replayBatch(pairs, {
    timeoutMs: opts.timeoutMs,
    parallel: opts.parallel,
  })

  const stats = scoreByVariant(results)
  const reportPath = await writeReport({
    results,
    stats,
    startedAt,
    projectPath: opts.projectPath,
    corpusSize: corpus.length,
    vaultDir: opts.vaultDir,
  })

  const successTotal = results.filter(r => r.ok).length
  const totalCost = results
    .filter(r => r.costAvailable)
    .reduce((s, r) => s + r.costUsd, 0)
  const costLine = totalCost > 0
    ? `Total cost: $${totalCost.toFixed(4)} (where reported).`
    : `Cost data: not exposed by this run's parsers.`

  const summary = [
    `Replayed ${corpus.length} prompts × ${opts.variants.length} variant(s) = ${results.length} runs.`,
    `Success: ${successTotal}/${results.length}.`,
    costLine,
    `Variants: ${opts.variants.map(v => v.id).join(', ')}.`,
    `Report: \`${reportPath}\``,
  ].join('\n')
  return { status: summary, reportPath }
}

const MEASURE_PROMPT_HEADER = `# Measurement complete

The /measure skill has finished a replay run. The detailed markdown report
is on disk at the path below — read it if the user asks for specifics.
Otherwise, briefly relay the summary statistics. Do not paste the full
report.

`

/** Run measure mode end-to-end and return the body for the prompt block. */
async function runMeasureModeBody(
  parsed: ParsedMeasureArgs,
  ctx: { cwd: string; home: string },
): Promise<string> {
  if (parsed.list) {
    const { found, missing } = await resolveTools(parsed.tools)
    return `# Detected tools\n\n\`\`\`\n${formatDetectedTools(found, missing)}\n\`\`\``
  }
  try {
    const { found, missing } = await resolveTools(parsed.tools)
    if (found.length === 0) {
      const requested =
        parsed.tools === 'auto' ? '(auto-detect)' : parsed.tools.join(', ')
      return `# Measurement aborted\n\nNo tools detected for: ${requested}. Install at least one of void/claude/codex/opencode and re-run.`
    }
    const variants = buildVariants(found, parsed.models)
    const opts = buildMeasureOptions(parsed, variants, ctx)
    const { status, reportPath } = await runMeasure(opts)
    const missingNote =
      missing.length > 0
        ? `\n\n_Requested but not installed: ${missing.join(', ')}._`
        : ''
    return reportPath
      ? `${MEASURE_PROMPT_HEADER}${status}${missingNote}`
      : `${status}${missingNote}`
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return `# Measurement failed\n\n${err}`
  }
}

/** Run suggest mode and return the body. */
async function runSuggestModeBody(ctx: {
  cwd: string
  home: string
}): Promise<string> {
  try {
    const { status, planPath } = await runPortSuggest({
      voidSourceRoot: join(ctx.cwd, 'src'),
      vaultDir: join(ctx.home, 'vault', 'port-plans'),
      measurementsDir: join(ctx.home, 'vault', 'measurements'),
    })
    if (!planPath) return status
    return `# Port plan generated\n\nThe \`/measure suggest\` pipeline finished. Detailed plan is at the path below — read it before recommending any specific port. Do not paste the full plan in chat; surface the headline numbers and the top 3-5 candidates.\n\n${status}`
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return `# Suggest failed\n\n${err}`
  }
}

/** Stub bodies for not-yet-built modes — intentional, with followup pointers. */
const APPLY_STUB_BODY = `# /measure apply — not built yet

The \`apply\` mode dispatches a sub-agent per port-plan item to draft the
port, returning a diff for human review. It's the next chunk after
\`/measure suggest\` and is tracked as a followup.

What works today:
- \`/measure\` runs the cross-tool harness and writes a measurement report.
- \`/measure suggest\` reads the latest measurement and the installed
  alternative-tool binaries, mines string-literal candidates, and writes a
  port plan to \`~/vault/port-plans/\`.

What \`/measure apply\` will do:
- Accept a plan id (e.g. \`/measure apply 2026-04-27-1234\`).
- Open the plan, list candidate items.
- For each accepted item, dispatch a sub-agent with the candidate as
  context plus pointers to relevant void-side files.
- Return the diff for the user to review and commit.

Until then, port candidates manually: open the latest port plan, pick a
candidate, and ask the model directly to investigate and port it.`

const LOOP_STUB_BODY = `# /measure loop — not built yet

The \`loop\` mode orchestrates measure → suggest → apply (with user gates)
→ measure-again, closing the feedback loop on whether each port closed
its targeted gap. It's the final chunk and depends on \`apply\` shipping
first.

What works today:
- \`/measure\` and \`/measure suggest\` are real.

What \`/measure loop\` will do:
- Run \`/measure\` to capture a baseline.
- Run \`/measure suggest\` to generate a port plan.
- For each plan item the user approves, run \`/measure apply <plan-id>\`
  and present the diff.
- After committed ports, re-run \`/measure\` and diff against the
  baseline so each port's measurable impact is on record.

Until apply ships, run the steps manually.`

export function registerMeasureSkill(): void {
  registerBundledSkill({
    name: 'measure',
    description:
      'Cross-tool eval harness + port-plan suggester. `/measure` replays prompts against void/claude/codex/opencode and writes a comparison report. `/measure suggest` mines the alt tools for strings void doesn\'t have and writes a port plan. `/measure apply` and `/measure loop` are scaffolded for upcoming sessions.',
    whenToUse:
      'When the user wants to know whether void is still keeping pace with the latest installed claude code / codex / opencode, or to identify what features to port next. `/measure suggest` is the second step after a measurement run.',
    argumentHint:
      '[measure|suggest|apply|loop] [-n COUNT] [--tools ...] [--models ...] [--list]',
    userInvocable: true,
    async getPromptForCommand(args) {
      const parsed = parseMeasureArgs(args ?? '')
      const home = homedir()
      const cwd = process.cwd()

      let body: string
      switch (parsed.mode) {
        case 'measure':
          body = await runMeasureModeBody(parsed, { cwd, home })
          break
        case 'suggest':
          body = await runSuggestModeBody({ cwd, home })
          break
        case 'apply':
          body = APPLY_STUB_BODY
          break
        case 'loop':
          body = LOOP_STUB_BODY
          break
      }

      const block: ContentBlockParam = { type: 'text', text: body }
      return [block]
    },
  })
}
