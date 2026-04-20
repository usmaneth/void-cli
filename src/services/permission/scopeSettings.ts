/**
 * Reads the user's bash scope allow/deny lists from settings.
 *
 * Settings schema (see `src/utils/settings/types.ts`):
 *   permissions.bash.allowScopes: BashScope[]   // auto-allow if ALL inferred scopes ∈ list
 *   permissions.bash.denyScopes:  BashScope[]   // auto-deny  if ANY inferred scope  ∈ list
 *
 * Feature flag: auto-ALLOW is gated behind env `VOID_SMART_PERMISSIONS=1` so the
 * initial rollout is opt-in. Auto-DENY is always honored (safer-by-default).
 */

import { getInitialSettings } from '../../utils/settings/settings.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { BashScope } from './scopes.js'
import { isBashScope } from './scopes.js'
import type { ScopePolicy } from './arity.js'

export function smartPermissionsEnabled(): boolean {
  return isEnvTruthy(process.env.VOID_SMART_PERMISSIONS)
}

/**
 * Read scope policy from merged settings. Filters out unknown scope strings
 * for forward-compatibility (new void versions may have added scopes).
 *
 * Returns an empty policy (no auto-allow, no auto-deny) if settings are
 * missing or unparseable.
 */
export function readScopePolicy(): ScopePolicy {
  try {
    const settings = getInitialSettings()
    const bash = (settings as { permissions?: { bash?: unknown } })?.permissions
      ?.bash
    if (!bash || typeof bash !== 'object') return {}
    const { allowScopes, denyScopes } = bash as {
      allowScopes?: unknown
      denyScopes?: unknown
    }
    return {
      allowScopes: coerceScopeList(allowScopes),
      denyScopes: coerceScopeList(denyScopes),
    }
  } catch {
    return {}
  }
}

function coerceScopeList(raw: unknown): BashScope[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: BashScope[] = []
  for (const item of raw) {
    if (typeof item === 'string' && isBashScope(item)) out.push(item)
  }
  return out.length > 0 ? out : undefined
}
