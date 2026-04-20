/**
 * Theme loader and resolver for opencode-shape JSON themes.
 *
 * Loads opencode-format theme JSON (with `defs` + `theme` sections) and
 * resolves them to void-cli's concrete `Theme` palette.
 *
 * The opencode format:
 *   - `defs`: named hex palette (e.g. "darkStep1": "#0a0a0a")
 *   - `theme`: semantic slots, each mapping to a hex, a def name, or a
 *     `{dark, light}` variant pair.
 *
 * We resolve slot references recursively (with circular-ref detection) and
 * map the resulting opencode slots onto void-cli's `Theme` shape. Slots void
 * has that opencode does not (rainbow_*, shimmer, TUI V2 colors, agent
 * colors, etc.) are filled from a computed fallback palette derived from the
 * theme's primary/secondary/accent and grayscale from backgrounds.
 */

import type { Theme } from '../../utils/theme.js'

type HexColor = `#${string}`
type RefName = string
type Variant = { dark: HexColor | RefName; light: HexColor | RefName }
type ColorValue = HexColor | RefName | Variant

export type OpenCodeThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: {
    primary: ColorValue
    secondary: ColorValue
    accent: ColorValue
    error: ColorValue
    warning: ColorValue
    success: ColorValue
    info: ColorValue
    text: ColorValue
    textMuted: ColorValue
    background: ColorValue
    backgroundPanel: ColorValue
    backgroundElement: ColorValue
    border: ColorValue
    borderActive: ColorValue
    borderSubtle: ColorValue
    diffAdded: ColorValue
    diffRemoved: ColorValue
    diffContext: ColorValue
    diffHunkHeader: ColorValue
    diffHighlightAdded: ColorValue
    diffHighlightRemoved: ColorValue
    diffAddedBg: ColorValue
    diffRemovedBg: ColorValue
    diffContextBg: ColorValue
    diffLineNumber: ColorValue
    diffAddedLineNumberBg: ColorValue
    diffRemovedLineNumberBg: ColorValue
    markdownText: ColorValue
    markdownHeading: ColorValue
    markdownLink: ColorValue
    markdownLinkText: ColorValue
    markdownCode: ColorValue
    markdownBlockQuote: ColorValue
    markdownEmph: ColorValue
    markdownStrong: ColorValue
    markdownHorizontalRule: ColorValue
    markdownListItem: ColorValue
    markdownListEnumeration: ColorValue
    markdownImage: ColorValue
    markdownImageText: ColorValue
    markdownCodeBlock: ColorValue
    syntaxComment: ColorValue
    syntaxKeyword: ColorValue
    syntaxFunction: ColorValue
    syntaxVariable: ColorValue
    syntaxString: ColorValue
    syntaxNumber: ColorValue
    syntaxType: ColorValue
    syntaxOperator: ColorValue
    syntaxPunctuation: ColorValue
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

/** Minimum set of slots a valid opencode theme must declare. */
const REQUIRED_SLOTS = [
  'primary',
  'secondary',
  'accent',
  'error',
  'warning',
  'success',
  'info',
  'text',
  'textMuted',
  'background',
  'backgroundPanel',
  'backgroundElement',
  'border',
  'borderActive',
  'borderSubtle',
] as const

export type ResolvedOpenCodeTheme = Record<
  (typeof REQUIRED_SLOTS)[number] | string,
  string
>

/** Rgb triple as a tuple of 0-255 ints. */
export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace(/^#/, '')
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16)
    const g = parseInt(clean[1]! + clean[1]!, 16)
    const b = parseInt(clean[2]! + clean[2]!, 16)
    return [r, g, b]
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    return [r, g, b]
  }
  throw new Error(`Invalid hex color: ${hex}`)
}

export function rgbString([r, g, b]: Rgb): string {
  return `rgb(${r},${g},${b})`
}

/** Linearly blend two RGBs. alpha=0 → a, alpha=1 → b. */
export function mixRgb(a: Rgb, b: Rgb, alpha: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * alpha),
    Math.round(a[1] + (b[1] - a[1]) * alpha),
    Math.round(a[2] + (b[2] - a[2]) * alpha),
  ]
}

export function lighten(rgb: Rgb, amount: number): Rgb {
  return mixRgb(rgb, [255, 255, 255], amount)
}

export function darken(rgb: Rgb, amount: number): Rgb {
  return mixRgb(rgb, [0, 0, 0], amount)
}

export function isValidOpenCodeTheme(value: unknown): value is OpenCodeThemeJson {
  if (!value || typeof value !== 'object') return false
  const t = (value as Record<string, unknown>).theme
  if (!t || typeof t !== 'object') return false
  for (const slot of REQUIRED_SLOTS) {
    if (!(slot in (t as Record<string, unknown>))) return false
  }
  return true
}

/**
 * Resolve a raw opencode theme JSON into a flat map of slot → hex string.
 * Throws if references are circular or point to missing defs/slots.
 */
export function resolveOpenCodeTheme(
  json: OpenCodeThemeJson,
  mode: 'dark' | 'light' = 'dark',
): ResolvedOpenCodeTheme {
  if (!isValidOpenCodeTheme(json)) {
    throw new Error('Invalid opencode theme JSON: missing required slots')
  }

  const defs = json.defs ?? {}
  const themeSlots = json.theme as Record<string, ColorValue | number>

  function resolveHex(value: ColorValue, chain: string[] = []): string {
    if (typeof value === 'string') {
      if (value === 'transparent' || value === 'none') return '#00000000'
      if (value.startsWith('#')) return value
      if (chain.includes(value)) {
        throw new Error(
          `Circular theme color reference: ${[...chain, value].join(' -> ')}`,
        )
      }
      const defVal = defs[value]
      if (defVal !== undefined) {
        return resolveHex(defVal, [...chain, value])
      }
      const slotVal = themeSlots[value] as ColorValue | undefined
      if (slotVal !== undefined && typeof slotVal !== 'number') {
        return resolveHex(slotVal, [...chain, value])
      }
      throw new Error(`Unknown theme color reference: ${value}`)
    }
    if (typeof value === 'object' && value !== null) {
      return resolveHex(value[mode], chain)
    }
    throw new Error(`Unsupported color value: ${JSON.stringify(value)}`)
  }

  const out: Record<string, string> = {}
  for (const [slot, raw] of Object.entries(themeSlots)) {
    if (slot === 'thinkingOpacity') continue
    if (raw === undefined) continue
    if (typeof raw === 'number') continue
    out[slot] = resolveHex(raw as ColorValue)
  }
  return out as ResolvedOpenCodeTheme
}

/**
 * Map an opencode-resolved theme to void-cli's full `Theme` shape.
 *
 * Slot mapping (summary — see MAPPING.md for rationale):
 *   claude              <- primary
 *   claudeShimmer       <- lighten(primary, 0.2)
 *   claudeBlue_FOR_SYSTEM_SPINNER   <- info
 *   claudeBlueShimmer_FOR_SYSTEM_SPINNER <- lighten(info, 0.2)
 *   permission          <- info
 *   permissionShimmer   <- lighten(info, 0.2)
 *   autoAccept          <- accent
 *   bashBorder          <- border
 *   planMode            <- success
 *   ide                 <- info
 *   promptBorder        <- border
 *   promptBorderShimmer <- lighten(border, 0.2)
 *   text                <- text
 *   inverseText         <- background
 *   inactive            <- textMuted
 *   inactiveShimmer     <- lighten(textMuted, 0.2)
 *   subtle              <- borderSubtle
 *   suggestion          <- info
 *   remember            <- secondary
 *   background          <- background
 *   success             <- success
 *   error               <- error
 *   warning             <- warning
 *   warningShimmer      <- lighten(warning, 0.2)
 *   merged              <- accent
 *   diffAdded           <- diffAddedBg
 *   diffRemoved         <- diffRemovedBg
 *   diffAddedDimmed     <- mix(background, diffAddedBg, 0.5)
 *   diffRemovedDimmed   <- mix(background, diffRemovedBg, 0.5)
 *   diffAddedWord       <- diffAdded
 *   diffRemovedWord     <- diffRemoved
 *   red_FOR_SUBAGENTS_ONLY    <- error
 *   blue_FOR_SUBAGENTS_ONLY   <- info
 *   green_FOR_SUBAGENTS_ONLY  <- success
 *   yellow_FOR_SUBAGENTS_ONLY <- warning
 *   purple_FOR_SUBAGENTS_ONLY <- accent
 *   orange_FOR_SUBAGENTS_ONLY <- mix(warning, error, 0.5)
 *   pink_FOR_SUBAGENTS_ONLY   <- mix(error, accent, 0.5)
 *   cyan_FOR_SUBAGENTS_ONLY   <- info
 *   professionalBlue    <- info
 *   chromeYellow        <- warning
 *   clawd_body          <- primary
 *   clawd_background    <- background
 *   userMessageBackground        <- backgroundPanel
 *   userMessageBackgroundHover   <- backgroundElement
 *   messageActionsBackground     <- backgroundElement
 *   selectionBg         <- borderActive
 *   bashMessageBackgroundColor   <- backgroundPanel
 *   memoryBackgroundColor        <- backgroundPanel
 *   rate_limit_fill     <- primary
 *   rate_limit_empty    <- borderSubtle
 *   fastMode            <- mix(warning, error, 0.4)
 *   fastModeShimmer     <- lighten(mix(warning,error,0.4), 0.2)
 *   briefLabelYou       <- textMuted
 *   briefLabelClaude    <- primary
 *   rainbow_*           <- rotated palette around primary/accent/secondary
 */
export function mapToVoidTheme(resolved: ResolvedOpenCodeTheme): Theme {
  const hex = (slot: string): Rgb => hexToRgb(resolved[slot] ?? '#000000')

  const primary = hex('primary')
  const secondary = hex('secondary')
  const accent = hex('accent')
  const error = hex('error')
  const warning = hex('warning')
  const success = hex('success')
  const info = hex('info')
  const text = hex('text')
  const textMuted = hex('textMuted')
  const bg = hex('background')
  const panel = hex('backgroundPanel')
  const element = hex('backgroundElement')
  const border = hex('border')
  const borderActive = hex('borderActive')
  const borderSubtle = hex('borderSubtle')

  const diffAddedBg = resolved.diffAddedBg ? hex('diffAddedBg') : mixRgb(bg, success, 0.3)
  const diffRemovedBg = resolved.diffRemovedBg ? hex('diffRemovedBg') : mixRgb(bg, error, 0.3)
  const diffAddedWord = resolved.diffHighlightAdded ? hex('diffHighlightAdded') : success
  const diffRemovedWord = resolved.diffHighlightRemoved
    ? hex('diffHighlightRemoved')
    : error

  const orange = mixRgb(warning, error, 0.5)
  const pink = mixRgb(error, accent, 0.5)
  const fastMode = mixRgb(warning, error, 0.4)

  // Rainbow: rotate around primary/accent/secondary, shifted toward warning/error/success.
  const rainbow = {
    red: error,
    orange: mixRgb(error, warning, 0.5),
    yellow: warning,
    green: success,
    blue: info,
    indigo: mixRgb(info, secondary, 0.5),
    violet: secondary,
  } as const

  const rgb = (c: Rgb) => rgbString(c)

  return {
    autoAccept: rgb(accent),
    bashBorder: rgb(border),
    claude: rgb(primary),
    claudeShimmer: rgb(lighten(primary, 0.2)),
    claudeBlue_FOR_SYSTEM_SPINNER: rgb(info),
    claudeBlueShimmer_FOR_SYSTEM_SPINNER: rgb(lighten(info, 0.2)),
    permission: rgb(info),
    permissionShimmer: rgb(lighten(info, 0.2)),
    planMode: rgb(success),
    ide: rgb(info),
    promptBorder: rgb(border),
    promptBorderShimmer: rgb(lighten(border, 0.2)),
    text: rgb(text),
    inverseText: rgb(bg),
    inactive: rgb(textMuted),
    inactiveShimmer: rgb(lighten(textMuted, 0.2)),
    subtle: rgb(borderSubtle),
    suggestion: rgb(info),
    remember: rgb(secondary),
    background: rgb(bg),
    success: rgb(success),
    error: rgb(error),
    warning: rgb(warning),
    merged: rgb(accent),
    warningShimmer: rgb(lighten(warning, 0.2)),
    diffAdded: rgb(diffAddedBg),
    diffRemoved: rgb(diffRemovedBg),
    diffAddedDimmed: rgb(mixRgb(bg, diffAddedBg, 0.5)),
    diffRemovedDimmed: rgb(mixRgb(bg, diffRemovedBg, 0.5)),
    diffAddedWord: rgb(diffAddedWord),
    diffRemovedWord: rgb(diffRemovedWord),
    red_FOR_SUBAGENTS_ONLY: rgb(error),
    blue_FOR_SUBAGENTS_ONLY: rgb(info),
    green_FOR_SUBAGENTS_ONLY: rgb(success),
    yellow_FOR_SUBAGENTS_ONLY: rgb(warning),
    purple_FOR_SUBAGENTS_ONLY: rgb(accent),
    orange_FOR_SUBAGENTS_ONLY: rgb(orange),
    pink_FOR_SUBAGENTS_ONLY: rgb(pink),
    cyan_FOR_SUBAGENTS_ONLY: rgb(info),
    professionalBlue: rgb(info),
    chromeYellow: rgb(warning),
    clawd_body: rgb(primary),
    clawd_background: rgb(bg),
    userMessageBackground: rgb(panel),
    userMessageBackgroundHover: rgb(element),
    messageActionsBackground: rgb(element),
    selectionBg: rgb(borderActive),
    bashMessageBackgroundColor: rgb(panel),
    memoryBackgroundColor: rgb(panel),
    rate_limit_fill: rgb(primary),
    rate_limit_empty: rgb(borderSubtle),
    fastMode: rgb(fastMode),
    fastModeShimmer: rgb(lighten(fastMode, 0.2)),
    briefLabelYou: rgb(textMuted),
    briefLabelClaude: rgb(primary),
    rainbow_red: rgb(rainbow.red),
    rainbow_orange: rgb(rainbow.orange),
    rainbow_yellow: rgb(rainbow.yellow),
    rainbow_green: rgb(rainbow.green),
    rainbow_blue: rgb(rainbow.blue),
    rainbow_indigo: rgb(rainbow.indigo),
    rainbow_violet: rgb(rainbow.violet),
    rainbow_red_shimmer: rgb(lighten(rainbow.red, 0.2)),
    rainbow_orange_shimmer: rgb(lighten(rainbow.orange, 0.2)),
    rainbow_yellow_shimmer: rgb(lighten(rainbow.yellow, 0.2)),
    rainbow_green_shimmer: rgb(lighten(rainbow.green, 0.2)),
    rainbow_blue_shimmer: rgb(lighten(rainbow.blue, 0.2)),
    rainbow_indigo_shimmer: rgb(lighten(rainbow.indigo, 0.2)),
    rainbow_violet_shimmer: rgb(lighten(rainbow.violet, 0.2)),
  }
}

/** Load, validate, and map an opencode JSON theme to void's Theme. */
export function loadOpenCodeTheme(
  json: OpenCodeThemeJson,
  mode: 'dark' | 'light' = 'dark',
): Theme {
  const resolved = resolveOpenCodeTheme(json, mode)
  return mapToVoidTheme(resolved)
}
