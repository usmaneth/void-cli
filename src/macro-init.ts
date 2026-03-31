// Runtime shim for MACRO build-time constants
// In Bun builds these are injected at compile time via --define
// For Node/tsc builds we define them here as a global

const _MACRO = {
  VERSION: '0.1.0',
  BUILD_TIME: undefined as string | undefined,
  PACKAGE_URL: 'void-cli',
  NATIVE_PACKAGE_URL: undefined as string | undefined,
  ISSUES_EXPLAINER: 'open an issue on GitHub',
  FEEDBACK_CHANNEL: '#void-feedback',
  VERSION_CHANGELOG: undefined as string | undefined,
};

(globalThis as any).MACRO = _MACRO;
