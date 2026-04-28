/**
 * Map context-usage ratio (0..1) to a palette color. Three thresholds:
 *   < 0.4  → cyan   (fresh, void speaking voice)
 *   < 0.7  → amber  (caution / warning)
 *   ≥ 0.7  → red    (failure / approaching limit)
 *
 * The component layer adds the >0.9 flash-on-tick by inspecting the
 * ratio separately; this resolver just returns the steady-state color.
 */
import { getPalette } from '../../theme/index.js'

export function resolveContextBarColor(ratio: number): string {
  const p = getPalette()
  const r = Math.max(0, Math.min(1, ratio))
  if (r < 0.4) return p.role.voidProse
  if (r < 0.7) return p.state.warning
  return p.state.failure
}
