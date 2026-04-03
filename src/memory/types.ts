/**
 * Knowledge graph types for persistent context across sessions.
 *
 * The graph stores entities (files, functions, classes, etc.),
 * relations between them, and per-entity metadata/observations.
 * Session history tracks access patterns for relevance scoring.
 */

export type EntityType =
  | 'file'
  | 'function'
  | 'class'
  | 'module'
  | 'concept'
  | 'decision'
  | 'pattern'
  | 'dependency'
  | 'config'
  | 'custom'

export type RelationType =
  | 'depends_on'
  | 'contains'
  | 'implements'
  | 'calls'
  | 'modifies'
  | 'references'
  | 'related_to'
  | 'supersedes'

export type Entity = {
  id: string
  type: EntityType
  name: string
  description?: string
  metadata: Record<string, any>
  tags: string[]
  createdAt: number
  updatedAt: number
  accessCount: number
  lastAccessedAt: number
}

export type Relation = {
  id: string
  sourceId: string
  targetId: string
  type: RelationType
  weight: number // 0-1 strength
  metadata?: Record<string, any>
  createdAt: number
}

export type KnowledgeGraph = {
  version: number
  entities: Map<string, Entity>
  relations: Relation[]
  sessionHistory: SessionEntry[]
}

export type SessionEntry = {
  sessionId: string
  timestamp: number
  entitiesAccessed: string[]
  entitiesCreated: string[]
  summary?: string
}

export type MemoryQuery = {
  entityType?: EntityType
  tags?: string[]
  namePattern?: string
  relatedTo?: string
  limit?: number
  sortBy?: 'relevance' | 'recent' | 'frequent'
}

export type MemorySearchResult = {
  entity: Entity
  score: number
  relatedEntities: Entity[]
}

/**
 * Serializable shape of the knowledge graph for JSON persistence.
 * Map<string, Entity> is stored as a plain record on disk.
 */
export type SerializedKnowledgeGraph = {
  version: number
  entities: Record<string, Entity>
  relations: Relation[]
  sessionHistory: SessionEntry[]
}

export type MemoryStats = {
  entityCount: number
  relationCount: number
  sessionCount: number
  entityCountByType: Record<string, number>
  oldestEntity: number | null
  newestEntity: number | null
}
