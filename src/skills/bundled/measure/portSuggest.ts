/**
 * `/measure suggest` orchestrator.
 *
 * Strategy: detect every installed alternative tool (claude/codex/opencode),
 * mine string literals from each, mine void's source for the same, compute
 * the per-tool diff (strings in alt but not in void), rank by signal, and
 * write a markdown "port plan" to `~/vault/port-plans/`.
 *
 * The plan is human-actionable, not auto-applied. Each candidate string
 * is paired with an investigation hint pointing at where to grep in the
 * upstream tool's binary/source so a porter (human or sub-agent) can
 * trace it back to the feature it represents.
 */

import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { locateBundles } from './bundleLocator.js'
import { mineBundles, mineStringsFromSourceTree } from './stringMiner.js'
import { detectAllTools } from './tools.js'
import type { DetectedTool, ToolName } from './types.js'

export type SuggestOptions = {
  /** Working directory whose source tree we mine for void's strings. */
  voidSourceRoot: string
  /** Where to write the port plan markdown. */
  vaultDir: string
  /** Optional: path to the latest measurement report for context. */
  measurementsDir: string
  /** Override the detected tools (for tests). */
  toolsOverride?: DetectedTool[]
  /** Cap candidates emitted per tool. */
  topPerTool?: number
}

export type PortCandidate = {
  /** The string itself, possibly truncated for display. */
  text: string
  /** Full original string, for reference if needed. */
  full: string
  /** Score from rankCandidate; higher = stronger port signal. */
  score: number
  /** Heuristic category hint for the porter. */
  category: 'prompt' | 'tool-description' | 'error' | 'command' | 'other'
}

export type ToolPortReport = {
  tool: ToolName
  version: string
  binary: string
  candidatesFound: number
  /** Top candidates, ranked by score descending. */
  top: PortCandidate[]
}

const PROMPT_MARKERS = [
  /^#{1,3}\s/, // markdown heading
  /^\*\*[A-Z]/, // bold heading at start
  /^You are\b/i,
  /^When\b/,
  /^If\b/,
  /^IMPORTANT[:\s]/,
  /^Note:\s/,
  /^Phase \d/,
  /^##? /,
]

const ACTIONABLE_VERBS = [
  /\bmust\b/i,
  /\bshould\b/i,
  /\bdo not\b/i,
  /\balways\b/i,
  /\bnever\b/i,
  /\bproactively\b/i,
  /\bremember\b/i,
]

/** Categorize a candidate string by surface shape. Heuristic. */
export function categorize(s: string): PortCandidate['category'] {
  if (PROMPT_MARKERS.some(re => re.test(s))) return 'prompt'
  if (/^[A-Z][a-z]+ tool\b/.test(s)) return 'tool-description'
  if (/^Use the .+ to\b/i.test(s)) return 'tool-description'
  if (/Tool to (dispatch|launch|spawn|run|invoke|call)\b/i.test(s)) {
    return 'tool-description'
  }
  if (
    /\berror\b/i.test(s) &&
    (/\bfailed\b/i.test(s) || /\binvalid\b/i.test(s) || /\bcannot\b/i.test(s))
  ) {
    return 'error'
  }
  if (/^\/[a-z][a-z0-9-]+(\s|$)/.test(s)) return 'command'
  return 'other'
}

/** Score a candidate. Higher = stronger port signal. */
export function scoreCandidate(s: string): number {
  let score = 0
  const len = s.length

  // Length sweet spots — short prompts and medium-length paragraphs.
  if (len >= 30 && len <= 150) score += 1
  else if (len > 150 && len <= 400) score += 1.5
  else if (len > 400) score += 0.5

  // Prompt-shape markers are the strongest single signal.
  if (PROMPT_MARKERS.some(re => re.test(s))) score += 3

  // Actionable verbs — these strongly suggest a behavior instruction.
  if (ACTIONABLE_VERBS.some(re => re.test(s))) score += 1.5

  // Linebreaks suggest multi-line content (likely a prompt template body).
  if (s.includes('\n')) score += 1

  // Tool/skill / command names embedded in the string — feature signal.
  if (/\btool\b/i.test(s) || /\bskill\b/i.test(s)) score += 0.5
  if (/\bcommand\b/i.test(s)) score += 0.5

  // Variety of words (uniques / total) — penalizes repetitive garbage.
  const words = s.match(/[a-zA-Z]{2,}/g) ?? []
  if (words.length > 0) {
    const unique = new Set(words.map(w => w.toLowerCase())).size
    score += Math.min(2, unique / 10)
  }

  return score
}

/** Compute the diff: strings in `a` that don't appear in `b`. Set semantics. */
export function diffStrings(a: string[], b: string[]): string[] {
  const bSet = new Set(b)
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of a) {
    if (bSet.has(s) || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * Truncate a string for display in the report. Keeps the first N chars
 * and adds an ellipsis. Newlines collapsed to single spaces for tables.
 */
function preview(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}

/** Build per-tool candidate list from raw diff output. */
export function rankCandidates(
  diff: string[],
  topN: number,
): PortCandidate[] {
  const scored = diff.map(s => ({
    text: preview(s, 200),
    full: s,
    score: scoreCandidate(s),
    category: categorize(s),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)
}

/**
 * Find the most recent measurement report in vault/measurements/. Returns
 * the file path or null if none exist. Used to surface measurement context
 * in the port plan header.
 */
export async function findLatestMeasurementReport(
  measurementsDir: string,
): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(measurementsDir)
  } catch {
    return null
  }
  const reports = entries
    .filter(f => f.endsWith('-measurement.md'))
    .sort()
    .reverse()
  return reports.length > 0 ? join(measurementsDir, reports[0]!) : null
}

/** Run the suggest pipeline end-to-end. */
export async function runPortSuggest(opts: SuggestOptions): Promise<{
  status: string
  planPath: string | null
}> {
  const startedAt = new Date()
  const tools = opts.toolsOverride ?? (await detectAllTools())
  const altTools = tools.filter(t => t.name !== 'void')
  const voidTool = tools.find(t => t.name === 'void')

  if (altTools.length === 0) {
    return {
      status:
        'No alternative tools detected. Install at least one of claude/codex/opencode and re-run.',
      planPath: null,
    }
  }
  if (!voidTool) {
    return {
      status:
        'Void itself was not detected — cannot diff against alternatives without a baseline.',
      planPath: null,
    }
  }

  // Mine void's source tree (the actual TS, not the bash wrapper).
  const voidSources = locateBundles('void', voidTool.binary)
  let voidStrings: string[] = []
  for (const src of voidSources) {
    if (src.kind === 'source-tree') {
      voidStrings = await mineStringsFromSourceTree(src.path)
    }
  }
  // Fallback: if locator didn't find a source tree, mine the explicit root.
  if (voidStrings.length === 0) {
    voidStrings = await mineStringsFromSourceTree(opts.voidSourceRoot)
  }

  const reports: ToolPortReport[] = []
  for (const tool of altTools) {
    const sources = locateBundles(tool.name, tool.binary)
    const altStrings = await mineBundles(sources)
    const candidates = diffStrings(altStrings, voidStrings)
    const top = rankCandidates(candidates, opts.topPerTool ?? 30)
    reports.push({
      tool: tool.name,
      version: tool.version,
      binary: tool.binary,
      candidatesFound: candidates.length,
      top,
    })
  }

  const latestMeasurement = await findLatestMeasurementReport(
    opts.measurementsDir,
  )
  const planPath = await writePortPlan({
    startedAt,
    voidVersion: voidTool.version,
    voidStringsCount: voidStrings.length,
    reports,
    latestMeasurement,
    vaultDir: opts.vaultDir,
  })

  const totalCandidates = reports.reduce((s, r) => s + r.candidatesFound, 0)
  const summary = [
    `Mined ${voidStrings.length} strings from void@${voidTool.version}.`,
    `Compared against: ${altTools.map(t => `${t.name}@${t.version}`).join(', ')}.`,
    `Found ${totalCandidates} candidate strings present in alternatives but missing from void.`,
    `Plan: \`${planPath}\``,
  ].join('\n')

  return { status: summary, planPath }
}

/** Format a single candidate row in markdown. */
function fmtCandidate(c: PortCandidate, idx: number): string {
  const escaped = c.text.replaceAll('|', '\\|')
  return `| ${idx + 1} | ${c.score.toFixed(1)} | \`${c.category}\` | ${escaped} |`
}

export type WritePlanInputs = {
  startedAt: Date
  voidVersion: string
  voidStringsCount: number
  reports: ToolPortReport[]
  latestMeasurement: string | null
  vaultDir: string
}

/** Build the full plan markdown. Pure function; tested directly. */
export function renderPortPlan(inputs: WritePlanInputs): string {
  const { startedAt, voidVersion, voidStringsCount, reports, latestMeasurement } =
    inputs
  const iso = startedAt.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 16)

  const frontmatter = [
    '---',
    `id: ${date}-${time.replace(':', '')}-port-plan`,
    `created: ${iso}`,
    'author: claude-code',
    'type: port-plan',
    'project: void-cli',
    'tags: [port-plan, void-cli, /measure, suggest]',
    '---',
  ].join('\n')

  const header = `# Port plan — ${date} ${time}

This plan was generated by \`/measure suggest\`. It lists candidate strings
present in the latest installed versions of alternative tools but missing
from void's source. Each candidate is **a hint, not a feature** — a string
that exists in claude / codex / opencode and may indicate functionality
worth porting. Investigate each, decide whether the underlying behavior is
worth bringing in, then write the port.

- **Baseline:** void@${voidVersion} (${voidStringsCount.toLocaleString()} strings mined from source)
${latestMeasurement ? `- **Linked measurement:** \`${latestMeasurement}\`` : '- **Linked measurement:** none — run `/measure` first for cost/latency context'}
`

  const toolBlocks: string[] = []
  for (const r of reports) {
    const block = [
      `## ${r.tool} — ${r.version}`,
      '',
      `Binary: \`${r.binary}\``,
      `Candidates found: ${r.candidatesFound.toLocaleString()} (showing top ${r.top.length})`,
      '',
      r.top.length > 0
        ? `| # | Score | Category | Candidate (preview) |
|---|---|---|---|
${r.top.map((c, i) => fmtCandidate(c, i)).join('\n')}`
        : '_No candidates above the noise threshold._',
    ]
    toolBlocks.push(block.join('\n'))
  }

  const guidance = `## How to use this plan

1. Skim the **prompt** and **tool-description** rows first — those are the
   strongest port signals (likely user-visible features).
2. For each candidate worth investigating, grep the alternative tool's
   binary or source for the full string to find adjacent context. For
   native binaries, \`strings <binary> | grep "PATTERN"\` widens the
   surrounding text. For codex's stub, the platform package's binary at
   \`vendor/<triple>/codex/codex\` has the full content.
3. Check whether the corresponding feature already exists in void under a
   different string — port plans are noisy by design and a fair number of
   candidates will be false positives.
4. When you decide to port: open a sub-agent with the candidate as
   context, point it at the relevant void-side files, and let it draft
   the change. Review the diff before committing.

## Caveats

- **Native binary noise.** Bun-compile and Rust binaries embed their full
  runtime. Many high-scoring strings in claude will be Bun internals, not
  claude features. Scan for content that mentions tools/skills/commands/
  prompts to find the real signal.
- **String-level diff misses behavioral changes.** A version that behaves
  differently using the *same* strings won't show up here. Pair with
  \`/measure\` cost/latency comparisons to catch those.
- **Codex's bundle is partially mined.** The JS stub is small; the real
  content is in the platform-specific native binary at
  \`node_modules/@openai/codex-<platform>/vendor/.../codex/codex\`. The
  locator follows that path automatically when present.
`

  return `${frontmatter}\n\n${header}\n${toolBlocks.join('\n\n')}\n\n${guidance}\n`
}

export async function writePortPlan(inputs: WritePlanInputs): Promise<string> {
  const body = renderPortPlan(inputs)
  const iso = inputs.startedAt.toISOString()
  const yyyy = iso.slice(0, 4)
  const mm = iso.slice(5, 7)
  const dd = iso.slice(8, 10)
  const hh = iso.slice(11, 13)
  const mi = iso.slice(14, 16)
  const filename = `${yyyy}-${mm}-${dd}-${hh}${mi}-port-plan.md`
  const target = join(inputs.vaultDir, filename)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
  return target
}

/** Read a port plan from disk. Used by future /measure apply. */
export async function readPortPlan(path: string): Promise<string> {
  return await readFile(path, 'utf8')
}
