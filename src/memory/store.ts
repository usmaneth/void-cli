/**
 * Persistent knowledge-graph store.
 *
 * Saves/loads the graph to ~/.void/memory/graph.json using atomic writes
 * (write to temp file, then rename). Provides CRUD for entities and
 * relations, search/query, access tracking, and pruning.
 */

import * as fs from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type {
  Entity,
  EntityType,
  KnowledgeGraph,
  MemoryQuery,
  MemorySearchResult,
  MemoryStats,
  Relation,
  RelationType,
  SerializedKnowledgeGraph,
  SessionEntry,
} from './types.js'

const GRAPH_VERSION = 1
const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
const DEFAULT_MAX_ENTITIES = 10_000

function getGraphDir(): string {
  return join(homedir(), '.void', 'memory')
}

function getGraphPath(): string {
  return join(getGraphDir(), 'graph.json')
}

function createEmptyGraph(): KnowledgeGraph {
  return {
    version: GRAPH_VERSION,
    entities: new Map(),
    relations: [],
    sessionHistory: [],
  }
}

function serializeGraph(graph: KnowledgeGraph): SerializedKnowledgeGraph {
  const entities: Record<string, Entity> = {}
  for (const [id, entity] of graph.entities) {
    entities[id] = entity
  }
  return {
    version: graph.version,
    entities,
    relations: graph.relations,
    sessionHistory: graph.sessionHistory,
  }
}

function deserializeGraph(data: SerializedKnowledgeGraph): KnowledgeGraph {
  const entities = new Map<string, Entity>()
  if (data.entities) {
    for (const [id, entity] of Object.entries(data.entities)) {
      entities.set(id, entity)
    }
  }
  return {
    version: data.version ?? GRAPH_VERSION,
    entities,
    relations: data.relations ?? [],
    sessionHistory: data.sessionHistory ?? [],
  }
}

export class MemoryStore {
  private graph: KnowledgeGraph
  private dirty = false

  private constructor(graph: KnowledgeGraph) {
    this.graph = graph
  }

  /**
   * Load or create the knowledge graph from disk.
   */
  static async init(): Promise<MemoryStore> {
    const graphPath = getGraphPath()
    try {
      const raw = await fs.readFile(graphPath, 'utf-8')
      const data: SerializedKnowledgeGraph = JSON.parse(raw)
      return new MemoryStore(deserializeGraph(data))
    } catch {
      // File doesn't exist or is corrupt — start fresh
      return new MemoryStore(createEmptyGraph())
    }
  }

  // ---------------------------------------------------------------------------
  // Entity CRUD
  // ---------------------------------------------------------------------------

  addEntity(params: {
    type: EntityType
    name: string
    description?: string
    metadata?: Record<string, any>
    tags?: string[]
  }): Entity {
    const now = Date.now()
    const entity: Entity = {
      id: randomUUID(),
      type: params.type,
      name: params.name,
      description: params.description,
      metadata: params.metadata ?? {},
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    }
    this.graph.entities.set(entity.id, entity)
    this.dirty = true
    return entity
  }

  getEntity(id: string): Entity | undefined {
    return this.graph.entities.get(id)
  }

  updateEntity(
    id: string,
    partial: Partial<Omit<Entity, 'id' | 'createdAt'>>,
  ): Entity | undefined {
    const existing = this.graph.entities.get(id)
    if (!existing) return undefined
    const updated: Entity = {
      ...existing,
      ...partial,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.graph.entities.set(id, updated)
    this.dirty = true
    return updated
  }

  removeEntity(id: string): boolean {
    const deleted = this.graph.entities.delete(id)
    if (deleted) {
      // Also remove relations referencing this entity
      this.graph.relations = this.graph.relations.filter(
        r => r.sourceId !== id && r.targetId !== id,
      )
      this.dirty = true
    }
    return deleted
  }

  // ---------------------------------------------------------------------------
  // Relation CRUD
  // ---------------------------------------------------------------------------

  addRelation(params: {
    sourceId: string
    targetId: string
    type: RelationType
    weight?: number
    metadata?: Record<string, any>
  }): Relation | undefined {
    // Both endpoints must exist
    if (
      !this.graph.entities.has(params.sourceId) ||
      !this.graph.entities.has(params.targetId)
    ) {
      return undefined
    }
    const relation: Relation = {
      id: randomUUID(),
      sourceId: params.sourceId,
      targetId: params.targetId,
      type: params.type,
      weight: params.weight ?? 0.5,
      metadata: params.metadata,
      createdAt: Date.now(),
    }
    this.graph.relations.push(relation)
    this.dirty = true
    return relation
  }

  getRelations(entityId: string): Relation[] {
    return this.graph.relations.filter(
      r => r.sourceId === entityId || r.targetId === entityId,
    )
  }

  removeRelation(id: string): boolean {
    const before = this.graph.relations.length
    this.graph.relations = this.graph.relations.filter(r => r.id !== id)
    const removed = this.graph.relations.length < before
    if (removed) this.dirty = true
    return removed
  }

  // ---------------------------------------------------------------------------
  // Search / query
  // ---------------------------------------------------------------------------

  search(query: MemoryQuery): MemorySearchResult[] {
    const now = Date.now()
    let candidates: Entity[] = [...this.graph.entities.values()]

    // Filter by type
    if (query.entityType) {
      candidates = candidates.filter(e => e.type === query.entityType)
    }

    // Filter by tags (all specified tags must be present)
    if (query.tags && query.tags.length > 0) {
      candidates = candidates.filter(e =>
        query.tags!.every(t => e.tags.includes(t)),
      )
    }

    // Filter by name pattern (case-insensitive substring)
    if (query.namePattern) {
      const pattern = query.namePattern.toLowerCase()
      candidates = candidates.filter(e =>
        e.name.toLowerCase().includes(pattern),
      )
    }

    // Filter by relation to a specific entity
    if (query.relatedTo) {
      const relatedIds = new Set(
        this.getRelations(query.relatedTo).map(r =>
          r.sourceId === query.relatedTo ? r.targetId : r.sourceId,
        ),
      )
      candidates = candidates.filter(e => relatedIds.has(e.id))
    }

    // Score and sort
    const scored: MemorySearchResult[] = candidates.map(entity => {
      let score = 0
      switch (query.sortBy) {
        case 'recent':
          // Normalize: more recent = higher score
          score = entity.lastAccessedAt / now
          break
        case 'frequent':
          score = Math.min(entity.accessCount / 100, 1)
          break
        case 'relevance':
        default: {
          // Combined heuristic: recency + frequency + relation weight
          const recency = entity.lastAccessedAt / now
          const frequency = Math.min(entity.accessCount / 100, 1)
          score = recency * 0.5 + frequency * 0.3 + 0.2
          break
        }
      }

      const relatedEntities = this.getRelatedEntitiesShallow(entity.id)

      return { entity, score, relatedEntities }
    })

    scored.sort((a, b) => b.score - a.score)

    const limit = query.limit ?? 20
    return scored.slice(0, limit)
  }

  /**
   * Graph traversal: find entities connected to the given entity up to `depth` hops.
   */
  getRelatedEntities(entityId: string, depth = 1): Entity[] {
    const visited = new Set<string>([entityId])
    let frontier = new Set<string>([entityId])

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>()
      for (const id of frontier) {
        for (const rel of this.getRelations(id)) {
          const neighbor =
            rel.sourceId === id ? rel.targetId : rel.sourceId
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            nextFrontier.add(neighbor)
          }
        }
      }
      frontier = nextFrontier
      if (frontier.size === 0) break
    }

    visited.delete(entityId)
    const result: Entity[] = []
    for (const id of visited) {
      const e = this.graph.entities.get(id)
      if (e) result.push(e)
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Access tracking
  // ---------------------------------------------------------------------------

  recordAccess(entityId: string): void {
    const entity = this.graph.entities.get(entityId)
    if (!entity) return
    entity.accessCount += 1
    entity.lastAccessedAt = Date.now()
    this.dirty = true
  }

  // ---------------------------------------------------------------------------
  // Session history
  // ---------------------------------------------------------------------------

  addSessionEntry(entry: SessionEntry): void {
    this.graph.sessionHistory.push(entry)
    this.dirty = true
  }

  getSessionHistory(): SessionEntry[] {
    return this.graph.sessionHistory
  }

  // ---------------------------------------------------------------------------
  // Pruning
  // ---------------------------------------------------------------------------

  prune(options?: { maxAge?: number; maxEntities?: number }): number {
    const maxAge = options?.maxAge ?? DEFAULT_MAX_AGE_MS
    const maxEntities = options?.maxEntities ?? DEFAULT_MAX_ENTITIES
    const now = Date.now()
    let removed = 0

    // Remove entities older than maxAge that haven't been accessed recently
    for (const [id, entity] of this.graph.entities) {
      if (now - entity.lastAccessedAt > maxAge) {
        this.graph.entities.delete(id)
        removed++
      }
    }

    // If still over limit, remove least-accessed entities
    if (this.graph.entities.size > maxEntities) {
      const sorted = [...this.graph.entities.entries()].sort(
        (a, b) => a[1].accessCount - b[1].accessCount,
      )
      const toRemove = sorted.slice(
        0,
        this.graph.entities.size - maxEntities,
      )
      for (const [id] of toRemove) {
        this.graph.entities.delete(id)
        removed++
      }
    }

    if (removed > 0) {
      // Clean up orphaned relations
      this.graph.relations = this.graph.relations.filter(
        r =>
          this.graph.entities.has(r.sourceId) &&
          this.graph.entities.has(r.targetId),
      )
      this.dirty = true
    }

    return removed
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async save(): Promise<void> {
    if (!this.dirty) return

    const graphPath = getGraphPath()
    const dir = dirname(graphPath)
    await fs.mkdir(dir, { recursive: true })

    const serialized = serializeGraph(this.graph)
    const json = JSON.stringify(serialized, null, 2)

    // Atomic write: write to temp file, then rename
    const tmpPath = graphPath + '.tmp.' + randomUUID()
    try {
      await fs.writeFile(tmpPath, json, 'utf-8')
      await fs.rename(tmpPath, graphPath)
      this.dirty = false
    } catch (err) {
      // Best-effort cleanup of temp file
      try {
        await fs.unlink(tmpPath)
      } catch {
        // ignore
      }
      throw err
    }
  }

  async load(): Promise<void> {
    const graphPath = getGraphPath()
    try {
      const raw = await fs.readFile(graphPath, 'utf-8')
      const data: SerializedKnowledgeGraph = JSON.parse(raw)
      this.graph = deserializeGraph(data)
      this.dirty = false
    } catch {
      // If load fails, keep current graph in memory
    }
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): MemoryStats {
    const entityCountByType: Record<string, number> = {}
    let oldestEntity: number | null = null
    let newestEntity: number | null = null

    for (const entity of this.graph.entities.values()) {
      entityCountByType[entity.type] =
        (entityCountByType[entity.type] ?? 0) + 1
      if (oldestEntity === null || entity.createdAt < oldestEntity) {
        oldestEntity = entity.createdAt
      }
      if (newestEntity === null || entity.createdAt > newestEntity) {
        newestEntity = entity.createdAt
      }
    }

    return {
      entityCount: this.graph.entities.size,
      relationCount: this.graph.relations.length,
      sessionCount: this.graph.sessionHistory.length,
      entityCountByType,
      oldestEntity,
      newestEntity,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getRelatedEntitiesShallow(entityId: string): Entity[] {
    const ids = new Set<string>()
    for (const rel of this.getRelations(entityId)) {
      const other = rel.sourceId === entityId ? rel.targetId : rel.sourceId
      ids.add(other)
    }
    const result: Entity[] = []
    for (const id of ids) {
      const e = this.graph.entities.get(id)
      if (e) result.push(e)
    }
    return result
  }
}

/**
 * Initialize and return a MemoryStore instance.
 */
export async function initMemoryStore(): Promise<MemoryStore> {
  return MemoryStore.init()
}
