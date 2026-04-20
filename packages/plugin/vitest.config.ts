import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Resolve `@void-cli/plugin` to the local src during tests — the example
// plugin under examples/hello-void/ imports from the package name, and the
// dist build isn't produced in CI.
const pluginSrc = fileURLToPath(new URL('./src/index.ts', import.meta.url))

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@void-cli/plugin': pluginSrc,
    },
  },
})
