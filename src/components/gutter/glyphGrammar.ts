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

const palette = getPalette()

export const ROLE_COLORS: Record<Role, string> = {
  you: palette.role.you,
  voidProse: palette.role.voidProse,
  voidWrite: palette.role.voidWrite,
  success: palette.state.success,
  failure: palette.state.failure,
}
