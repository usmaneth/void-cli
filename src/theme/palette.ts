/**
 * Public palette accessor. Reads the active theme via the existing
 * getTheme() helper and exposes the palette namespace directly.
 *
 * Callers should prefer this over `getTheme(...).palette` so the palette
 * surface can evolve (e.g., theme-context-aware lookup) without changes
 * to call sites.
 *
 * Active-theme resolution mirrors existing call sites in `src/components/`
 * (e.g. Stats.tsx): the user's configured ThemeSetting is read from the
 * global config, then `resolveThemeSetting` collapses 'auto' down to a
 * concrete ThemeName before delegating to `getTheme`.
 */
import { getGlobalConfig } from '../utils/config.js'
import { resolveThemeSetting } from '../utils/systemTheme.js'
import { getTheme, type Theme } from '../utils/theme.js'

export type Palette = Theme['palette']

/** Get the palette of the currently active theme. */
export function getPalette(): Palette {
  return getTheme(resolveThemeSetting(getGlobalConfig().theme)).palette
}
