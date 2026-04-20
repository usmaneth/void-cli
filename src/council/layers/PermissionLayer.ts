/**
 * PermissionLayer — shim for permission checks before dispatching a council
 * query to a provider.
 *
 * The real void-cli permission system lives in src/permissions/; for the
 * council pilot we only need a hook that the orchestrator awaits before
 * calling a member. Today this is a no-op `allow` default; tests can inject a
 * denying layer to verify the orchestrator respects the decision.
 */
import { Context, Effect, Layer } from 'effect'
import type { PermissionDecision, PermissionRequest } from './types.js'

export interface PermissionService {
  readonly check: (
    req: PermissionRequest,
  ) => Effect.Effect<PermissionDecision>
}

export class Permission extends Context.Tag('council/Permission')<
  Permission,
  PermissionService
>() {}

/**
 * Default layer — always allow. Council queries don't currently gate on
 * permissions; when the broader permission system lands, this is the swap
 * point.
 */
export const defaultLayer = Layer.succeed(
  Permission,
  Permission.of({
    check: () => Effect.succeed({ kind: 'allow' } as PermissionDecision),
  }),
)

/**
 * Mock layer — plug in arbitrary decision logic for tests.
 */
export const mockLayer = (
  decide: (req: PermissionRequest) => PermissionDecision,
) =>
  Layer.succeed(
    Permission,
    Permission.of({
      check: (req) => Effect.sync(() => decide(req)),
    }),
  )
