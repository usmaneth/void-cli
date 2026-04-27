/**
 * Corpus loader for /measure: sample real prompts from the user's history.
 *
 * Reads `~/.void/history.jsonl` line-by-line, filters to the current project,
 * drops slash-commands and trivial prompts, returns the most recent N.
 *
 * Kept as pure functions over string/array inputs so it can be tested without
 * mocking the filesystem — the `sampleRecentPromptsFromLines` helper takes raw
 * JSONL lines, while `sampleRecentPrompts` wraps it with actual disk I/O.
 */

import { readFile } from 'fs/promises'
import { MIN_PROMPT_CHARS, type PromptEntry } from './types.js'

export type SampleOptions = {
  n: number
  projectPath: string
  historyPath: string
}

/**
 * Parse a single history.jsonl line into a PromptEntry, or null if malformed
 * or missing required fields. Never throws — corrupt lines are silently
 * skipped so one bad entry can't poison an entire run.
 */
export function parseHistoryLine(line: string): PromptEntry | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (
    typeof obj['display'] !== 'string' ||
    typeof obj['timestamp'] !== 'number' ||
    typeof obj['project'] !== 'string' ||
    typeof obj['sessionId'] !== 'string'
  ) {
    return null
  }
  return {
    display: obj['display'],
    timestamp: obj['timestamp'],
    project: obj['project'],
    sessionId: obj['sessionId'],
  }
}

/**
 * A prompt qualifies for replay when:
 * - it matches the current project path exactly
 * - it is not a slash-command (leading `/`, `!`, or `#`)
 * - it has at least MIN_PROMPT_CHARS non-whitespace characters
 *
 * Slash-commands are excluded because they trigger skills/commands rather
 * than free-form queries — replaying them measures the skill machinery, not
 * model behavior. Trivial prompts (`yo`, `ok`, `?`) produce noise in metrics.
 */
export function isReplayableForProject(
  entry: PromptEntry,
  projectPath: string,
): boolean {
  if (entry.project !== projectPath) return false
  const display = entry.display.trim()
  if (display.length < MIN_PROMPT_CHARS) return false
  const first = display[0]
  if (first === '/' || first === '!' || first === '#') return false
  return true
}

/**
 * Given raw JSONL lines, return the most recent N prompts for `projectPath`
 * that qualify for replay. Deterministic: ties broken by later line order.
 * Pure function — take any string source, no I/O.
 */
export function sampleRecentPromptsFromLines(
  lines: string[],
  opts: Omit<SampleOptions, 'historyPath'>,
): PromptEntry[] {
  const entries: PromptEntry[] = []
  for (const line of lines) {
    const parsed = parseHistoryLine(line)
    if (parsed === null) continue
    if (!isReplayableForProject(parsed, opts.projectPath)) continue
    entries.push(parsed)
  }
  // Stable-sort newest-first then take N.
  entries.sort((a, b) => b.timestamp - a.timestamp)
  return entries.slice(0, opts.n)
}

/**
 * Read history.jsonl from disk and sample the most recent N replayable
 * prompts for the current project. Returns an empty array if the file is
 * missing — the caller reports that to the user.
 */
export async function sampleRecentPrompts(
  opts: SampleOptions,
): Promise<PromptEntry[]> {
  let raw: string
  try {
    raw = await readFile(opts.historyPath, 'utf8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return []
    throw e
  }
  return sampleRecentPromptsFromLines(raw.split('\n'), opts)
}
