/**
 * 3-tier density classification + frame-keyed blur replacer.
 * 4 phases: 0..10 all-blurred, 11..18 medium-sharp, 19..24 light-sharp,
 * 25+ full resolution.
 */

export type Density = 'dense' | 'medium' | 'light'

const DENSE_CHARS = new Set(['█', '▓', '◆', '▲', '▼'])
const MEDIUM_CHARS = new Set(['│', '─', '┌', '┐', '└', '┘', 'V', 'O', 'I', 'D'])

export function classifyDensity(ch: string): Density {
  if (DENSE_CHARS.has(ch)) return 'dense'
  if (MEDIUM_CHARS.has(ch)) return 'medium'
  return 'light'
}

const BLUR_END_FRAME = 10
const MEDIUM_END_FRAME = 18
const DENSE_END_FRAME = 24

export function applyBlurPhase(ch: string, frame: number): string {
  const density = classifyDensity(ch)

  if (frame > DENSE_END_FRAME) return ch
  if (frame > MEDIUM_END_FRAME) return ch
  if (frame > BLUR_END_FRAME) {
    if (density === 'light') return ' '
    return ch
  }

  if (density === 'dense') return ch
  if (density === 'medium') return '·'
  return ' '
}
