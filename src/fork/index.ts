import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ForkNode = {
  id: string
  parentId: string | null
  turnNumber: number
  messages: any[]
  createdAt: string
  label?: string
}

type ForkTreeData = {
  sessionId: string
  rootId: string
  activeForkId: string
  nodes: Record<string, ForkNode>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(): string {
  return randomUUID().slice(0, 8)
}

function forksDir(): string {
  const dir = join(homedir(), '.void', 'forks')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function sessionPath(sessionId: string): string {
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return join(forksDir(), `${hash}.json`)
}

// ---------------------------------------------------------------------------
// ForkTree – manages the tree of conversation forks for a single session
// ---------------------------------------------------------------------------

export class ForkTree {
  private data: ForkTreeData

  constructor(sessionId: string) {
    const rootId = shortId()
    this.data = {
      sessionId,
      rootId,
      activeForkId: rootId,
      nodes: {
        [rootId]: {
          id: rootId,
          parentId: null,
          turnNumber: 0,
          messages: [],
          createdAt: new Date().toISOString(),
          label: 'main',
        },
      },
    }
  }

  // -- persistence ----------------------------------------------------------

  static load(sessionId: string): ForkTree | null {
    const p = sessionPath(sessionId)
    if (!existsSync(p)) {
      return null
    }
    try {
      const raw = readFileSync(p, 'utf-8')
      const parsed = JSON.parse(raw) as ForkTreeData
      const tree = new ForkTree(sessionId)
      tree.data = parsed
      return tree
    } catch {
      return null
    }
  }

  save(): void {
    const p = sessionPath(this.data.sessionId)
    writeFileSync(p, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  // -- core operations ------------------------------------------------------

  /**
   * Create a fork branching from a specific turn number.
   * The fork inherits messages up to (and including) the given turn from the
   * currently active branch.
   */
  createFork(turnNumber: number, label?: string): ForkNode {
    const parentNode = this.data.nodes[this.data.activeForkId]
    if (!parentNode) {
      throw new Error(`Active fork ${this.data.activeForkId} not found`)
    }

    if (turnNumber < 0) {
      throw new Error('Turn number must be non-negative')
    }

    const id = shortId()
    // Inherit messages from parent up to the fork point
    const inherited = parentNode.messages.slice(0, turnNumber)

    const node: ForkNode = {
      id,
      parentId: parentNode.id,
      turnNumber,
      messages: inherited,
      createdAt: new Date().toISOString(),
      label,
    }

    this.data.nodes[id] = node
    this.save()
    return node
  }

  /**
   * Return all fork nodes.
   */
  listForks(): ForkNode[] {
    return Object.values(this.data.nodes)
  }

  /**
   * Switch the active branch.
   */
  switchFork(id: string): ForkNode {
    const node = this.data.nodes[id]
    if (!node) {
      throw new Error(`Fork "${id}" not found`)
    }
    this.data.activeForkId = id
    this.save()
    return node
  }

  /**
   * Get the currently active fork.
   */
  getCurrentFork(): ForkNode {
    const node = this.data.nodes[this.data.activeForkId]
    if (!node) {
      throw new Error('Active fork not found — tree may be corrupted')
    }
    return node
  }

  /**
   * Collect the full message history for a fork by walking up the parent
   * chain to gather messages up to the fork point, then appending the
   * fork's own messages.
   */
  getForkHistory(id: string): any[] {
    const node = this.data.nodes[id]
    if (!node) {
      throw new Error(`Fork "${id}" not found`)
    }

    const chain: ForkNode[] = []
    let current: ForkNode | undefined = node
    while (current) {
      chain.unshift(current)
      current = current.parentId
        ? this.data.nodes[current.parentId]
        : undefined
    }

    // Build composite history: for each ancestor, take messages from 0..turnNumber,
    // then for the leaf node take all messages.
    const history: any[] = []
    for (let i = 0; i < chain.length; i++) {
      const n = chain[i]!
      if (i < chain.length - 1) {
        // Ancestor: only take messages up to the next fork's turn number
        const nextFork = chain[i + 1]!
        const slice = n.messages.slice(0, nextFork.turnNumber)
        // Only add messages that haven't been added yet (inherited messages
        // are already included in child forks, so we skip for non-root
        // ancestors after the first).
        if (i === 0) {
          history.push(...slice)
        }
      } else {
        // Leaf node: add all its messages (which already includes inherited ones)
        // But skip the inherited portion we already added from ancestors
        if (chain.length === 1) {
          history.push(...n.messages)
        } else {
          // The leaf's messages already contain inherited messages from creation;
          // just return them directly since they represent the full branch.
          return n.messages
        }
      }
    }

    return history
  }

  /**
   * Compare two forks by showing messages that differ.
   */
  diffForks(
    id1: string,
    id2: string,
  ): { fork1Only: any[]; fork2Only: any[]; commonCount: number } {
    const msgs1 = this.getForkHistory(id1)
    const msgs2 = this.getForkHistory(id2)

    // Find common prefix length
    let commonCount = 0
    const minLen = Math.min(msgs1.length, msgs2.length)
    for (let i = 0; i < minLen; i++) {
      if (JSON.stringify(msgs1[i]) === JSON.stringify(msgs2[i])) {
        commonCount++
      } else {
        break
      }
    }

    return {
      fork1Only: msgs1.slice(commonCount),
      fork2Only: msgs2.slice(commonCount),
      commonCount,
    }
  }

  /**
   * Remove a fork. Cannot delete the root node.
   */
  deleteFork(id: string): void {
    if (id === this.data.rootId) {
      throw new Error('Cannot delete the root (main) branch')
    }
    const node = this.data.nodes[id]
    if (!node) {
      throw new Error(`Fork "${id}" not found`)
    }

    // Also delete any children that descend from this fork
    const toDelete = this.getDescendants(id)
    toDelete.push(id)

    for (const delId of toDelete) {
      delete this.data.nodes[delId]
    }

    // If the active fork was deleted, switch to root
    if (toDelete.includes(this.data.activeForkId)) {
      this.data.activeForkId = this.data.rootId
    }

    this.save()
  }

  /**
   * Set or update a label on a fork.
   */
  setLabel(id: string, label: string): void {
    const node = this.data.nodes[id]
    if (!node) {
      throw new Error(`Fork "${id}" not found`)
    }
    node.label = label
    this.save()
  }

  /**
   * Add a message to the currently active fork.
   */
  addMessage(message: any): void {
    const node = this.data.nodes[this.data.activeForkId]
    if (!node) {
      throw new Error('Active fork not found')
    }
    node.messages.push(message)
    this.save()
  }

  /**
   * Return the full tree structure for visualization.
   */
  getTree(): {
    rootId: string
    activeForkId: string
    nodes: Record<string, ForkNode>
  } {
    return {
      rootId: this.data.rootId,
      activeForkId: this.data.activeForkId,
      nodes: { ...this.data.nodes },
    }
  }

  // -- private helpers ------------------------------------------------------

  private getDescendants(id: string): string[] {
    const descendants: string[] = []
    const queue = [id]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const [nodeId, node] of Object.entries(this.data.nodes)) {
        if (node.parentId === current && nodeId !== id) {
          descendants.push(nodeId)
          queue.push(nodeId)
        }
      }
    }
    return descendants
  }
}

// ---------------------------------------------------------------------------
// ForkManager – high-level manager around ForkTree with session awareness
// ---------------------------------------------------------------------------

export class ForkManager {
  private tree: ForkTree | null = null
  private sessionId: string | null = null

  /**
   * Initialize (or load) the fork tree for a session.
   */
  init(sessionId: string): ForkTree {
    this.sessionId = sessionId
    const existing = ForkTree.load(sessionId)
    if (existing) {
      this.tree = existing
    } else {
      this.tree = new ForkTree(sessionId)
      this.tree.save()
    }
    return this.tree
  }

  /**
   * Create a fork at the given turn number (defaults to current message count).
   */
  fork(turnNumber?: number, label?: string): ForkNode {
    const tree = this.ensureTree()
    const current = tree.getCurrentFork()
    const turn = turnNumber ?? current.messages.length
    return tree.createFork(turn, label)
  }

  /**
   * List all forks.
   */
  list(): ForkNode[] {
    return this.ensureTree().listForks()
  }

  /**
   * Switch to a fork by ID.
   */
  switch(id: string): ForkNode {
    return this.ensureTree().switchFork(id)
  }

  /**
   * Compare two forks.
   */
  diff(
    id1: string,
    id2: string,
  ): { fork1Only: any[]; fork2Only: any[]; commonCount: number } {
    return this.ensureTree().diffForks(id1, id2)
  }

  /**
   * Produce an ASCII tree visualization of all forks.
   */
  visualize(): string {
    const tree = this.ensureTree()
    const { rootId, activeForkId, nodes } = tree.getTree()

    // Build children map
    const children: Record<string, string[]> = {}
    for (const node of Object.values(nodes)) {
      if (node.parentId) {
        if (!children[node.parentId]) {
          children[node.parentId] = []
        }
        children[node.parentId]!.push(node.id)
      }
    }

    const lines: string[] = []

    const renderNode = (id: string, prefix: string, isLast: boolean): void => {
      const node = nodes[id]
      if (!node) return

      const isActive = id === activeForkId
      const labelStr = node.label ? ` "${node.label}"` : ''
      const turnStr = `${node.messages.length} msgs`
      const activeMarker = isActive ? ' *' : ''
      const displayId =
        node.parentId === null ? 'main' : `fork-${node.id}`

      const connector = prefix === '' ? '' : isLast ? '└── ' : '├── '
      lines.push(
        `${prefix}${connector}${displayId}${labelStr} (${turnStr}, turn ${node.turnNumber})${activeMarker}`,
      )

      const kids = children[id] || []
      const newPrefix =
        prefix === '' ? '' : prefix + (isLast ? '    ' : '│   ')
      for (let i = 0; i < kids.length; i++) {
        renderNode(kids[i]!, newPrefix, i === kids.length - 1)
      }
    }

    renderNode(rootId, '', true)
    return lines.join('\n')
  }

  /**
   * Get the underlying ForkTree (for advanced use).
   */
  getTree(): ForkTree {
    return this.ensureTree()
  }

  private ensureTree(): ForkTree {
    if (!this.tree) {
      throw new Error(
        'ForkManager not initialized. Call init(sessionId) first.',
      )
    }
    return this.tree
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ForkManager | null = null

export function getForkManager(): ForkManager {
  if (!_instance) {
    _instance = new ForkManager()
  }
  return _instance
}
