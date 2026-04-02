/**
 * Node.js ESM loader hook for importing .md files as text strings.
 * Bun handles this natively; this loader provides the same behavior for Node.js.
 *
 * Usage: node --import ./scripts/register-loader.js dist/entrypoints/cli.js
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

export async function resolve(specifier, context, nextResolve) {
  // Handle .md imports — resolve them even though Node doesn't know about .md
  if (specifier.endsWith('.md')) {
    return nextResolve(specifier, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.md')) {
    const filePath = fileURLToPath(url);
    try {
      const source = await readFile(filePath, 'utf-8');
      return {
        format: 'module',
        source: `export default ${JSON.stringify(source)};`,
        shortCircuit: true,
      };
    } catch {
      // File doesn't exist — return empty string (graceful degradation for
      // removed content like the claude-api skill docs)
      return {
        format: 'module',
        source: `export default '';`,
        shortCircuit: true,
      };
    }
  }
  return nextLoad(url, context);
}
