import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, join, relative, resolve } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandTemplate {
  /** Derived from filename; subdirs produce category prefix (e.g. "git:commit") */
  name: string
  /** Full absolute path to the .md file */
  path: string
  /** Where the command was loaded from */
  scope: 'user' | 'project'
  /** Category from subdirectory (e.g. "git"), empty string for root-level */
  category: string
  /** Raw markdown content */
  content: string
  /** Extracted $PLACEHOLDER names (unique, uppercase) */
  placeholders: string[]
  /** First line of .md if it starts with # (stripped of the leading #) */
  description?: string
}

// ---------------------------------------------------------------------------
// Placeholder parsing
// ---------------------------------------------------------------------------

/**
 * Extract all `$WORD` patterns from content.
 * Matches $ followed by one or more uppercase letters/digits/underscores.
 * Ignores common shell variables like $HOME, $PATH, $USER, $PWD, $SHELL.
 */
const SHELL_VARS = new Set([
  'HOME', 'PATH', 'USER', 'PWD', 'SHELL', 'TERM', 'EDITOR',
  'LANG', 'LC_ALL', 'DISPLAY', 'HOSTNAME', 'LOGNAME', 'OLDPWD',
  'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
])

export function parsePlaceholders(content: string): string[] {
  const pattern = /\$([A-Z][A-Z0-9_]*)\b/g
  const found = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1]!
    if (!SHELL_VARS.has(name)) {
      found.add(name)
    }
  }
  return Array.from(found)
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function getUserCommandsDir(): string {
  const configDir = process.env.VOID_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.void')
  return join(configDir, 'commands')
}

function getProjectCommandsDir(): string {
  return resolve(process.cwd(), '.void', 'commands')
}

/**
 * Recursively collect all .md files under a directory.
 * Returns paths relative to the base directory.
 */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) {
    return results
  }

  function walk(current: string): void {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(current, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (stat.isFile() && extname(entry).toLowerCase() === '.md') {
        results.push(fullPath)
      }
    }
  }

  walk(dir)
  return results
}

/**
 * Derive the command name from a file path relative to a commands base dir.
 * Subdirectories become category prefixes separated by `:`.
 *
 * Examples:
 *   review.md        → "review"
 *   git/commit.md    → "git:commit"
 *   test/unit/run.md → "test:unit:run"
 */
function deriveNameAndCategory(relPath: string): { name: string; category: string } {
  // Normalize separators and strip .md
  const normalized = relPath.replace(/\\/g, '/')
  const withoutExt = normalized.replace(/\.md$/i, '')
  const segments = withoutExt.split('/')

  const fileBase = segments.pop()!
  const category = segments.join(':')
  const name = category ? `${category}:${fileBase}` : fileBase

  return { name, category }
}

/**
 * Parse the first line for a description (if it starts with #).
 */
function extractDescription(content: string): string | undefined {
  const firstLine = content.split('\n')[0]?.trim()
  if (firstLine && firstLine.startsWith('#')) {
    return firstLine.replace(/^#+\s*/, '').trim() || undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// CommandRegistry
// ---------------------------------------------------------------------------

export class CommandRegistry {
  private commands = new Map<string, CommandTemplate>()

  /**
   * Scan user and project command directories, parse all .md files into
   * CommandTemplate objects. Project-scoped commands override user-scoped
   * commands with the same name.
   */
  async scan(): Promise<void> {
    this.commands.clear()

    // Load user commands first
    const userDir = getUserCommandsDir()
    const userFiles = collectMarkdownFiles(userDir)
    for (const filePath of userFiles) {
      const relPath = relative(userDir, filePath)
      const template = this.parseFile(filePath, relPath, 'user')
      if (template) {
        this.commands.set(template.name, template)
      }
    }

    // Load project commands (overrides user commands with same name)
    const projectDir = getProjectCommandsDir()
    const projectFiles = collectMarkdownFiles(projectDir)
    for (const filePath of projectFiles) {
      const relPath = relative(projectDir, filePath)
      const template = this.parseFile(filePath, relPath, 'project')
      if (template) {
        this.commands.set(template.name, template)
      }
    }
  }

  /**
   * Get a command by name. Project scope overrides user scope (handled by
   * scan order — project commands are loaded second and overwrite).
   */
  get(name: string): CommandTemplate | undefined {
    return this.commands.get(name)
  }

  /**
   * Return all commands grouped by category.
   * Empty-string key holds uncategorized commands.
   */
  list(): Record<string, CommandTemplate[]> {
    const grouped: Record<string, CommandTemplate[]> = {}
    for (const template of this.commands.values()) {
      const key = template.category
      if (!grouped[key]) {
        grouped[key] = []
      }
      grouped[key].push(template)
    }

    // Sort commands within each category
    for (const key of Object.keys(grouped)) {
      grouped[key]!.sort((a, b) => a.name.localeCompare(b.name))
    }

    return grouped
  }

  /**
   * Replace $PLACEHOLDER tokens with provided argument values.
   * Returns the resolved content, or null if the command is not found.
   */
  resolve(name: string, args: Record<string, string>): string | null {
    const template = this.commands.get(name)
    if (!template) {
      return null
    }

    let content = template.content
    for (const [key, value] of Object.entries(args)) {
      const pattern = new RegExp(`\\$${key}\\b`, 'g')
      content = content.replace(pattern, value)
    }

    return content
  }

  /**
   * Get the file path where a new command would be created.
   */
  getNewCommandPath(name: string, scope: 'user' | 'project'): string {
    const baseDir = scope === 'user' ? getUserCommandsDir() : getProjectCommandsDir()
    // Convert colon-separated name to directory structure
    const segments = name.split(':')
    const fileName = segments.pop()! + '.md'
    return join(baseDir, ...segments, fileName)
  }

  private parseFile(
    filePath: string,
    relPath: string,
    scope: 'user' | 'project',
  ): CommandTemplate | null {
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }

    const { name, category } = deriveNameAndCategory(relPath)
    const description = extractDescription(content)
    const placeholders = parsePlaceholders(content)

    return {
      name,
      path: filePath,
      scope,
      category,
      content,
      placeholders,
      description,
    }
  }
}

// ---------------------------------------------------------------------------
// Default command templates
// ---------------------------------------------------------------------------

const DEFAULT_COMMANDS: Record<string, string> = {
  'review.md': `# Code Review

Review the provided code for quality, correctness, and best practices.

## Instructions

Perform a thorough code review of the changes in $FILE. Focus on:

1. **Correctness**: Logic errors, edge cases, off-by-one errors
2. **Code Quality**: Readability, naming, structure, DRY principles
3. **Performance**: Unnecessary allocations, N+1 patterns, blocking calls
4. **Security**: Input validation, injection risks, auth checks
5. **Testing**: Missing test cases, edge case coverage

Provide specific, actionable feedback with code suggestions where appropriate.
Keep the review constructive and focused on the most important issues.
`,

  'explain.md': `# Explain Code

Explain how a piece of code works in detail.

## Instructions

Read and explain $FILE in detail. Cover:

1. **Purpose**: What does this code do at a high level?
2. **Structure**: How is it organized? Key classes, functions, modules.
3. **Flow**: Walk through the main execution paths step by step.
4. **Key Decisions**: Why was it written this way? What trade-offs were made?
5. **Dependencies**: What does it rely on? External APIs, libraries, other modules.

Adjust the explanation depth for a $AUDIENCE audience.
Use clear language and concrete examples from the code.
`,

  'git/commit.md': `# Generate Commit Message

Generate a well-crafted git commit message based on staged changes.

## Instructions

Analyze the current staged changes using \`git diff --cached\` and generate a commit message.

Follow these conventions:
- Use conventional commit format: $FORMAT
- First line: type(scope): concise summary under 72 chars
- Blank line after summary
- Body: explain *why* the change was made, not *what* changed
- Reference related issues if applicable

Review the recent commit history with \`git log --oneline -10\` to match the project's style.

Do not stage or commit anything — only output the suggested commit message.
`,

  'refactor.md': `# Refactor Code

Suggest and apply refactoring improvements to the specified code.

## Instructions

Analyze $FILE and suggest refactoring improvements. Focus on:

1. **Extract**: Long functions that should be split, repeated code to DRY up
2. **Simplify**: Complex conditionals, deeply nested logic, unclear control flow
3. **Rename**: Variables, functions, or types with unclear or misleading names
4. **Restructure**: Better organization of modules, classes, or interfaces
5. **Modernize**: Use of newer language features that improve clarity

For each suggestion:
- Explain the problem with the current code
- Show the proposed refactored version
- Explain why the refactoring is an improvement

Apply changes that are clearly beneficial. Flag subjective improvements for discussion.
Target: $GOAL
`,
}

/**
 * Create starter command templates in the user commands directory.
 * Skips files that already exist. Returns list of created file paths.
 */
export async function createDefaultCommands(): Promise<string[]> {
  const baseDir = getUserCommandsDir()
  const created: string[] = []

  for (const [relPath, content] of Object.entries(DEFAULT_COMMANDS)) {
    const fullPath = join(baseDir, relPath)
    if (existsSync(fullPath)) {
      continue
    }

    const dir = dirname(fullPath)
    mkdirSync(dir, { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
    created.push(fullPath)
  }

  return created
}
