import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

export function loadBundledMarkdown(relativePath: string): string {
  const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url))

  try {
    return readFileSync(absolutePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return `Bundled markdown asset not found: ${relativePath}\n`
    }

    throw error
  }
}
