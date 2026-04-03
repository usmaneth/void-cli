/**
 * Memory Context Provider — extracts and injects knowledge graph context.
 */
import type { Entity, EntityType, MemorySearchResult } from './types.js'

/**
 * Extract entity references from a user message.
 * Looks for file paths, function names, class names, module references.
 */
export function extractEntityReferences(text: string): Array<{
  name: string
  type: EntityType
  confidence: number
}> {
  const refs: Array<{ name: string; type: EntityType; confidence: number }> = []

  // File paths (e.g., src/utils/model.ts, ./config.json)
  const filePaths = text.match(/(?:^|\s)((?:\.\/|src\/|[\w-]+\/)+[\w.-]+\.\w+)/gm)
  if (filePaths) {
    for (const fp of filePaths) {
      refs.push({ name: fp.trim(), type: 'file', confidence: 0.9 })
    }
  }

  // Function/method names (e.g., calculateCost(), handleSubmit)
  const funcNames = text.match(/\b([a-z][a-zA-Z0-9]+)\s*\(/g)
  if (funcNames) {
    for (const fn of funcNames) {
      const name = fn.replace(/\s*\($/, '')
      if (name.length > 2) {
        refs.push({ name, type: 'function', confidence: 0.6 })
      }
    }
  }

  // Class names (PascalCase words)
  const classNames = text.match(/\b([A-Z][a-zA-Z0-9]{2,})\b/g)
  if (classNames) {
    for (const cn of classNames) {
      // Skip common non-class words
      if (
        ![
          'The',
          'This',
          'That',
          'What',
          'When',
          'Where',
          'How',
          'Why',
          'API',
          'URL',
          'CLI',
          'JSON',
          'HTML',
          'CSS',
          'SQL',
        ].includes(cn)
      ) {
        refs.push({ name: cn, type: 'class', confidence: 0.5 })
      }
    }
  }

  return refs
}

/**
 * Extract entities from tool use results.
 */
export function extractFromToolUse(
  toolName: string,
  input: Record<string, any>,
  _output?: any,
): Array<{ name: string; type: EntityType; metadata: Record<string, any> }> {
  const entities: Array<{
    name: string
    type: EntityType
    metadata: Record<string, any>
  }> = []

  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
      if (input.file_path) {
        entities.push({
          name: String(input.file_path),
          type: 'file',
          metadata: { toolUsed: toolName, lastModified: Date.now() },
        })
      }
      break
    case 'Bash':
      if (input.command) {
        // Extract package names from npm/pip commands
        const npmMatch = String(input.command).match(
          /npm\s+(?:install|i)\s+(.+)/i,
        )
        if (npmMatch) {
          for (const pkg of npmMatch[1]!.split(/\s+/)) {
            if (pkg && !pkg.startsWith('-')) {
              entities.push({
                name: pkg,
                type: 'dependency',
                metadata: { packageManager: 'npm' },
              })
            }
          }
        }
      }
      break
    case 'Grep':
    case 'Glob':
      if (input.pattern) {
        entities.push({
          name: String(input.pattern),
          type: 'concept',
          metadata: { searchPattern: true },
        })
      }
      break
  }

  return entities
}

/**
 * Build a context summary from memory search results.
 * This gets injected into the system prompt.
 */
export function buildMemoryContext(
  results: MemorySearchResult[],
  maxTokens: number = 500,
): string {
  if (results.length === 0) return ''

  const lines: string[] = [
    '## Memory Context (from previous sessions)',
    '',
  ]

  let tokenEstimate = 10 // header tokens

  for (const { entity, relatedEntities } of results) {
    const line = `- **${entity.name}** (${entity.type}): ${entity.description || 'No description'}${entity.tags.length > 0 ? ` [${entity.tags.join(', ')}]` : ''}`
    const lineTokens = Math.ceil(line.length / 4)

    if (tokenEstimate + lineTokens > maxTokens) break

    lines.push(line)
    tokenEstimate += lineTokens

    // Add related entities if space permits
    for (const related of relatedEntities.slice(0, 3)) {
      const relLine = `  - Related: ${related.name} (${related.type})`
      const relTokens = Math.ceil(relLine.length / 4)
      if (tokenEstimate + relTokens > maxTokens) break
      lines.push(relLine)
      tokenEstimate += relTokens
    }
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Record a decision or pattern learned during a session.
 */
export function createDecisionEntity(
  decision: string,
  context: string,
  tags: string[] = [],
): {
  name: string
  type: EntityType
  description: string
  metadata: Record<string, any>
  tags: string[]
} {
  return {
    name: decision.slice(0, 100),
    type: 'decision',
    description: decision,
    metadata: { context, recordedAt: Date.now() },
    tags: ['decision', ...tags],
  }
}

/**
 * Create a pattern entity from observed code patterns.
 */
export function createPatternEntity(
  pattern: string,
  examples: string[],
  tags: string[] = [],
): {
  name: string
  type: EntityType
  description: string
  metadata: Record<string, any>
  tags: string[]
} {
  return {
    name: pattern.slice(0, 100),
    type: 'pattern',
    description: pattern,
    metadata: { examples, recordedAt: Date.now() },
    tags: ['pattern', ...tags],
  }
}
