import { type ColorType, colorize } from '../../ink/colorize.js'
import type { Color } from '../../ink/styles.js'
import { getTheme, type Theme, type ThemeName } from '../../utils/theme.js'

/**
 * Curried theme-aware color function. Resolves theme keys to raw color
 * values before delegating to the ink renderer's colorize.
 */
export function color(
  c: Exclude<keyof Theme, 'palette'> | Color | undefined,
  theme: ThemeName,
  type: ColorType = 'foreground',
): (text: string) => string {
  return text => {
    if (!c) {
      return text
    }
    // Raw color values bypass theme lookup
    if (
      c.startsWith('rgb(') ||
      c.startsWith('#') ||
      c.startsWith('ansi256(') ||
      c.startsWith('ansi:')
    ) {
      return colorize(text, c, type)
    }
    // Theme key lookup — palette is excluded from `c`, so this is a string slot
    return colorize(text, getTheme(theme)[c], type)
  }
}
