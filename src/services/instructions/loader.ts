/**
 * Layered instructions loader.
 *
 * Resolves `instructions` (inline text) and `instructionFiles` (paths to .md
 * files) from each settings layer — global (user), workspace (project), and
 * local — and merges them via array concatenation. Higher layers never
 * override lower layers; they append.
 *
 * File resolution:
 *   - Absolute paths are used as-is.
 *   - Relative paths are resolved against the ROOT of the declaring layer:
 *       user layer      → ~/.void/
 *       workspace layer → <cwd>/
 *       local layer     → <cwd>/
 *   - Missing files are silently skipped (a warning is logged without the
 *     absolute path to avoid leaking filesystem structure into logs).
 *
 * Caching:
 *   - Each file's contents are cached keyed by absolute path.
 *   - On each load the cached entry is invalidated when the file's mtime
 *     changes. ENOENT invalidates the cache and returns null for that file.
 *
 * Auto-discovery:
 *   - When `autoDiscoverInstructionFiles` is not explicitly false, the
 *     workspace root is scanned for CLAUDE.md and AGENTS.md. Found files are
 *     loaded at the workspace layer (after explicit workspace files).
 */

import { existsSync, statSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import type { SettingsJson } from '../../utils/settings/types.js'

export type InstructionLayer = 'user' | 'workspace' | 'local'

export type InstructionSource =
  | { kind: 'inline'; layer: InstructionLayer; index: number }
  | {
      kind: 'file'
      layer: InstructionLayer
      filename: string // basename only — never an absolute path, safe to log
      autoDiscovered?: boolean
    }

export type InstructionEntry = {
  source: InstructionSource
  content: string
}

export type InstructionLayerInput = {
  layer: InstructionLayer
  rootDir: string
  settings: SettingsJson | null | undefined
}

export type LoadedInstructions = {
  entries: InstructionEntry[]
  /** Layers that actually contributed at least one non-empty entry. */
  contributingLayers: InstructionLayer[]
  /** Count of entries per layer (user/workspace/local), for log output. */
  layerCounts: Record<InstructionLayer, number>
}

type CacheEntry = {
  mtimeMs: number
  size: number
  content: string
}

const fileCache = new Map<string, CacheEntry>()

/** Exposed for tests. Clears the mtime-keyed file cache. */
export function clearInstructionsCache(): void {
  fileCache.clear()
}

/**
 * Read a file with mtime-based cache invalidation.
 * Returns null if the file is missing or unreadable.
 */
function readFileCached(absPath: string): string | null {
  let stat
  try {
    stat = statSync(absPath)
  } catch {
    // Missing or unreadable — evict cache and bail out.
    fileCache.delete(absPath)
    return null
  }

  if (!stat.isFile()) {
    fileCache.delete(absPath)
    return null
  }

  const cached = fileCache.get(absPath)
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.content
  }

  let content: string
  try {
    content = readFileSync(absPath, 'utf8')
  } catch {
    fileCache.delete(absPath)
    return null
  }

  fileCache.set(absPath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    content,
  })
  return content
}

/**
 * Resolve a (possibly relative) instruction file path against a layer's root
 * directory. Absolute paths pass through untouched.
 */
export function resolveInstructionFilePath(
  rawPath: string,
  layerRoot: string,
): string {
  if (isAbsolute(rawPath)) {
    return resolve(rawPath)
  }
  return resolve(join(layerRoot, rawPath))
}

function basenameSafe(absPath: string): string {
  // Use last path segment only — the basename is effectively the user-facing
  // identifier and doesn't expose the rest of the filesystem layout.
  const idx = Math.max(
    absPath.lastIndexOf('/'),
    absPath.lastIndexOf('\\'),
  )
  return idx >= 0 ? absPath.slice(idx + 1) : absPath
}

function collectInlineEntries(
  layer: InstructionLayer,
  settings: SettingsJson | null | undefined,
): InstructionEntry[] {
  if (!settings) return []
  const raw = (settings as { instructions?: string | string[] }).instructions
  if (raw === undefined || raw === null) return []

  const items = Array.isArray(raw) ? raw : [raw]
  const entries: InstructionEntry[] = []
  items.forEach((text, index) => {
    if (typeof text !== 'string') return
    const trimmed = text.trim()
    if (!trimmed) return
    entries.push({
      source: { kind: 'inline', layer, index },
      content: trimmed,
    })
  })
  return entries
}

function collectFileEntries(
  layer: InstructionLayer,
  settings: SettingsJson | null | undefined,
  rootDir: string,
  onWarn?: (message: string) => void,
): InstructionEntry[] {
  if (!settings) return []
  const files = (settings as { instructionFiles?: string[] }).instructionFiles
  if (!Array.isArray(files)) return []

  const entries: InstructionEntry[] = []
  for (const raw of files) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const absPath = resolveInstructionFilePath(raw, rootDir)
    const content = readFileCached(absPath)
    if (content === null) {
      // Log a warning WITHOUT the absolute path — we only surface the basename
      // so logs never leak filesystem layout.
      onWarn?.(
        `instructions: skipping missing file ${basenameSafe(absPath)} (${layer} layer)`,
      )
      continue
    }
    const trimmed = content.trim()
    if (!trimmed) continue
    entries.push({
      source: {
        kind: 'file',
        layer,
        filename: basenameSafe(absPath),
      },
      content: trimmed,
    })
  }
  return entries
}

const AUTO_DISCOVER_FILENAMES = ['CLAUDE.md', 'AGENTS.md'] as const

function collectAutoDiscoveredEntries(
  workspaceRoot: string,
  settings: SettingsJson | null | undefined,
): InstructionEntry[] {
  // Opt-out: explicitly set to false. Undefined / any other value → enabled.
  const optOut =
    settings &&
    (settings as { autoDiscoverInstructionFiles?: boolean })
      .autoDiscoverInstructionFiles === false
  if (optOut) return []

  const entries: InstructionEntry[] = []
  for (const filename of AUTO_DISCOVER_FILENAMES) {
    const absPath = resolve(join(workspaceRoot, filename))
    if (!existsSync(absPath)) continue
    const content = readFileCached(absPath)
    if (content === null) continue
    const trimmed = content.trim()
    if (!trimmed) continue
    entries.push({
      source: {
        kind: 'file',
        layer: 'workspace',
        filename,
        autoDiscovered: true,
      },
      content: trimmed,
    })
  }
  return entries
}

/**
 * Input for the full load. Layers are listed in order of application —
 * entries within a layer stay in declaration order, and layers later in
 * the array land later in the merged output (so local wins tie-breaks when
 * callers iterate, but nothing is ever dropped).
 */
export type LoadInstructionsInput = {
  userLayer?: { rootDir: string; settings: SettingsJson | null | undefined }
  workspaceLayer?: {
    rootDir: string
    settings: SettingsJson | null | undefined
  }
  localLayer?: { rootDir: string; settings: SettingsJson | null | undefined }
  /** Called with a warning message (no paths) for each missing file. */
  onWarn?: (message: string) => void
}

/**
 * Load and merge instructions across global → workspace → local layers.
 *
 * Merge semantics: **array concatenation**. A lower layer's entries are
 * never replaced by higher layers; higher layers append. Within each layer
 * inline text comes before file-based text, and auto-discovered workspace
 * files land at the tail of the workspace layer (after explicit files).
 */
export function loadLayeredInstructions(
  input: LoadInstructionsInput,
): LoadedInstructions {
  const entries: InstructionEntry[] = []
  const layerCounts: Record<InstructionLayer, number> = {
    user: 0,
    workspace: 0,
    local: 0,
  }

  const pushForLayer = (
    layer: InstructionLayer,
    layerEntries: InstructionEntry[],
  ) => {
    for (const entry of layerEntries) entries.push(entry)
    layerCounts[layer] += layerEntries.length
  }

  if (input.userLayer) {
    const { rootDir, settings } = input.userLayer
    pushForLayer('user', collectInlineEntries('user', settings))
    pushForLayer(
      'user',
      collectFileEntries('user', settings, rootDir, input.onWarn),
    )
  }

  if (input.workspaceLayer) {
    const { rootDir, settings } = input.workspaceLayer
    pushForLayer('workspace', collectInlineEntries('workspace', settings))
    pushForLayer(
      'workspace',
      collectFileEntries('workspace', settings, rootDir, input.onWarn),
    )
    pushForLayer(
      'workspace',
      collectAutoDiscoveredEntries(rootDir, settings),
    )
  }

  if (input.localLayer) {
    const { rootDir, settings } = input.localLayer
    pushForLayer('local', collectInlineEntries('local', settings))
    pushForLayer(
      'local',
      collectFileEntries('local', settings, rootDir, input.onWarn),
    )
  }

  const contributingLayers: InstructionLayer[] = (
    ['user', 'workspace', 'local'] as const
  ).filter(l => layerCounts[l] > 0)

  return { entries, contributingLayers, layerCounts }
}

/**
 * Format merged instructions as a single string block to append to the
 * system prompt. Each entry is prefixed by a compact header identifying its
 * layer and source, so the model can attribute rules to their origin without
 * exposing absolute paths.
 */
export function formatInstructionsBlock(
  loaded: LoadedInstructions,
): string | null {
  if (loaded.entries.length === 0) return null

  const parts: string[] = []
  parts.push('# Layered Instructions')
  parts.push(
    `Contributing layers: ${loaded.contributingLayers.join(' → ') || '(none)'}`,
  )
  for (const entry of loaded.entries) {
    const s = entry.source
    const header =
      s.kind === 'inline'
        ? `## ${capitalize(s.layer)} settings (inline ${s.index + 1})`
        : `## ${capitalize(s.layer)} file: ${s.filename}${
            s.autoDiscovered ? ' (auto-discovered)' : ''
          }`
    parts.push(header)
    parts.push(entry.content)
  }
  return parts.join('\n\n')
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}
