/**
 * Council Effect-TS layers — barrel.
 *
 * Example (production):
 *   import { CouncilLayer } from './layers/index.js'
 *   const rt = ManagedRuntime.make(CouncilLayer)
 *
 * Example (tests):
 *   const rt = ManagedRuntime.make(Layer.mergeAll(
 *     ConfigLayer.mockLayer(cfg),
 *     AuthLayer.mockLayer({ openrouter: 'k' }),
 *     ProviderLayer.mockLayer({ claude: { content: 'hi', tokens: { input: 1, output: 1 } } }),
 *     PermissionLayer.defaultLayer,
 *   ))
 */
import { Layer } from 'effect'
import * as ConfigLayer from './ConfigLayer.js'
import * as AuthLayer from './AuthLayer.js'
import * as ProviderLayer from './ProviderLayer.js'
import * as PermissionLayer from './PermissionLayer.js'
import * as ConsensusLayer from './ConsensusLayer.js'

export {
  ConfigLayer,
  AuthLayer,
  ProviderLayer,
  PermissionLayer,
  ConsensusLayer,
}
export { Config } from './ConfigLayer.js'
export { Auth } from './AuthLayer.js'
export { Provider } from './ProviderLayer.js'
export { Permission } from './PermissionLayer.js'
export { Consensus } from './ConsensusLayer.js'
export type {
  ProviderExecuteInput,
  ProviderExecuteOutput,
  AuthCredentials,
  PermissionDecision,
  PermissionRequest,
} from './types.js'

/**
 * Composed default runtime for production use.
 *
 * Provider depends on Auth, so Auth must be provided before Provider.
 */
export const CouncilLayer = Layer.mergeAll(
  ConfigLayer.defaultLayer,
  PermissionLayer.defaultLayer,
  ProviderLayer.defaultLayer,
  ConsensusLayer.defaultLayer,
).pipe(Layer.provide(AuthLayer.defaultLayer))
