/**
 * Registry of opencode-shape themes bundled with void-cli.
 *
 * Themes are stored as JSON under ./opencode/ (copied to dist by
 * scripts/postbuild.js). At module load we enumerate the directory,
 * parse every .json file, validate its shape, and resolve it to a
 * void-cli `Theme`. Invalid files are logged and skipped; they must
 * never crash CLI startup.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Theme } from '../../utils/theme.js'
import {
  isValidOpenCodeTheme,
  loadOpenCodeTheme,
  type OpenCodeThemeJson,
} from './loader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const THEMES_DIR = join(__dirname, 'opencode')

type ThemeEntry = {
  name: string
  json: OpenCodeThemeJson
  dark: Theme
  light: Theme
}

function loadAll(): Map<string, ThemeEntry> {
  const registry = new Map<string, ThemeEntry>()
  if (!existsSync(THEMES_DIR)) {
    return registry
  }
  let files: string[]
  try {
    files = readdirSync(THEMES_DIR)
  } catch {
    return registry
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const name = file.slice(0, -'.json'.length)
    const fullPath = join(THEMES_DIR, file)
    try {
      const raw = readFileSync(fullPath, 'utf8')
      const json = JSON.parse(raw) as unknown
      if (!isValidOpenCodeTheme(json)) {
        // Malformed theme: skip silently so a bad user file never breaks the CLI.
        continue
      }
      const dark = loadOpenCodeTheme(json, 'dark')
      const light = loadOpenCodeTheme(json, 'light')
      registry.set(name, { name, json, dark, light })
    } catch {
      // Malformed JSON or resolver error: skip this theme.
      continue
    }
  }
  return registry
}

const REGISTRY = loadAll()

/** Names of every successfully-loaded opencode theme, sorted alphabetically. */
export const OPENCODE_THEME_NAMES: readonly string[] = [...REGISTRY.keys()].sort(
  (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
)

/** Returns the resolved `Theme` for `name`, or `undefined` if not found. */
export function getOpenCodeTheme(
  name: string,
  mode: 'dark' | 'light' = 'dark',
): Theme | undefined {
  const entry = REGISTRY.get(name)
  if (!entry) return undefined
  return mode === 'light' ? entry.light : entry.dark
}

/** Returns whether `name` is a registered opencode theme. */
export function hasOpenCodeTheme(name: string): boolean {
  return REGISTRY.has(name)
}

/** Returns the raw opencode JSON for `name`, or `undefined`. */
export function getOpenCodeThemeJson(name: string): OpenCodeThemeJson | undefined {
  return REGISTRY.get(name)?.json
}

/** For tests: the number of themes actually loaded. */
export function getOpenCodeThemeCount(): number {
  return REGISTRY.size
}
