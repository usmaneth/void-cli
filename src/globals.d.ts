// Build-time constants that Bun injects via --define / bun:bundle macros
// In non-Bun builds these are provided as a global object
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string | undefined
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string | undefined
  ISSUES_EXPLAINER: string
  FEEDBACK_CHANNEL: string
  VERSION_CHANGELOG: string | undefined
}
