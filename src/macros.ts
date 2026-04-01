// Runtime replacements for Bun compile-time MACRO constants
;(globalThis as any).MACRO = {
  VERSION: '0.1.0',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: 'https://github.com/usmaneth/void-cli',
  NATIVE_PACKAGE_URL: 'https://github.com/usmaneth/void-cli',
  ISSUES_EXPLAINER: 'report the issue at https://github.com/usmaneth/void-cli/issues',
  FEEDBACK_CHANNEL: 'https://github.com/usmaneth/void-cli/issues',
  VERSION_CHANGELOG: '{}',
}
