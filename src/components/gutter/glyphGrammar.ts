/**
 * Visual grammar of the living gutter.
 * 6 heartbeat glyphs (rail event glyphs), 3 framing glyphs
 * (level-1 frames around message turns), and a role → palette-color map.
 */
import { getPalette } from '../../theme/index.js'

export type HeartbeatEvent =
  | 'steady'
  | 'eventStart'
  | 'eventEnd'
  | 'branch'
  | 'success'
  | 'failure'

export const HEARTBEAT_GLYPHS: Record<HeartbeatEvent, string> = {
  steady: '┃',
  eventStart: '╽',
  eventEnd: '╿',
  branch: '┣',
  success: '╋',
  failure: '╳',
}

export const FRAMING_GLYPHS = {
  top: '╭─',
  body: '│',
  bottom: '╰─',
} as const

export type Role =
  | 'you'
  | 'voidProse'
  | 'voidWrite'
  | 'success'
  | 'failure'

/**
 * Lazy role → palette-color lookup. Must be called at render time, not
 * at module load — getPalette reads config which is gated on app boot.
 */
export function getRoleColor(role: Role): string {
  const p = getPalette()
  switch (role) {
    case 'you':
      return p.role.you
    case 'voidProse':
      return p.role.voidProse
    case 'voidWrite':
      return p.role.voidWrite
    case 'success':
      return p.state.success
    case 'failure':
      return p.state.failure
  }
}
