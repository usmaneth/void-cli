// Void CLI — all experimental features enabled by default.
// In upstream Claude Code, these are gated behind Bun's build-time DCE
// (dead code elimination) and always return false in non-Bun builds.
// We override this to unlock every hidden/experimental feature.
//
// Individual features can be disabled by adding them to DISABLED_FEATURES.
// Set VOID_FEATURE_FLAGS=none to disable all, or VOID_FEATURE_FLAGS=FLAG1,FLAG2
// to enable only specific flags.

const DISABLED_FEATURES = new Set<string>([
  // Features that are known to cause issues or are Anthropic-internal only:
  'ANTI_DISTILLATION_CC',    // Anti-distillation — Anthropic internal
  'ALLOW_TEST_VERSIONS',     // Test version gating — internal
  'BREAK_CACHE_COMMAND',     // Internal cache busting
  'HARD_FAIL',               // Hard failure mode — dangerous
  'IS_LIBC_GLIBC',           // Build-time detection only
  'IS_LIBC_MUSL',            // Build-time detection only
  'OVERFLOW_TEST_TOOL',      // Test-only tool
  'SHOT_STATS',              // Internal telemetry
  'MEMORY_SHAPE_TELEMETRY',  // Internal telemetry
  'SLOW_OPERATION_LOGGING',  // Internal logging
  'PROMPT_CACHE_BREAK_DETECTION', // Internal diagnostics
])

export function feature(name: string): boolean {
  // Environment variable override
  const envFlags = process.env.VOID_FEATURE_FLAGS
  if (envFlags === 'none') return false
  if (envFlags) {
    const allowed = new Set(envFlags.split(',').map(s => s.trim()))
    return allowed.has(name)
  }

  // Default: enable everything except known-bad flags
  return !DISABLED_FEATURES.has(name)
}
