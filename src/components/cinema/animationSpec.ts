/**
 * Animation specification + compression helper.
 * compress(spec, factor) scales totalFrames + every keyframe atFrame.
 * Used by Phase 2's compressed entry/exit (factor=0.18 → ~0.5s from 2.2-2.8s).
 */

export type Keyframe<S = unknown> = {
  atFrame: number
  state: S
}

export type AnimationSpec<S = unknown> = {
  totalFrames: number
  keyframes: readonly Keyframe<S>[]
}

export function compress<S>(spec: AnimationSpec<S>, factor: number): AnimationSpec<S> {
  return {
    totalFrames: Math.round(spec.totalFrames * factor),
    keyframes: spec.keyframes.map(kf => ({
      atFrame: Math.round(kf.atFrame * factor),
      state: kf.state,
    })),
  }
}
