/**
 * Maps per-ring-frame ratio t ∈ [0, 1] to a hex color, three waypoints:
 *   t=0.0 → #ffffff (white)
 *   t=0.5 → #7dcfff (cyan)
 *   t=1.0 → #bb9af7 (violet)
 * After t > 0.85 the ring is fading: returns dim variant #3d4266.
 * After t > 0.95 returns null (consumer skips render entirely).
 *
 * t exactly == 1.0 is treated as the violet endpoint and skips the dim/null
 * branches — the upper boundary still renders before the ring extinguishes.
 */

const WHITE = { r: 0xff, g: 0xff, b: 0xff }
const CYAN = { r: 0x7d, g: 0xcf, b: 0xff }
const VIOLET = { r: 0xbb, g: 0x9a, b: 0xf7 }
const DIM = '#3d4266'

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function resolveRingColor(t: number): string | null {
  if (t === 1) return '#bb9af7'
  if (t > 0.95) return null
  if (t > 0.85) return DIM

  const clamped = Math.max(0, Math.min(1, t))
  if (clamped <= 0.5) {
    const local = clamped / 0.5
    return toHex(
      lerp(WHITE.r, CYAN.r, local),
      lerp(WHITE.g, CYAN.g, local),
      lerp(WHITE.b, CYAN.b, local),
    )
  }
  const local = (clamped - 0.5) / 0.5
  return toHex(
    lerp(CYAN.r, VIOLET.r, local),
    lerp(CYAN.g, VIOLET.g, local),
    lerp(CYAN.b, VIOLET.b, local),
  )
}
