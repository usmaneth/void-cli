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
  'TRANSCRIPT_CLASSIFIER',  // Requires proprietary prompt files not in repo
  'PROACTIVE',              // SleepTool deprecated — replaced by ScheduleWakeupTool (KAIROS_LOOP_DYNAMIC)
  'KAIROS',                 // Umbrella flag; SendUserFile not in repo
  'KAIROS_PUSH_NOTIFICATION', // PushNotificationTool in repo but pending Remote Control daemon bridge for mobile delivery
  // KAIROS_LOOP_DYNAMIC: ENABLED — ScheduleWakeupTool + /loop dynamic mode
  // wired via src/utils/loopWakeup.ts (setTimeout → enqueuePendingNotification).
  'KAIROS_GITHUB_WEBHOOKS', // SubscribePRTool not in repo
  'CONTEXT_COLLAPSE',       // CtxInspectTool not in repo
  'TERMINAL_PANEL',         // TerminalCaptureTool not in repo
  'WEB_BROWSER_TOOL',       // WebBrowserTool not in repo
  'HISTORY_SNIP',           // SnipTool not in repo
  'UDS_INBOX',              // ListPeersTool not in repo
  'WORKFLOW_SCRIPTS',       // WorkflowTool bundled files not in repo
  'DAEMON',                 // remoteControlServer not in repo
  'TORCH',                  // torch command not in repo
  'ULTRAPLAN',              // ultraplan prompt.txt not in repo
  'NATIVE_CLIENT_ATTESTATION', // Requires Bun native HTTP stack to rewrite cch= placeholder
  'KAIROS_BRIEF',           // BriefTool not in repo — require() crashes Node ESM builds
  'KAIROS_DREAM',           // dream skill not in repo
  'REVIEW_ARTIFACT',        // hunter skill not in repo
  'RUN_SKILL_GENERATOR',    // runSkillGenerator not in repo
  // Note: CHATGPT_SUBSCRIPTION_AUTH is ON by default. The feature reuses
  // Codex's registered OAuth client_id to reach chatgpt.com/backend-api for
  // subscription-billed inference (gpt-5.5 etc). OpenAI may rotate the
  // client_id or tighten client verification; users who want to disable
  // the option entirely can run with VOID_FEATURE_FLAGS=none or an explicit
  // allowlist that omits CHATGPT_SUBSCRIPTION_AUTH.
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
