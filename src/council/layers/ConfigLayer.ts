/**
 * ConfigLayer — resolves CouncilConfig (presets + member list + consensus method).
 *
 * Mirrors `~/void-cli/src/council/config.ts` but exposes it as an Effect Context
 * so tests / alternate runtimes can inject arbitrary configs without poking at
 * module-level singletons.
 */
import { Context, Effect, Layer } from 'effect'
import type { CouncilConfig, CouncilPreset } from '../types.js'
import {
  COUNCIL_PRESETS,
  getCouncilConfig as getGlobalCouncilConfig,
} from '../config.js'

export interface ConfigService {
  readonly get: () => Effect.Effect<CouncilConfig>
  readonly preset: (
    name: string,
  ) => Effect.Effect<CouncilPreset, Error>
  readonly presets: () => Effect.Effect<Record<string, CouncilPreset>>
}

export class Config extends Context.Tag('council/Config')<
  Config,
  ConfigService
>() {}

/**
 * Default layer — delegates to the existing module singleton so real callers
 * keep getting the same config they've always had.
 */
export const defaultLayer = Layer.succeed(
  Config,
  Config.of({
    get: () => Effect.sync(() => getGlobalCouncilConfig()),
    preset: (name) =>
      Effect.sync(() => {
        const preset = COUNCIL_PRESETS[name]
        if (!preset) {
          throw new Error(
            `Unknown council preset: ${name}. Available: ${Object.keys(
              COUNCIL_PRESETS,
            ).join(', ')}`,
          )
        }
        return preset
      }),
    presets: () => Effect.sync(() => COUNCIL_PRESETS),
  }),
)

/**
 * Mock layer — pin an explicit CouncilConfig in tests.
 */
export const mockLayer = (
  config: CouncilConfig,
  presets: Record<string, CouncilPreset> = {},
) =>
  Layer.succeed(
    Config,
    Config.of({
      get: () => Effect.succeed(config),
      preset: (name) =>
        name in presets
          ? Effect.succeed(presets[name]!)
          : Effect.fail(new Error(`Unknown preset: ${name}`)),
      presets: () => Effect.succeed(presets),
    }),
  )
