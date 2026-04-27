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

export type ParsedMeasureArgs = {
  n: number
  tools: ToolName[] | 'auto'
  models: string[]
  parallel: number
  timeoutMs: number
  list: boolean
}

/** Pure parser; tested directly. */
export function parseMeasureArgs(args: string): ParsedMeasureArgs {
  const tokens = args.trim().split(/\s+/).filter(t => t.length > 0)
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

  return { n, tools, models, parallel, timeoutMs, list }
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

export function registerMeasureSkill(): void {
  registerBundledSkill({
    name: 'measure',
    description:
      'Cross-tool eval harness: replay recent prompts against void/claude/codex/opencode at their latest installed versions, write a markdown report comparing cost, latency, success, and feature parity. Defaults to auto-detect every installed tool.',
    whenToUse:
      'When the user wants to know whether void is still keeping pace with claude code / codex / opencode, or to A/B test a feature change. Pass --list to just see which tools are installed.',
    argumentHint:
      '[-n COUNT] [--tools claude,codex,opencode,void] [--models opus,sonnet] [--parallel N] [--list]',
    userInvocable: true,
    async getPromptForCommand(args) {
      const parsed = parseMeasureArgs(args ?? '')
      const home = homedir()
      const cwd = process.cwd()

      // --list short-circuits the full run: detect, print, exit.
      if (parsed.list) {
        const { found, missing } = await resolveTools(parsed.tools)
        const text = formatDetectedTools(found, missing)
        return [{ type: 'text', text: `# Detected tools\n\n\`\`\`\n${text}\n\`\`\`` }]
      }

      let body: string
      try {
        const { found, missing } = await resolveTools(parsed.tools)
        if (found.length === 0) {
          const requested =
            parsed.tools === 'auto' ? '(auto-detect)' : parsed.tools.join(', ')
          body = `# Measurement aborted\n\nNo tools detected for: ${requested}. Install at least one of void/claude/codex/opencode and re-run.`
        } else {
          const variants = buildVariants(found, parsed.models)
          const opts = buildMeasureOptions(parsed, variants, { cwd, home })
          const { status, reportPath } = await runMeasure(opts)
          const missingNote =
            missing.length > 0
              ? `\n\n_Requested but not installed: ${missing.join(', ')}._`
              : ''
          body = reportPath
            ? `${MEASURE_PROMPT_HEADER}${status}${missingNote}`
            : `${status}${missingNote}`
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        body = `# Measurement failed\n\n${err}`
      }

      const block: ContentBlockParam = { type: 'text', text: body }
      return [block]
    },
  })
}
