/**
 * Shared helper to resolve the current session ID from the command
 * context. The void-cli app state shape varies (stubbed in this
 * worktree, richer in prod), so we probe several common locations
 * and fall back to environment variables a parent process may have
 * set when it spawned the CLI.
 */
export function getCurrentSessionId(context: any): string | null {
  try {
    const st = context?.getAppState?.()
    const fromState =
      st?.sessionId ??
      st?.session?.id ??
      st?.activeSession?.id ??
      null
    if (typeof fromState === 'string' && fromState.length > 0) return fromState
  } catch {
    // getAppState may throw on partially-initialized contexts
  }
  const fromCtx =
    context?.sessionId ??
    context?.options?.sessionId ??
    context?.session?.id ??
    null
  if (typeof fromCtx === 'string' && fromCtx.length > 0) return fromCtx

  const fromEnv =
    process.env.VOID_ACTIVE_SESSION_ID ??
    process.env.VOID_SESSION_ID ??
    null
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv

  return null
}
