/**
 * Bresenham circle algorithm — produces (x, y, char) tuples on a circle
 * of radius r centered at (0, 0). Each cell gets a glyph by angle:
 *   - cardinal points (N/E/S/W within ~6° of axis) → ◆
 *   - NE quadrant (15°–75°) and SE quadrant (-15°– -75°) → ▲
 *   - NW quadrant (105°–165°) and SW quadrant (-105°– -165°) → ▼
 *   - everything else (narrow gaps near the cardinal lines) → ·
 * Result is cached by radius — identical inputs return the same array
 * reference. Returned arrays are frozen to prevent accidental mutation.
 */

export type RingCell = {
  x: number
  y: number
  char: '◆' | '▲' | '▼' | '·'
}

const cache = new Map<number, readonly RingCell[]>()

function classifyChar(x: number, y: number): RingCell['char'] {
  const angle = Math.atan2(y, x)
  const deg = (angle * 180) / Math.PI

  // Cardinal points: within ~6° of N (90°), E (0°), S (-90°), W (180°/-180°).
  // 6° is just wide enough to catch the bresenham-adjacent cells at r=10
  // (e.g. (10, 1) at 5.71°), while leaving room for the dot gaps further out.
  const cardinalSlack = 6
  const isCardinal =
    Math.abs(deg) < cardinalSlack ||
    Math.abs(deg - 90) < cardinalSlack ||
    Math.abs(deg + 90) < cardinalSlack ||
    Math.abs(deg - 180) < cardinalSlack ||
    Math.abs(deg + 180) < cardinalSlack
  if (isCardinal) return '◆'

  // NE quadrant body: 15°–75°. SE quadrant body: -75°– -15°.
  if (deg >= 15 && deg <= 75) return '▲'
  if (deg <= -15 && deg >= -75) return '▲'

  // NW quadrant body: 105°–165°. SW quadrant body: -165°– -105°.
  if (deg >= 105 && deg <= 165) return '▼'
  if (deg <= -105 && deg >= -165) return '▼'

  // Narrow gaps near the cardinal lines (5°–15° and 75°–90° etc.) → dots.
  return '·'
}

export function computeRing(radius: number): readonly RingCell[] {
  if (radius <= 0) return []
  const cached = cache.get(radius)
  if (cached) return cached

  const cells: RingCell[] = []
  const seen = new Set<string>()

  // Bresenham's circle: walk one octant, mirror to the other seven.
  let x = radius
  let y = 0
  let err = 0

  while (x >= y) {
    const points: Array<[number, number]> = [
      [x, y], [y, x], [-y, x], [-x, y],
      [-x, -y], [-y, -x], [y, -x], [x, -y],
    ]
    for (const [px, py] of points) {
      const key = `${px},${py}`
      if (seen.has(key)) continue
      seen.add(key)
      cells.push({ x: px, y: py, char: classifyChar(px, py) })
    }

    y += 1
    err += 1 + 2 * y
    if (2 * (err - x) + 1 > 0) {
      x -= 1
      err += 1 - 2 * x
    }
  }

  const frozen = Object.freeze(cells)
  cache.set(radius, frozen)
  return frozen
}
