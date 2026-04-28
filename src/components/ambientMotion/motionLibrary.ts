/**
 * Per-category spinner motion vocabulary. Each motion has its own
 * visual signature so the user can read what's happening from
 * peripheral vision alone — no need to read the label.
 *
 * The shape: 8 categories, each with a frames array (cycle), period in
 * ms (full cycle duration), and a color role keyword the renderer maps
 * to palette tokens.
 */

export type MotionCategory =
  | 'bash' | 'web' | 'fileEdit' | 'modelThinking'
  | 'subagent' | 'compaction' | 'mcp' | 'remote'

export type ColorRole =
  | 'voidProse' | 'voidWrite' | 'accent'
  | 'success' | 'warning' | 'failure'

export interface Motion {
  frames: readonly string[]
  periodMs: number
  colorRole: ColorRole
}

export const MOTIONS: Record<MotionCategory, Motion> = {
  bash: {
    frames: ['▰▱▱▱▱▱', '▰▰▱▱▱▱', '▰▰▰▱▱▱', '▰▰▰▰▱▱', '▰▰▰▰▰▱', '▰▰▰▰▰▰'],
    periodMs: 1200,
    colorRole: 'voidProse',
  },
  web: {
    frames: ['◐', '◓', '◑', '◒'],
    periodMs: 1600,
    colorRole: 'voidProse',
  },
  fileEdit: {
    frames: ['▌', '▎', '▍'],
    periodMs: 800,
    colorRole: 'voidWrite',
  },
  modelThinking: {
    frames: ['░', '▒', '▓', '█'],
    periodMs: 1400,
    colorRole: 'accent',
  },
  subagent: {
    frames: ['◆', '◇', '◆', '◇'],
    periodMs: 2000,
    colorRole: 'accent',
  },
  compaction: {
    frames: ['▶◀', '▷◁'],
    periodMs: 1000,
    colorRole: 'voidWrite',
  },
  mcp: {
    frames: ['◯', '◔', '◑', '◕', '●'],
    periodMs: 1500,
    colorRole: 'voidProse',
  },
  remote: {
    frames: ['▷', '▶', '⏵', '⏵⏵'],
    periodMs: 1000,
    colorRole: 'voidProse',
  },
}
