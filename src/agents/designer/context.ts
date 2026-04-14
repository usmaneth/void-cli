/**
 * Design context assembly for the Gemini Designer Agent.
 *
 * Gathers design tokens, existing components, and detected tech stack
 * so the designer agent can match the project's visual language.
 */

import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'

export type DesignContext = {
  designTokens: string | null
  existingComponents: Array<{ path: string; preview: string }>
  projectStack: string[]
}

/**
 * Orchestrates design context discovery: tokens, components, and stack.
 */
export async function assembleDesignContext(
  cwd: string,
): Promise<DesignContext> {
  const [designTokens, existingComponents, projectStack] = await Promise.all([
    findDesignTokens(cwd),
    scanComponents(cwd),
    detectStack(cwd),
  ])
  return { designTokens, existingComponents, projectStack }
}

// --- Design tokens -----------------------------------------------------------

const TOKEN_CANDIDATES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'src/styles/globals.css',
  'app/globals.css',
  'styles/globals.css',
  'src/app/globals.css',
  'src/theme.ts',
  'src/theme.js',
  'theme.ts',
  'theme.js',
]

const MAX_TOKEN_LENGTH = 3000

/**
 * Look for design token / theme files and return the first found,
 * truncated to MAX_TOKEN_LENGTH characters.
 */
export async function findDesignTokens(cwd: string): Promise<string | null> {
  for (const candidate of TOKEN_CANDIDATES) {
    try {
      const content = await readFile(join(cwd, candidate), 'utf-8')
      const label = `// ${candidate}\n`
      const truncated =
        content.length > MAX_TOKEN_LENGTH
          ? content.slice(0, MAX_TOKEN_LENGTH) + '\n// ... (truncated)'
          : content
      return label + truncated
    } catch {
      // file not found — try next
    }
  }
  return null
}

// --- Component scanning ------------------------------------------------------

const COMPONENT_GLOBS = [
  'src/components',
  'components',
  'app',
  'src/app',
  'src/ui',
  'ui',
]

const MAX_COMPONENTS = 20
const PREVIEW_LINES = 10

/**
 * Scan common component directories for .tsx files and return up to
 * MAX_COMPONENTS entries with a short preview (first PREVIEW_LINES lines).
 */
export async function scanComponents(
  cwd: string,
): Promise<Array<{ path: string; preview: string }>> {
  const results: Array<{ path: string; preview: string }> = []

  for (const dir of COMPONENT_GLOBS) {
    if (results.length >= MAX_COMPONENTS) break
    const absDir = join(cwd, dir)
    try {
      const entries = await readdir(absDir, { recursive: true })
      for (const entry of entries) {
        if (results.length >= MAX_COMPONENTS) break
        const name = typeof entry === 'string' ? entry : String(entry)
        if (!name.endsWith('.tsx')) continue
        // Skip test/story files
        if (/\.(test|spec|stories|story)\./i.test(name)) continue
        const fullPath = join(absDir, name)
        try {
          const content = await readFile(fullPath, 'utf-8')
          const preview = content.split('\n').slice(0, PREVIEW_LINES).join('\n')
          results.push({
            path: relative(cwd, fullPath),
            preview,
          })
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // directory doesn't exist — try next
    }
  }

  return results
}

// --- Stack detection ---------------------------------------------------------

const STACK_INDICATORS: Record<string, string> = {
  tailwindcss: 'tailwindcss',
  'framer-motion': 'framer-motion',
  next: 'nextjs',
  react: 'react',
  '@radix-ui/react-icons': 'radix-ui',
  '@radix-ui/react-slot': 'radix-ui',
  '@radix-ui/react-dialog': 'radix-ui',
  '@shadcn/ui': 'shadcn-ui',
  'class-variance-authority': 'cva',
  clsx: 'clsx',
  'lucide-react': 'lucide-react',
  '@emotion/react': 'emotion',
  '@emotion/styled': 'emotion',
  'styled-components': 'styled-components',
  '@chakra-ui/react': 'chakra-ui',
  '@mui/material': 'material-ui',
  vue: 'vue',
  svelte: 'svelte',
  angular: 'angular',
}

/**
 * Read package.json and detect the project's frontend tech stack.
 */
export async function detectStack(cwd: string): Promise<string[]> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }

    const detected = new Set<string>()
    for (const [dep, label] of Object.entries(STACK_INDICATORS)) {
      if (dep in allDeps) {
        detected.add(label)
      }
    }
    return Array.from(detected)
  } catch {
    return []
  }
}
