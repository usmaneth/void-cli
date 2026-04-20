/**
 * Smart bash permission scope inference (tree-sitter-bash driven).
 *
 *   classifyArity(cmd)         → {scopes, mutatesFs, hasNetwork, hasExec, targetPaths, parseFailed}
 *   evaluateScopePolicy(a, p)  → 'allow' | 'deny' | 'prompt'
 *   shouldAutoAllowByScope()   → convenience combo
 *   readScopePolicy()          → reads user's permissions.bash.{allow,deny}Scopes
 *   smartPermissionsEnabled()  → VOID_SMART_PERMISSIONS=1 feature flag check
 *
 * Session-level scope acceptance (allow the inferred scope set for the rest
 * of this session without a settings-file write) is tracked via
 * {@link acceptScopesForSession} / {@link sessionAllowsScopes}.
 */

export {
  classifyArity,
  clearArityCache,
  evaluateScopePolicy,
  shouldAutoAllowByScope,
  type ArityResult,
  type ScopePolicy,
} from './arity.js'

export {
  BASH_SCOPES,
  isBashScope,
  scopeLabel,
  sortScopesForDisplay,
  type BashScope,
} from './scopes.js'

export { readScopePolicy, smartPermissionsEnabled } from './scopeSettings.js'

import type { BashScope } from './scopes.js'

/**
 * Session-scoped set of scope *sets* the user has accepted. Keyed by a
 * canonical string form of the sorted scope set so `{write-file, network}`
 * collides with itself but not with `{write-file}` alone.
 *
 * This is ephemeral — cleared on process exit. Written to by the permission
 * prompt UI when the user chooses "Accept for session".
 */
const SESSION_ACCEPTED_SCOPE_SETS = new Set<string>()

function canonicalizeScopes(scopes: Iterable<BashScope>): string {
  return [...new Set(scopes)].sort().join(',')
}

export function acceptScopesForSession(scopes: Iterable<BashScope>): void {
  SESSION_ACCEPTED_SCOPE_SETS.add(canonicalizeScopes(scopes))
}

export function sessionAllowsScopes(scopes: Iterable<BashScope>): boolean {
  return SESSION_ACCEPTED_SCOPE_SETS.has(canonicalizeScopes(scopes))
}

export function clearSessionScopeAcceptance(): void {
  SESSION_ACCEPTED_SCOPE_SETS.clear()
}
