export { GutterRail, computeRailLine } from './GutterRail.js'
export type { GutterRailProps, RailLineInput, RailLineState } from './GutterRail.js'
export {
  HEARTBEAT_GLYPHS,
  FRAMING_GLYPHS,
  ROLE_COLORS,
  type HeartbeatEvent,
  type Role,
} from './glyphGrammar.js'
export {
  resolveEventGlyph,
  type GutterEvent,
  type RailTuple,
} from './eventStream.js'
export {
  resolveDensity,
  cycleDensity,
  type Density,
  type DensityOverride,
} from './densityResolver.js'
