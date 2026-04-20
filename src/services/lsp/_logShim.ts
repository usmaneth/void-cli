/**
 * Tiny logging shim for the LSP aggregator subsystem.
 *
 * The project's `utils/debug.ts` and `utils/log.ts` have heavy transitive
 * imports (bootstrap state, config, memdir, …) that make the aggregator
 * untestable in isolation. This shim:
 *
 *   - forwards to the real logForDebugging / logError / toError when they
 *     are loadable (production runtime)
 *   - falls back to console.error / identity helpers when they are not
 *     (vitest in a stripped/stub codebase)
 *
 * Resolution happens exactly once at module import — no per-call overhead.
 */

type MaybeFn = ((..._a: unknown[]) => unknown) | undefined

// Use bare string path for the "real" module; TS path alias `src/` handles it
// in production. The try/catch covers the test environment.
let debugFn: MaybeFn
let errorFn: MaybeFn
let toErrorFn: ((e: unknown) => Error) | undefined

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const dbg = require('../../utils/debug.js') as {
    logForDebugging: MaybeFn
  }
  debugFn = dbg.logForDebugging
} catch {
  debugFn = undefined
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const log = require('../../utils/log.js') as { logError: MaybeFn }
  errorFn = log.logError
} catch {
  errorFn = undefined
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const errs = require('../../utils/errors.js') as {
    toError: (e: unknown) => Error
  }
  toErrorFn = errs.toError
} catch {
  toErrorFn = undefined
}

export function logForDebugging(msg: string): void {
  if (debugFn) {
    try {
      debugFn(msg)
      return
    } catch {
      // fall through
    }
  }
  // Silence during tests by default; set VOID_LSP_LOG_DEBUG=1 to see output.
  if (process.env.VOID_LSP_LOG_DEBUG) {
    // eslint-disable-next-line no-console
    console.error(`[LSP DEBUG] ${msg}`)
  }
}

export function logError(err: unknown): void {
  if (errorFn) {
    try {
      errorFn(err)
      return
    } catch {
      // fall through
    }
  }
  // eslint-disable-next-line no-console
  console.error('[LSP ERROR]', err)
}

export function toError(err: unknown): Error {
  if (toErrorFn) {
    try {
      return toErrorFn(err)
    } catch {
      // fall through
    }
  }
  if (err instanceof Error) return err
  return new Error(typeof err === 'string' ? err : JSON.stringify(err))
}
