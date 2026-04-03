// Content for the verify bundled skill.
// Load markdown from package files so both Bun and Node ESM can start the CLI.

import { loadBundledMarkdown } from './loadMarkdown.js'

const cliMd = loadBundledMarkdown('./verify/examples/cli.md')
const serverMd = loadBundledMarkdown('./verify/examples/server.md')
const skillMd = loadBundledMarkdown('./verify/SKILL.md')

export const SKILL_MD: string = skillMd

export const SKILL_FILES: Record<string, string> = {
  'examples/cli.md': cliMd,
  'examples/server.md': serverMd,
}
