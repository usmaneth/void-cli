// Shim for bun:bundle feature flags — all features disabled in non-Bun builds
export function feature(_name: string): boolean {
  return false
}
