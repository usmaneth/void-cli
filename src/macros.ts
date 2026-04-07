// Runtime replacements for Bun compile-time MACRO constants
// Set USER_TYPE for non-Bun runtime (Bun injects at build time)
if (!process.env.USER_TYPE) {
  process.env.USER_TYPE = 'external'
}
// Non-streaming fallback re-enabled now that experimental betas are stripped
// Re-enable thinking now that experimental betas are stripped
// Strip experimental beta fields from tool schemas (defer_loading, eager_input_streaming)
if (!process.env.VOID_DISABLE_EXPERIMENTAL_BETAS) {
  process.env.VOID_DISABLE_EXPERIMENTAL_BETAS = '1'
}

;(globalThis as any).MACRO = {
  VERSION: '2.1.94',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: 'https://github.com/usmaneth/void-cli',
  NATIVE_PACKAGE_URL: 'https://github.com/usmaneth/void-cli',
  ISSUES_EXPLAINER: 'report the issue at https://github.com/usmaneth/void-cli/issues',
  FEEDBACK_CHANNEL: 'https://github.com/usmaneth/void-cli/issues',
  VERSION_CHANGELOG: '{}',
}
