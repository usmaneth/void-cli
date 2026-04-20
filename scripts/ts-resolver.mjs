/**
 * Node.js ESM resolver hook that maps `.js` imports under the repo's `src/`
 * tree to their corresponding `.ts` files, allowing Node's native type-
 * stripping (`--experimental-strip-types`) to run tests directly against
 * TypeScript sources without a build step.
 *
 * Usage:
 *   node --experimental-strip-types \
 *        --import ./scripts/register-ts-resolver.mjs \
 *        test/some-test.mjs
 */

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC_ROOT = new URL('../src/', import.meta.url)

function rewriteToTs(specifierUrl) {
  // Only rewrite specifiers that end in `.js` and refer to a real .ts file.
  if (!specifierUrl.endsWith('.js')) return null
  const tsUrl = specifierUrl.slice(0, -3) + '.ts'
  try {
    const path = fileURLToPath(tsUrl)
    if (existsSync(path)) return tsUrl
  } catch {
    // Not a file URL we can introspect; skip.
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // Relative/absolute file specifiers: resolve them then rewrite if possible.
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    const parentURL = context.parentURL
    let resolvedUrl
    try {
      resolvedUrl = new URL(specifier, parentURL).href
    } catch {
      return nextResolve(specifier, context)
    }
    const rewritten = rewriteToTs(resolvedUrl)
    if (rewritten) {
      return nextResolve(rewritten, context)
    }
  }
  return nextResolve(specifier, context)
}
