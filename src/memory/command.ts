/**
 * Slash command handler for /memory.
 *
 * Subcommands:
 *   /memory status          — Show memory stats
 *   /memory search <query>  — Search entities
 *   /memory add <type> <name> [description] — Add entity manually
 *   /memory forget <id>     — Remove entity
 *   /memory relate <id1> <relation> <id2> — Add relation
 *   /memory recall [topic]  — Get relevant context
 *   /memory prune           — Clean up old entries
 *   /memory export          — Export graph as JSON
 *   /memory clear           — Clear all memory (with confirmation)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'

import type {
  Entity,
  EntityType,
  KnowledgeGraph,
  MemorySearchResult,
  MemoryStats,
  Relation,
  RelationType,
  SerializedKnowledgeGraph,
} from './types.js'
import { buildMemoryContext, extractEntityReferences } from './contextProvider.js'

// ----- persistence helpers ----- //

const VALID_ENTITY_TYPES: EntityType[] = [
  'file',
  'function',
  'class',
  'module',
  'concept',
  'decision',
  'pattern',
  'dependency',
  'config',
  'custom',
]

const VALID_RELATION_TYPES: RelationType[] = [
  'depends_on',
  'contains',
  'implements',
  'calls',
  'modifies',
  'references',
  'related_to',
  'supersedes',
]

function graphDir(): string {
  return path.join(os.homedir(), '.void', 'memory')
}

function graphPath(): string {
  return path.join(graphDir(), 'knowledge-graph.json')
}

function ensureDir(): void {
  const dir = graphDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function loadGraph(): KnowledgeGraph {
  const fp = graphPath()
  if (!fs.existsSync(fp)) {
    return {
      version: 1,
      entities: new Map(),
      relations: [],
      sessionHistory: [],
    }
  }
  const raw = fs.readFileSync(fp, 'utf-8')
  const data: SerializedKnowledgeGraph = JSON.parse(raw)
  const entities = new Map<string, Entity>()
  for (const [id, entity] of Object.entries(data.entities)) {
    entities.set(id, entity)
  }
  return {
    version: data.version,
    entities,
    relations: data.relations ?? [],
    sessionHistory: data.sessionHistory ?? [],
  }
}

function saveGraph(graph: KnowledgeGraph): void {
  ensureDir()
  const entities: Record<string, Entity> = {}
  for (const [id, entity] of graph.entities) {
    entities[id] = entity
  }
  const data: SerializedKnowledgeGraph = {
    version: graph.version,
    entities,
    relations: graph.relations,
    sessionHistory: graph.sessionHistory,
  }
  fs.writeFileSync(graphPath(), JSON.stringify(data, null, 2), 'utf-8')
}

function generateId(): string {
  return crypto.randomUUID()
}

// ----- subcommand implementations ----- //

function statusCmd(graph: KnowledgeGraph): string {
  const stats = computeStats(graph)
  const lines: string[] = [
    'Memory status:',
    `  Entities : ${stats.entityCount}`,
    `  Relations: ${stats.relationCount}`,
    `  Sessions : ${stats.sessionCount}`,
  ]

  if (stats.entityCount > 0) {
    lines.push('  By type:')
    for (const [type, count] of Object.entries(stats.entityCountByType)) {
      lines.push(`    ${type}: ${count}`)
    }
    if (stats.oldestEntity !== null) {
      lines.push(`  Oldest: ${new Date(stats.oldestEntity).toISOString()}`)
    }
    if (stats.newestEntity !== null) {
      lines.push(`  Newest: ${new Date(stats.newestEntity).toISOString()}`)
    }
  }

  lines.push(`  Storage: ${graphPath()}`)
  return lines.join('\n')
}

function computeStats(graph: KnowledgeGraph): MemoryStats {
  const entityCountByType: Record<string, number> = {}
  let oldest: number | null = null
  let newest: number | null = null

  for (const entity of graph.entities.values()) {
    entityCountByType[entity.type] =
      (entityCountByType[entity.type] ?? 0) + 1
    if (oldest === null || entity.createdAt < oldest) oldest = entity.createdAt
    if (newest === null || entity.createdAt > newest) newest = entity.createdAt
  }

  return {
    entityCount: graph.entities.size,
    relationCount: graph.relations.length,
    sessionCount: graph.sessionHistory.length,
    entityCountByType,
    oldestEntity: oldest,
    newestEntity: newest,
  }
}

function searchCmd(graph: KnowledgeGraph, query: string): string {
  if (!query) return 'Usage: /memory search <query>'

  const lower = query.toLowerCase()
  const matches: Entity[] = []

  for (const entity of graph.entities.values()) {
    const haystack =
      `${entity.name} ${entity.description ?? ''} ${entity.tags.join(' ')}`.toLowerCase()
    if (haystack.includes(lower)) {
      matches.push(entity)
    }
  }

  if (matches.length === 0) return `No entities matching "${query}".`

  const lines = [`Found ${matches.length} matching entit${matches.length === 1 ? 'y' : 'ies'}:`]
  for (const e of matches.slice(0, 20)) {
    lines.push(
      `  [${e.id.slice(0, 8)}] ${e.type}:${e.name}${e.description ? ' — ' + e.description.slice(0, 60) : ''}`,
    )
  }
  if (matches.length > 20) {
    lines.push(`  ... and ${matches.length - 20} more`)
  }
  return lines.join('\n')
}

function addCmd(
  graph: KnowledgeGraph,
  type: string,
  name: string,
  description: string,
): string {
  if (!type || !name) {
    return 'Usage: /memory add <type> <name> [description]'
  }

  if (!VALID_ENTITY_TYPES.includes(type as EntityType)) {
    return `Invalid entity type "${type}". Valid types: ${VALID_ENTITY_TYPES.join(', ')}`
  }

  const now = Date.now()
  const id = generateId()
  const entity: Entity = {
    id,
    type: type as EntityType,
    name,
    description: description || undefined,
    metadata: {},
    tags: [],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
  }

  graph.entities.set(id, entity)
  saveGraph(graph)

  return `Added ${type} entity "${name}" (${id.slice(0, 8)})`
}

function forgetCmd(graph: KnowledgeGraph, idPrefix: string): string {
  if (!idPrefix) return 'Usage: /memory forget <id>'

  const match = findEntityByPrefix(graph, idPrefix)
  if (!match) return `No entity found matching id prefix "${idPrefix}".`

  const [id, entity] = match
  graph.entities.delete(id)

  // Remove related relations
  graph.relations = graph.relations.filter(
    (r) => r.sourceId !== id && r.targetId !== id,
  )

  saveGraph(graph)
  return `Removed entity "${entity.name}" (${entity.type}) and its relations.`
}

function relateCmd(
  graph: KnowledgeGraph,
  id1Prefix: string,
  relation: string,
  id2Prefix: string,
): string {
  if (!id1Prefix || !relation || !id2Prefix) {
    return `Usage: /memory relate <id1> <relation> <id2>\nValid relations: ${VALID_RELATION_TYPES.join(', ')}`
  }

  if (!VALID_RELATION_TYPES.includes(relation as RelationType)) {
    return `Invalid relation type "${relation}". Valid types: ${VALID_RELATION_TYPES.join(', ')}`
  }

  const match1 = findEntityByPrefix(graph, id1Prefix)
  if (!match1) return `No entity found matching id prefix "${id1Prefix}".`

  const match2 = findEntityByPrefix(graph, id2Prefix)
  if (!match2) return `No entity found matching id prefix "${id2Prefix}".`

  const [sourceId, sourceEntity] = match1
  const [targetId, targetEntity] = match2

  const rel: Relation = {
    id: generateId(),
    sourceId,
    targetId,
    type: relation as RelationType,
    weight: 1.0,
    createdAt: Date.now(),
  }

  graph.relations.push(rel)
  saveGraph(graph)

  return `Added relation: "${sourceEntity.name}" —[${relation}]→ "${targetEntity.name}"`
}

function recallCmd(graph: KnowledgeGraph, topic: string): string {
  if (graph.entities.size === 0) return 'Memory is empty. Nothing to recall.'

  let results: MemorySearchResult[]

  if (topic) {
    // Use entity reference extraction + text search
    const refs = extractEntityReferences(topic)
    const lower = topic.toLowerCase()
    const scored: Array<{ entity: Entity; score: number }> = []

    for (const entity of graph.entities.values()) {
      let score = 0

      // Check direct name/ref match
      for (const ref of refs) {
        if (entity.name.includes(ref.name) || ref.name.includes(entity.name)) {
          score += ref.confidence
        }
      }

      // Text similarity
      const haystack =
        `${entity.name} ${entity.description ?? ''} ${entity.tags.join(' ')}`.toLowerCase()
      if (haystack.includes(lower)) {
        score += 0.4
      }

      // Recency bonus
      const ageHours =
        (Date.now() - entity.lastAccessedAt) / (1000 * 60 * 60)
      if (ageHours < 24) score += 0.2
      else if (ageHours < 168) score += 0.1

      // Frequency bonus
      if (entity.accessCount > 5) score += 0.1

      if (score > 0) scored.push({ entity, score })
    }

    scored.sort((a, b) => b.score - a.score)

    results = scored.slice(0, 10).map(({ entity, score }) => ({
      entity,
      score,
      relatedEntities: findRelatedEntities(graph, entity.id),
    }))
  } else {
    // Return most recently accessed entities
    const sorted = [...graph.entities.values()]
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, 10)

    results = sorted.map((entity) => ({
      entity,
      score: 1,
      relatedEntities: findRelatedEntities(graph, entity.id),
    }))
  }

  if (results.length === 0) {
    return topic
      ? `No memories related to "${topic}".`
      : 'Memory is empty.'
  }

  return buildMemoryContext(results, 2000) || 'No relevant context found.'
}

function pruneCmd(graph: KnowledgeGraph): string {
  const now = Date.now()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  let pruned = 0

  const toRemove: string[] = []
  for (const [id, entity] of graph.entities) {
    // Prune entities not accessed in 30 days with low access count
    if (
      now - entity.lastAccessedAt > thirtyDays &&
      entity.accessCount < 3
    ) {
      toRemove.push(id)
    }
  }

  for (const id of toRemove) {
    graph.entities.delete(id)
    pruned++
  }

  // Clean up orphaned relations
  const validIds = new Set(graph.entities.keys())
  const beforeRelCount = graph.relations.length
  graph.relations = graph.relations.filter(
    (r) => validIds.has(r.sourceId) && validIds.has(r.targetId),
  )
  const relsPruned = beforeRelCount - graph.relations.length

  // Trim session history older than 90 days
  const ninetyDays = 90 * 24 * 60 * 60 * 1000
  const beforeSessions = graph.sessionHistory.length
  graph.sessionHistory = graph.sessionHistory.filter(
    (s) => now - s.timestamp < ninetyDays,
  )
  const sessionsPruned = beforeSessions - graph.sessionHistory.length

  saveGraph(graph)

  return [
    `Pruned ${pruned} stale entit${pruned === 1 ? 'y' : 'ies'} (not accessed in 30 days, <3 accesses).`,
    `Removed ${relsPruned} orphaned relation${relsPruned === 1 ? '' : 's'}.`,
    `Trimmed ${sessionsPruned} session${sessionsPruned === 1 ? '' : 's'} older than 90 days.`,
  ].join('\n')
}

function exportCmd(graph: KnowledgeGraph): string {
  const entities: Record<string, Entity> = {}
  for (const [id, entity] of graph.entities) {
    entities[id] = entity
  }

  const data: SerializedKnowledgeGraph = {
    version: graph.version,
    entities,
    relations: graph.relations,
    sessionHistory: graph.sessionHistory,
  }

  return JSON.stringify(data, null, 2)
}

function clearCmd(graph: KnowledgeGraph, confirmed: boolean): string {
  if (!confirmed) {
    return 'Are you sure you want to clear all memory? Run "/memory clear --confirm" to proceed.'
  }

  graph.entities.clear()
  graph.relations = []
  graph.sessionHistory = []

  saveGraph(graph)
  return 'All memory has been cleared.'
}

// ----- helper functions ----- //

function findEntityByPrefix(
  graph: KnowledgeGraph,
  prefix: string,
): [string, Entity] | null {
  for (const [id, entity] of graph.entities) {
    if (id.startsWith(prefix)) return [id, entity]
  }
  return null
}

function findRelatedEntities(
  graph: KnowledgeGraph,
  entityId: string,
): Entity[] {
  const relatedIds = new Set<string>()
  for (const rel of graph.relations) {
    if (rel.sourceId === entityId) relatedIds.add(rel.targetId)
    if (rel.targetId === entityId) relatedIds.add(rel.sourceId)
  }

  const related: Entity[] = []
  for (const id of relatedIds) {
    const entity = graph.entities.get(id)
    if (entity) related.push(entity)
  }
  return related
}

// ----- main command handler ----- //

export async function handleMemoryCommand(
  args: string,
): Promise<{ output: string; isError?: boolean }> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? ''
  const rest = parts.slice(1)

  try {
    const graph = loadGraph()

    switch (subcommand) {
      case '':
      case 'help':
        return {
          output: [
            'Usage: /memory <subcommand>',
            '',
            '  status          — Show memory stats',
            '  search <query>  — Search entities',
            '  add <type> <name> [description] — Add entity manually',
            '  forget <id>     — Remove entity',
            '  relate <id1> <relation> <id2> — Add relation',
            '  recall [topic]  — Get relevant context',
            '  prune           — Clean up old entries',
            '  export          — Export graph as JSON',
            '  clear           — Clear all memory (with confirmation)',
            '',
            `Valid entity types: ${VALID_ENTITY_TYPES.join(', ')}`,
            `Valid relation types: ${VALID_RELATION_TYPES.join(', ')}`,
          ].join('\n'),
        }

      case 'status':
        return { output: statusCmd(graph) }

      case 'search':
        return { output: searchCmd(graph, rest.join(' ')) }

      case 'add': {
        const type = rest[0] ?? ''
        const name = rest[1] ?? ''
        const description = rest.slice(2).join(' ')
        return { output: addCmd(graph, type, name, description) }
      }

      case 'forget':
        return { output: forgetCmd(graph, rest[0] ?? '') }

      case 'relate':
        return {
          output: relateCmd(graph, rest[0] ?? '', rest[1] ?? '', rest[2] ?? ''),
        }

      case 'recall':
        return { output: recallCmd(graph, rest.join(' ')) }

      case 'prune':
        return { output: pruneCmd(graph) }

      case 'export':
        return { output: exportCmd(graph) }

      case 'clear': {
        const confirmed =
          rest.includes('--confirm') || rest.includes('--yes')
        return { output: clearCmd(graph, confirmed) }
      }

      default:
        return {
          output: `Unknown subcommand "${subcommand}". Run "/memory help" for usage.`,
          isError: true,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      output: `Memory error: ${message}`,
      isError: true,
    }
  }
}
