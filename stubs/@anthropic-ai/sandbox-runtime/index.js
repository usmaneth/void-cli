/**
 * Stub for @anthropic-ai/sandbox-runtime — an internal Anthropic package
 * not available on npm. Provides no-op implementations so the CLI can
 * start without sandboxing support.
 */

export class SandboxManager {
  static isEnabled() { return false; }
  static isSupportedPlatform() { return false; }
  static getInstance() { return new SandboxManager(); }
  static checkDependencies() { return { satisfied: true, missing: [] }; }
  static wrapWithSandbox(cmd, args, opts) { return { cmd, args, opts }; }
  static async initialize(config, callback) { if (callback) await callback(); }
  static updateConfig() {}
  static reset() {}
  static getFsReadConfig() { return undefined; }
  static getFsWriteConfig() { return undefined; }
  isEnabled() { return false; }
  getConfig() { return {}; }
  getDependencyChecks() { return []; }
  getViolations() { return []; }
  clearViolations() {}
  setAskCallback() {}
  updateConfig() {}
  dispose() {}
}

export const SandboxRuntimeConfigSchema = {
  parse: (v) => v,
  safeParse: (v) => ({ success: true, data: v }),
};

export class SandboxViolationStore {
  getViolations() { return []; }
  clearViolations() {}
  addViolation() {}
}

export default { SandboxManager, SandboxRuntimeConfigSchema, SandboxViolationStore };
