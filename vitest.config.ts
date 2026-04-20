import * as path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vitest configuration for void-cli tests.
 *
 * The repo's main build uses tsc directly (no bundler). Tests run in native
 * Node via vitest's `esbuild` transform. Two noteworthy bits:
 *
 *   - tsconfig.json maps `src/*` → `./*` with baseUrl=./src, which tsc
 *     understands but vite does not. We mirror that here as an alias so test
 *     imports resolve the same way they do at typecheck time.
 *
 *   - Tests are colocated under __tests__ directories. Only LSP tests are
 *     collected today (feature-branch scope); widen the include glob when
 *     more subsystems adopt vitest.
 */
export default defineConfig({
  resolve: {
    alias: {
      'src/': path.resolve(here, 'src') + '/',
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    typecheck: { enabled: false },
    reporters: ['default'],
    testTimeout: 10_000,
  },
})
