/**
 * Per-category spinner. Picks the motion vocabulary from MOTIONS based on
 * the operation category, advances frames via Phase 0's useFrame, and
 * colors via the role-to-palette mapping.
 */
import * as React from 'react'
import { Text } from '../../ink.js'
import { useFrame } from '../cinema/frames.js'
import { getPalette } from '../../theme/index.js'
import { MOTIONS, type MotionCategory, type ColorRole } from './motionLibrary.js'

export type CategorySpinnerProps = {
  category: MotionCategory
}

export function resolveSpinnerColor(role: ColorRole): string {
  const p = getPalette()
  switch (role) {
    case 'voidProse':
      return p.role.voidProse
    case 'voidWrite':
      return p.role.voidWrite
    case 'accent':
      return p.brand.accent
    case 'success':
      return p.state.success
    case 'warning':
      return p.state.warning
    case 'failure':
      return p.state.failure
  }
}

export function CategorySpinner({ category }: CategorySpinnerProps): React.ReactNode {
  const motion = MOTIONS[category]
  const frame = useFrame(motion.frames.length, motion.periodMs)
  const color = resolveSpinnerColor(motion.colorRole)
  return <Text color={color}>{motion.frames[frame]}</Text>
}
