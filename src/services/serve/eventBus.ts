/**
 * Session event bus for streaming part events to WebSocket subscribers.
 *
 * Reuses the pattern from PR #62 where messages and tool calls are broken
 * into incremental "parts" (text-delta, tool-start, tool-result, etc.).
 *
 * Any component writing into a session can call `publish(sessionId, event)`
 * and every subscribed WS connection (or test harness) receives it.
 */

export type PartEvent =
  | {
      type: 'message.part'
      sessionId: string
      messageId: string
      role: 'user' | 'assistant' | 'system'
      delta: string
      index: number
    }
  | {
      type: 'message.complete'
      sessionId: string
      messageId: string
      role: 'user' | 'assistant' | 'system'
      content: string
    }
  | {
      type: 'tool.part'
      sessionId: string
      toolCallId: string
      name: string
      phase: 'start' | 'input-delta' | 'result' | 'error'
      payload?: unknown
    }
  | {
      type: 'session.state'
      sessionId: string
      state: 'idle' | 'running' | 'completed' | 'error'
    }

type Listener = (event: PartEvent) => void

class EventBus {
  private listeners: Map<string, Set<Listener>> = new Map()
  private globalListeners: Set<Listener> = new Set()

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener)
    return () => this.globalListeners.delete(listener)
  }

  publish(event: PartEvent): void {
    const set = this.listeners.get(event.sessionId)
    if (set) {
      for (const fn of set) {
        try {
          fn(event)
        } catch {
          // listener failed — drop
        }
      }
    }
    for (const fn of this.globalListeners) {
      try {
        fn(event)
      } catch {
        // noop
      }
    }
  }

  subscriberCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0
  }

  clear(): void {
    this.listeners.clear()
    this.globalListeners.clear()
  }
}

let _instance: EventBus | null = null

export function getEventBus(): EventBus {
  if (!_instance) {
    _instance = new EventBus()
  }
  return _instance
}

export function resetEventBusForTesting(): void {
  _instance = new EventBus()
}
