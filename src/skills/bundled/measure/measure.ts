/**
 * `/measure` — eval harness skill.
 *
 * The skill does the work directly in `getPromptForCommand` rather than
 * delegating to the model. Replay/score/report is purely deterministic — it
 * needs no judgment — so we run it inline and return a status block that the
 * model then summarizes for the user.
 *
 * Default invocation samples N recent prompts for the current project from
 * `~/.void/history.jsonl`, replays each against the user's current model, and
 * writes a markdown report to `~/vault/measurements/`. Pass `--models` to
 * compare two or more model variants in a single run.
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { homedir } from 'os'
import { join } from 'path'
import { registerBundledSkill } from '../../bundledSkills.js'
import { sampleRecentPrompts } from './corpus.js'
import { replayBatch } from './replay.js'
import { writeReport } from './report.js'
import { scoreByModel } from './score.js'
import {
  DEFAULT_N,
  DEFAULT_PARALLEL,
  DEFAULT_TIMEOUT_MS,
  MAX_N,
  MAX_PARALLEL,
  type MeasureOptions,
} from './types.js'

/** Pure parser; tested directly. */
export function parseMeasureArgs(args: string): {
  n: number
  models: string[]
  parallel: number
  timeoutMs: number
} {
  const tokens = args.trim().split(/\s+/).filter(t => t.length > 0)
  let n = DEFAULT_N
  let models: string[] = []
  let parallel = DEFAULT_PARALLEL
  let timeoutMs = DEFAULT_TIMEOUT_MS

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
    }
  }

  return { n, models, parallel, timeoutMs }
}

/**
 * Detect the void binary to spawn for replays. Honors $VOID_BIN, then falls
 * back to the script path that started this process (argv[1]), then 'void'
 * on PATH. Replay timeouts surface a clear error if the path is wrong.
 */
function resolveVoidBin(): string {
  const env = process.env['VOID_BIN']
  if (env && env.length > 0) return env
  if (process.argv[1] && process.argv[1].length > 0) return process.argv[1]
  return 'void'
}

/** Build the full set of MeasureOptions from parsed args + environment. */
export function buildMeasureOptions(
  parsed: ReturnType<typeof parseMeasureArgs>,
  ctx: { cwd: string; home: string },
): MeasureOptions {
  // Default to the current model when --models is omitted. We use the literal
  // string "default" so the spawned subprocess inherits whatever model the
  // user has currently selected — replay.ts strips the --model flag if set
  // to "default" via this same convention. (See replay.ts behavior.)
  const models = parsed.models.length > 0 ? parsed.models : ['default']
  return {
    n: parsed.n,
    models,
    projectPath: ctx.cwd,
    historyPath: join(ctx.home, '.void', 'history.jsonl'),
    vaultDir: join(ctx.home, 'vault', 'measurements'),
    timeoutMs: parsed.timeoutMs,
    parallel: parsed.parallel,
    voidBin: resolveVoidBin(),
  }
}

/** Run the full pipeline; returns a status string and the report path. */
export async function runMeasure(
  opts: MeasureOptions,
): Promise<{ status: string; reportPath: string | null }> {
  const startedAt = new Date()
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

  // Cartesian product (prompt × model) for replay.
  const pairs: Array<{ prompt: string; model: string }> = []
  for (const entry of corpus) {
    for (const model of opts.models) {
      pairs.push({ prompt: entry.display, model })
    }
  }

  const results = await replayBatch(pairs, {
    voidBin: opts.voidBin,
    timeoutMs: opts.timeoutMs,
    parallel: opts.parallel,
  })

  const stats = scoreByModel(results)
  const reportPath = await writeReport({
    results,
    stats,
    startedAt,
    projectPath: opts.projectPath,
    corpusSize: corpus.length,
    vaultDir: opts.vaultDir,
  })

  const successTotal = results.filter(r => r.ok).length
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0)
  const summary = [
    `Replayed ${corpus.length} prompts × ${opts.models.length} model(s) = ${results.length} runs.`,
    `Success: ${successTotal}/${results.length}.`,
    `Total cost: $${totalCost.toFixed(4)}.`,
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
      'A/B test the current setup by replaying recent prompts against one or more model variants. Writes a markdown report to ~/vault/measurements/.',
    whenToUse:
      'When the user wants to measure the impact of a model, prompt, or feature change. Ship /measure first; iterate after.',
    argumentHint: '[-n COUNT] [--models opus,sonnet,haiku] [--parallel N]',
    userInvocable: true,
    async getPromptForCommand(args) {
      const parsed = parseMeasureArgs(args ?? '')
      const opts = buildMeasureOptions(parsed, {
        cwd: process.cwd(),
        home: homedir(),
      })

      let body: string
      try {
        const { status, reportPath } = await runMeasure(opts)
        body = reportPath
          ? `${MEASURE_PROMPT_HEADER}${status}`
          : status // No corpus — surface that directly without the header.
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        body = `# Measurement failed\n\n${err}`
      }

      const block: ContentBlockParam = { type: 'text', text: body }
      return [block]
    },
  })
}
