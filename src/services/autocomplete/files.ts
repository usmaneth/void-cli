/**
 * File autocomplete engine.
 *
 * Combines void's existing fuzzy-matching FileIndex (nucleo-style scoring, see
 * src/native-ts/file-index) with a frecency store (see services/frecency/store)
 * to rank file suggestions.
 *
 * Ranking formula:
 *     final = fuzzy_weight * (1 + FRECENCY_BOOST * frecency_score)
 *
 * where fuzzy_weight = (1 - normalizedPositionScore) in [0, 1] -- best fuzzy
 * match is 1.0 -- and frecency_score is calculated by services/frecency.
 *
 * Intentionally does NOT replace the existing file index -- that index is
 * already tuned for 10k+ repos (<50ms target) and is the "fuzzysort" this
 * port needs. We layer frecency on top and add line-range awareness.
 */

import * as path from 'node:path'
import { FileIndex } from '../../native-ts/file-index/index.js'
import { detectLanguage } from '../../fileref/index.js'
import { calculateFrecency, FrecencyStore, getFrecencyStore } from '../frecency/store.js'
import { stripLineRange } from './line-range.js'

// Hooks live in src/hooks/fileSuggestions and pull in a significant chunk of
// the app (git, ripgrep, settings ...). Lazy-import so the sync/pure helpers
// in this file can be unit-tested without the full runtime graph.
type FileSuggestionsModule = typeof import('../../hooks/fileSuggestions.js')
let fileSuggestionsMod: FileSuggestionsModule | null = null
async function loadFileSuggestions(): Promise<FileSuggestionsModule> {
  if (!fileSuggestionsMod) {
    fileSuggestionsMod = await import('../../hooks/fileSuggestions.js')
  }
  return fileSuggestionsMod
}

type CwdModule = typeof import('../../utils/cwd.js')
let cwdMod: CwdModule | null = null
async function loadCwd(): Promise<string> {
  if (!cwdMod) {
    cwdMod = await import('../../utils/cwd.js')
  }
  return cwdMod.getCwd()
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileSuggestion {
  /** Path relative to cwd (matches how users type @mentions). */
  path: string
  /** Final combined score (higher = better). */
  score: number
  /** Raw fuzzy score component (1.0 = best). */
  fuzzyScore: number
  /** Raw frecency score component (0 if never accessed). */
  frecencyScore: number
  /** File basename for display. */
  basename: string
  /** Directory portion (breadcrumb). Empty for top-level files. */
  breadcrumb: string
  /** Icon character for common file types. */
  icon: string
  /** Detected language (see fileref.detectLanguage). */
  language?: string
}

export interface AutocompleteOptions {
  /** Max results. Default 20 (matches opencode). */
  limit?: number
  /** Weight multiplier for frecency. Default 2. Higher = frecency dominates. */
  frecencyBoost?: number
  /** Override cwd (for tests). */
  cwd?: string
  /** Override the FileIndex (for tests). */
  fileIndex?: FileIndex
  /** Override the frecency store (for tests). */
  frecencyStore?: FrecencyStore
  /** When set, returns only files whose relative path starts with this prefix. */
  includePathPrefix?: string
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20
const DEFAULT_FRECENCY_BOOST = 2

// Common-extension icon map. Purely cosmetic -- Ink renders these as text.
const ICON_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TS',
  '.tsx': 'TSX',
  '.js': 'JS',
  '.jsx': 'JSX',
  '.mjs': 'JS',
  '.cjs': 'JS',
  '.py': 'PY',
  '.go': 'GO',
  '.rs': 'RS',
  '.md': 'MD',
  '.json': '{}',
  '.yaml': 'YML',
  '.yml': 'YML',
  '.toml': 'TOM',
  '.html': '<>',
  '.css': 'CSS',
  '.sql': 'SQL',
  '.sh': '$',
  '.bash': '$',
  '.zsh': '$',
}
const FOLDER_ICON = 'DIR'
const FILE_ICON = '-'

function iconFor(filePath: string): string {
  if (filePath.endsWith('/') || filePath.endsWith(path.sep)) return FOLDER_ICON
  const ext = path.extname(filePath).toLowerCase()
  return ICON_BY_EXTENSION[ext] ?? FILE_ICON
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Combine fuzzy + frecency scores.
 * Separated out so tests can lock the formula.
 */
export function combineScores(
  fuzzyScore: number,
  frecencyScore: number,
  frecencyBoost: number = DEFAULT_FRECENCY_BOOST,
): number {
  // fuzzyScore is in [0, 1]; frecencyScore is unbounded but typically [0, ~50].
  // `1 +` keeps fuzzy-only cases comparable (multiplicative form matches opencode).
  return fuzzyScore * (1 + frecencyBoost * frecencyScore)
}

/**
 * Convert a FileIndex search result (lower = better, normalized to [0,1])
 * to a fuzzy weight where 1.0 is best.
 */
function fuzzyWeightFromIndexScore(indexScore: number): number {
  // FileIndex returns positionScore = i / matchCount, so 0 is best.
  return 1 - Math.min(1, Math.max(0, indexScore))
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Build autocomplete suggestions for `query`.
 *
 * Empty query -> top-N most-frecent files (falls back to FileIndex top-level).
 * Non-empty query -> fuzzy match against the workspace + frecency boost.
 *
 * This wraps `generateFileSuggestions` rather than rebuilding the index; the
 * existing code already respects .gitignore, handles git ls-files, and scales
 * to 10k+ files with progressive indexing.
 */
export async function getFileAutocomplete(
  query: string,
  options: AutocompleteOptions = {},
): Promise<FileSuggestion[]> {
  const {
    limit = DEFAULT_LIMIT,
    frecencyBoost = DEFAULT_FRECENCY_BOOST,
    frecencyStore = getFrecencyStore(),
    includePathPrefix,
  } = options
  const cwd = options.cwd ?? (await loadCwd())

  const now = Date.now()
  const strippedQuery = stripLineRange(query)

  // Empty query: surface frecency-ranked recent files first.
  if (strippedQuery.trim() === '') {
    return topFrecentSuggestions(frecencyStore, limit, cwd, now, includePathPrefix)
  }

  // Run through the existing fuzzy index (respects .gitignore etc.).
  // We ask for a wider pool than `limit` so frecency re-ranking has room to
  // promote items that weren't in the raw top-N.
  const pool = Math.max(limit * 3, 60)
  const { generateFileSuggestions } = await loadFileSuggestions()
  const rawResults = await generateFileSuggestions(strippedQuery)
  const sliced = rawResults.slice(0, pool)

  const scored: FileSuggestion[] = []
  for (const item of sliced) {
    const rel = item.displayText
    if (includePathPrefix && !rel.startsWith(includePathPrefix)) continue
    const meta = item.metadata as { score?: number } | undefined
    const fuzzyScore = fuzzyWeightFromIndexScore(
      typeof meta?.score === 'number' ? meta.score : 0,
    )
    const abs = path.resolve(cwd, rel)
    const frecencyScore = frecencyStore.score(abs, now)
    const finalScore = combineScores(fuzzyScore, frecencyScore, frecencyBoost)
    scored.push(makeSuggestion(rel, finalScore, fuzzyScore, frecencyScore))
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/**
 * Synchronous, index-first variant. Cheaper (no async) for use inside
 * render paths. Uses an already-built FileIndex; if none exists, triggers
 * one in the background and returns frecency-only results meanwhile.
 */
export function getFileAutocompleteSync(
  query: string,
  index: FileIndex,
  options: AutocompleteOptions = {},
): FileSuggestion[] {
  const {
    limit = DEFAULT_LIMIT,
    frecencyBoost = DEFAULT_FRECENCY_BOOST,
    cwd = options.cwd ?? process.cwd(),
    frecencyStore = getFrecencyStore(),
    includePathPrefix,
  } = options

  const now = Date.now()
  const strippedQuery = stripLineRange(query)

  if (strippedQuery.trim() === '') {
    return topFrecentSuggestions(frecencyStore, limit, cwd, now, includePathPrefix)
  }

  const pool = Math.max(limit * 3, 60)
  const raw = index.search(strippedQuery, pool)
  const scored: FileSuggestion[] = []
  for (const r of raw) {
    if (includePathPrefix && !r.path.startsWith(includePathPrefix)) continue
    const fuzzyScore = fuzzyWeightFromIndexScore(r.score)
    const abs = path.resolve(cwd, r.path)
    const frecencyScore = frecencyStore.score(abs, now)
    const finalScore = combineScores(fuzzyScore, frecencyScore, frecencyBoost)
    scored.push(makeSuggestion(r.path, finalScore, fuzzyScore, frecencyScore))
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/**
 * Pre-warm the workspace index so the first @-keystroke doesn't block.
 * Safe to call multiple times -- internally throttled by the underlying cache.
 */
export async function warmFileAutocomplete(): Promise<void> {
  try {
    const { getPathsForSuggestions } = await loadFileSuggestions()
    await getPathsForSuggestions()
  } catch {
    // Non-fatal -- same policy as upstream fileSuggestions.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topFrecentSuggestions(
  store: FrecencyStore,
  limit: number,
  cwd: string,
  now: number,
  includePathPrefix?: string,
): FileSuggestion[] {
  const top = store.topByFrecency(limit * 2, now)
  const out: FileSuggestion[] = []
  for (const entry of top) {
    const rel = path.relative(cwd, entry.path)
    // Skip entries outside cwd -- a user mentioning @foo expects files in
    // this workspace. Frecency tracks globally so home-dir files leak in.
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    if (includePathPrefix && !rel.startsWith(includePathPrefix)) continue
    const fScore = calculateFrecency(entry, now)
    out.push(makeSuggestion(rel, fScore, 0, fScore))
    if (out.length >= limit) break
  }
  return out
}

function makeSuggestion(
  relPath: string,
  score: number,
  fuzzyScore: number,
  frecencyScore: number,
): FileSuggestion {
  const basename = path.basename(relPath)
  const dir = path.dirname(relPath)
  const breadcrumb = dir === '.' || dir === '' ? '' : dir
  return {
    path: relPath,
    score,
    fuzzyScore,
    frecencyScore,
    basename,
    breadcrumb,
    icon: iconFor(relPath),
    language: detectLanguage(relPath),
  }
}
