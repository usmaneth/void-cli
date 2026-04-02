#!/usr/bin/env node
/**
 * Post-build script:
 * 1. Creates a symlink so that TypeScript path alias imports (`from 'src/...'`)
 *    resolve correctly at Node.js runtime.
 * 2. Copies plain .js files from src/ to dist/ that tsc skips (stub commands).
 * 3. Installs runtime stubs for internal Anthropic packages not on npm.
 */

import { existsSync, symlinkSync, unlinkSync, mkdirSync, readdirSync, copyFileSync, statSync, lstatSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

// --- 1. Create src -> dist symlink in node_modules ---
const link = join(root, 'node_modules', 'src');
mkdirSync(join(root, 'node_modules'), { recursive: true });

if (existsSync(link)) {
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink() || st.isFile()) {
      unlinkSync(link);
    }
  } catch { /* ignore */ }
}
if (!existsSync(link)) {
  symlinkSync(dist, link, 'dir');
  console.log('postbuild: linked node_modules/src -> dist/');
}

// --- 2. Copy non-TS assets from src/ to dist/ that tsc skips ---
// This includes plain .js stubs and .md files imported at runtime.
const COPY_EXTENSIONS = new Set(['.js', '.md']);
function copyAssets(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(fullPath);
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (COPY_EXTENSIONS.has(ext)) {
        const rel = relative(src, fullPath);
        const destPath = join(dist, rel);
        const destDir = dirname(destPath);
        if (!existsSync(destPath)) {
          mkdirSync(destDir, { recursive: true });
          copyFileSync(fullPath, destPath);
          console.log(`postbuild: copied ${rel}`);
        }
      }
    }
  }
}
if (existsSync(dist)) {
  copyAssets(src);
}

// --- 3. Install internal package stubs ---
const stubsDir = join(root, 'stubs');
if (existsSync(stubsDir)) {
  function installStubs(dir, relPath = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const rel = relPath ? join(relPath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        installStubs(fullPath, rel);
      } else {
        const dest = join(root, 'node_modules', rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(fullPath, dest);
      }
    }
  }
  installStubs(stubsDir);
  console.log('postbuild: installed internal package stubs');
}
