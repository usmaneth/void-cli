/**
 * Inter-Agent Messaging — RPC-style communication between agents.
 *
 * Design principles from Rivet Agent OS:
 * - Low-latency RPC between actors
 * - Agents can hand off state to each other
 * - Hierarchical delegation with human-in-the-loop
 * - Full audit trail for all messages
 *
 * Uses only Node.js built-ins.
 */

import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType = 'request' | 'response' | 'notification' | 'handoff'

export type AgentMessage = {
  id: string
  type: MessageType
  from: string
  to: string
  subject: string
  body: string
  replyTo?: string  // ID of message this is responding to
  timestamp: string
  status: 'pending' | 'delivered' | 'read' | 'expired'
  metadata?: Record<string, unknown>
}

export type MessageQueue = {
  agentId: string
  messages: AgentMessage[]
  maxSize: number
}

export type HandoffPayload = {
  taskDescription: string
  context: Record<string, unknown>
  files?: string[]
  previousSteps?: string[]
}

// ---------------------------------------------------------------------------
// MessageBus
// ---------------------------------------------------------------------------

const STORE_DIR = join(homedir(), '.void', 'messaging')
const MAX_QUEUE = 100
const MAX_HISTORY = 500
const MESSAGE_TTL_MS = 300000 // 5 minutes

export class MessageBus {
  private queues: Map<string, MessageQueue> = new Map()
  private history: AgentMessage[] = []
  private handlers: Map<string, (msg: AgentMessage) => void> = new Map()

  constructor() {
    mkdirSync(STORE_DIR, { recursive: true })
    this.loadHistory()
  }

  // -- Core messaging --

  send(from: string, to: string, type: MessageType, subject: string, body: string, replyTo?: string): AgentMessage {
    const msg: AgentMessage = {
      id: randomUUID().slice(0, 8),
      type,
      from,
      to,
      subject,
      body,
      replyTo,
      timestamp: new Date().toISOString(),
      status: 'pending',
    }

    // Add to recipient's queue
    const queue = this.getOrCreateQueue(to)
    queue.messages.push(msg)
    if (queue.messages.length > queue.maxSize) {
      queue.messages = queue.messages.slice(-queue.maxSize)
    }
    msg.status = 'delivered'

    // Add to history
    this.history.push(msg)
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY)
    }

    // Trigger handler if registered
    const handler = this.handlers.get(to)
    if (handler) {
      try { handler(msg) } catch { /* ignore handler errors */ }
    }

    this.saveHistory()
    return msg
  }

  request(from: string, to: string, subject: string, body: string): AgentMessage {
    return this.send(from, to, 'request', subject, body)
  }

  respond(from: string, to: string, subject: string, body: string, replyTo: string): AgentMessage {
    return this.send(from, to, 'response', subject, body, replyTo)
  }

  notify(from: string, to: string, subject: string, body: string): AgentMessage {
    return this.send(from, to, 'notification', subject, body)
  }

  broadcast(from: string, subject: string, body: string): AgentMessage[] {
    const messages: AgentMessage[] = []
    for (const [agentId] of this.queues) {
      if (agentId !== from) {
        messages.push(this.notify(from, agentId, subject, body))
      }
    }
    return messages
  }

  handoff(from: string, to: string, payload: HandoffPayload): AgentMessage {
    return this.send(from, to, 'handoff', `Handoff: ${payload.taskDescription}`, JSON.stringify(payload))
  }

  // -- Queue operations --

  getMessages(agentId: string, unreadOnly = false): AgentMessage[] {
    const queue = this.queues.get(agentId)
    if (!queue) return []
    if (unreadOnly) return queue.messages.filter(m => m.status === 'delivered')
    return [...queue.messages]
  }

  markRead(agentId: string, messageId?: string): void {
    const queue = this.queues.get(agentId)
    if (!queue) return
    for (const msg of queue.messages) {
      if (!messageId || msg.id === messageId) {
        msg.status = 'read'
      }
    }
  }

  clearQueue(agentId: string): void {
    const queue = this.queues.get(agentId)
    if (queue) queue.messages = []
  }

  // -- Agent registration --

  registerAgent(agentId: string): void {
    this.getOrCreateQueue(agentId)
  }

  unregisterAgent(agentId: string): void {
    this.queues.delete(agentId)
  }

  onMessage(agentId: string, handler: (msg: AgentMessage) => void): void {
    this.handlers.set(agentId, handler)
  }

  removeHandler(agentId: string): void {
    this.handlers.delete(agentId)
  }

  // -- Querying --

  getHistory(limit = 50): AgentMessage[] {
    return this.history.slice(-limit).reverse()
  }

  getConversation(agentA: string, agentB: string): AgentMessage[] {
    return this.history.filter(m =>
      (m.from === agentA && m.to === agentB) ||
      (m.from === agentB && m.to === agentA)
    )
  }

  getAgentList(): string[] {
    return Array.from(this.queues.keys())
  }

  getStats(): { totalMessages: number; pending: number; delivered: number; agents: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {}
    for (const m of this.history) {
      byType[m.type] = (byType[m.type] ?? 0) + 1
    }
    const allMsgs = Array.from(this.queues.values()).flatMap(q => q.messages)
    return {
      totalMessages: this.history.length,
      pending: allMsgs.filter(m => m.status === 'pending').length,
      delivered: allMsgs.filter(m => m.status === 'delivered').length,
      agents: this.queues.size,
      byType,
    }
  }

  // -- Cleanup --

  expireOld(): number {
    const cutoff = Date.now() - MESSAGE_TTL_MS
    let expired = 0
    for (const queue of this.queues.values()) {
      const before = queue.messages.length
      queue.messages = queue.messages.filter(m => new Date(m.timestamp).getTime() > cutoff)
      expired += before - queue.messages.length
    }
    return expired
  }

  clearAll(): void {
    this.queues.clear()
    this.history = []
    this.saveHistory()
  }

  // -- Internal --

  private getOrCreateQueue(agentId: string): MessageQueue {
    let queue = this.queues.get(agentId)
    if (!queue) {
      queue = { agentId, messages: [], maxSize: MAX_QUEUE }
      this.queues.set(agentId, queue)
    }
    return queue
  }

  private saveHistory(): void {
    try {
      writeFileSync(join(STORE_DIR, 'history.json'), JSON.stringify(this.history.slice(-MAX_HISTORY), null, 2))
    } catch { /* ignore */ }
  }

  private loadHistory(): void {
    const p = join(STORE_DIR, 'history.json')
    if (!existsSync(p)) return
    try {
      this.history = JSON.parse(readFileSync(p, 'utf8'))
    } catch { /* skip corrupt */ }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: MessageBus | null = null
export function getMessageBus(): MessageBus {
  if (!_instance) _instance = new MessageBus()
  return _instance
}
