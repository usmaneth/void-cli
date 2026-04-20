import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for void-cli.
 *
 * Void is a Bun-first project; these tests run under vitest for compatibility
 * with standard CI tooling and to avoid regressions on Node.js as well.
 *
 * Test glob covers colocated `*.test.ts` and any `__tests__` directories.
 *
 * VOID_FEATURE_FLAGS=none is set globally for tests: several modules use
 * top-level `require()` that would blow up under Node because it tries to
 * resolve `.js` paths that only exist as `.ts` sources. Disabling feature
 * flags skips those branches — individual tests can opt back in if needed.
 */
process.env.VOID_FEATURE_FLAGS ??= 'none'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    testTimeout: 15_000,
    // Isolation matters here: several tests mutate `process.env` and
    // the module-level `currentConfig` in src/council/config.ts.
    isolate: true,
    pool: 'forks',
    reporters: ['default'],
    env: {
      VOID_FEATURE_FLAGS: 'none',
    },
  },
  resolve: {
    alias: {
      // Mirror the tsconfig `baseUrl: ./src` + `paths: { "src/*": "./*" }` pair.
      src: new URL('./src', import.meta.url).pathname,
    },
  },
})
