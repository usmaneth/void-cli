# Opencode → Void theme slot mapping

Void's `Theme` type (see `src/utils/theme.ts`) has ~80 slots covering UI
chrome, agent colors, shimmer variants, a full rainbow palette, and legacy
TUI V1/V2 compatibility colors. Opencode's theme format has ~48 slots
centered on syntax highlighting, diffs, markdown, and minimal UI chrome.

The loader (`loader.ts` → `mapToVoidTheme`) maps every void slot from the
opencode semantic palette. Slots void has that opencode does not are derived
computationally (lightening, darkening, or blending opencode primitives).

## Direct mappings

| Void slot | Opencode slot |
| --- | --- |
| `claude` | `primary` |
| `background` | `background` |
| `text` | `text` |
| `inverseText` | `background` |
| `inactive` | `textMuted` |
| `subtle` | `borderSubtle` |
| `success` | `success` |
| `error` | `error` |
| `warning` | `warning` |
| `suggestion` | `info` |
| `ide` | `info` |
| `permission` | `info` |
| `claudeBlue_FOR_SYSTEM_SPINNER` | `info` |
| `planMode` | `success` |
| `remember` | `secondary` |
| `autoAccept` | `accent` |
| `merged` | `accent` |
| `bashBorder` | `border` |
| `promptBorder` | `border` |
| `selectionBg` | `borderActive` |
| `userMessageBackground` | `backgroundPanel` |
| `userMessageBackgroundHover` | `backgroundElement` |
| `messageActionsBackground` | `backgroundElement` |
| `bashMessageBackgroundColor` | `backgroundPanel` |
| `memoryBackgroundColor` | `backgroundPanel` |
| `clawd_body` | `primary` |
| `clawd_background` | `background` |
| `chromeYellow` | `warning` |
| `professionalBlue` | `info` |
| `diffAdded` | `diffAddedBg` |
| `diffRemoved` | `diffRemovedBg` |
| `diffAddedWord` | `diffHighlightAdded` (fallback: `success`) |
| `diffRemovedWord` | `diffHighlightRemoved` (fallback: `error`) |
| `rate_limit_fill` | `primary` |
| `rate_limit_empty` | `borderSubtle` |
| `briefLabelYou` | `textMuted` |
| `briefLabelClaude` | `primary` |

## Subagent colors

Opencode has no subagent palette. Void needs 8 named agent colors:

| Void slot | Derivation |
| --- | --- |
| `red_FOR_SUBAGENTS_ONLY` | `error` |
| `blue_FOR_SUBAGENTS_ONLY` | `info` |
| `green_FOR_SUBAGENTS_ONLY` | `success` |
| `yellow_FOR_SUBAGENTS_ONLY` | `warning` |
| `purple_FOR_SUBAGENTS_ONLY` | `accent` |
| `orange_FOR_SUBAGENTS_ONLY` | `mix(warning, error, 0.5)` |
| `pink_FOR_SUBAGENTS_ONLY` | `mix(error, accent, 0.5)` |
| `cyan_FOR_SUBAGENTS_ONLY` | `info` |

## Shimmer variants

Each shimmer is `lighten(base, 0.2)` — a 20% blend toward white.
Applies to: `claudeShimmer`, `claudeBlueShimmer_FOR_SYSTEM_SPINNER`,
`permissionShimmer`, `promptBorderShimmer`, `inactiveShimmer`,
`warningShimmer`, `fastModeShimmer`, all seven `rainbow_*_shimmer`.

## Rainbow palette

Void's 7-color rainbow is derived from the opencode semantic palette so
ultrathink keyword highlighting reads coherently on every theme:

| Void slot | Derivation |
| --- | --- |
| `rainbow_red` | `error` |
| `rainbow_orange` | `mix(error, warning, 0.5)` |
| `rainbow_yellow` | `warning` |
| `rainbow_green` | `success` |
| `rainbow_blue` | `info` |
| `rainbow_indigo` | `mix(info, secondary, 0.5)` |
| `rainbow_violet` | `secondary` |

## Diff soft variants

| Void slot | Derivation |
| --- | --- |
| `diffAddedDimmed` | `mix(background, diffAddedBg, 0.5)` |
| `diffRemovedDimmed` | `mix(background, diffRemovedBg, 0.5)` |

## Fast mode

| Void slot | Derivation |
| --- | --- |
| `fastMode` | `mix(warning, error, 0.4)` (orange) |
| `fastModeShimmer` | `lighten(fastMode, 0.2)` |

## Dark vs light

Every opencode theme defines both `dark` and `light` variant values for
each slot. The registry loads both at startup; the loader's `mode` param
selects which variant to resolve. Void-cli only wires the `dark` variant
into `getTheme()` today (see `src/utils/theme.ts`) — a follow-up can surface
`light` via the `auto` setting or an explicit `-light` suffix.

## Default theme pick

`void-portal` is the default opencode theme shipped with void. It uses
Electric Cyan `#00E5FF` as primary (matching `LogoV2.tsx` / `Clawd.tsx`
`color="claude"` on the dark theme) and Void purple `#8B5CF6` as
secondary. The background is near-black `#050816` matching `clawd_background`.
