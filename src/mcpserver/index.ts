/**
 * MCP Server Mode — transforms void into a controllable backend via JSON-RPC 2.0
 * over stdio (line-delimited JSON).
 *
 * Protocol: each message is a single JSON object terminated by a newline.
 * Reads from process.stdin, writes to process.stdout.
 */

import { createInterface, type Interface as ReadlineInterface } from 'readline'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  method: string
  params?: any
  id: number | string
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: any
}

export type JsonRpcError = {
  code: number
  message: string
  data?: any
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  result?: any
  error?: JsonRpcError
  id: number | string | null
}

// ---------------------------------------------------------------------------
// Standard JSON-RPC 2.0 error codes
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

type SessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

type Session = {
  id: string
  description: string
  messages: SessionMessage[]
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Server stats
// ---------------------------------------------------------------------------

type ServerStats = {
  startedAt: string
  requestsHandled: number
  errorsCount: number
}

// ---------------------------------------------------------------------------
// Method handler type
// ---------------------------------------------------------------------------

type MethodHandler = (params: any, id: number | string) => Promise<JsonRpcResponse>

// ---------------------------------------------------------------------------
// McpServer
// ---------------------------------------------------------------------------

export class McpServer {
  private sessions: Map<string, Session> = new Map()
  private rl: ReadlineInterface | null = null
  private running = false
  private stats: ServerStats = {
    startedAt: '',
    requestsHandled: 0,
    errorsCount: 0,
  }
  private methods: Map<string, MethodHandler> = new Map()
  private currentTurnAbort: AbortController | null = null

  constructor() {
    this.registerMethods()
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get isRunning(): boolean {
    return this.running
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  get serverStats(): Readonly<ServerStats> {
    return { ...this.stats }
  }

  /**
   * Begin listening on stdin, writing responses to stdout.
   * Resolves when the server stops (via shutdown or stop()).
   */
  start(): Promise<void> {
    if (this.running) {
      return Promise.resolve()
    }

    this.running = true
    this.stats.startedAt = new Date().toISOString()
    this.stats.requestsHandled = 0
    this.stats.errorsCount = 0

    return new Promise<void>((resolve) => {
      this.rl = createInterface({
        input: process.stdin,
        terminal: false,
      })

      this.rl.on('line', (line: string) => {
        void this.processLine(line)
      })

      this.rl.on('close', () => {
        this.running = false
        this.rl = null
        resolve()
      })
    })
  }

  /**
   * Graceful shutdown — close the readline interface and clean up sessions.
   */
  stop(): void {
    if (!this.running) {
      return
    }

    this.running = false

    // Abort any in-progress turn
    if (this.currentTurnAbort) {
      this.currentTurnAbort.abort()
      this.currentTurnAbort = null
    }

    if (this.rl) {
      this.rl.close()
      this.rl = null
    }

    this.sessions.clear()
  }

  /**
   * Dispatch an incoming JSON-RPC request to its handler.
   */
  async handleMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse> {
    this.stats.requestsHandled++

    // Validate jsonrpc version
    if (msg.jsonrpc !== '2.0') {
      this.stats.errorsCount++
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Invalid JSON-RPC version. Expected "2.0".',
        },
        id: msg.id ?? null,
      }
    }

    // Validate method field
    if (typeof msg.method !== 'string' || msg.method.length === 0) {
      this.stats.errorsCount++
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Missing or invalid "method" field.',
        },
        id: msg.id ?? null,
      }
    }

    const handler = this.methods.get(msg.method)
    if (!handler) {
      this.stats.errorsCount++
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.METHOD_NOT_FOUND,
          message: `Method "${msg.method}" not found.`,
        },
        id: msg.id,
      }
    }

    try {
      return await handler(msg.params, msg.id)
    } catch (err) {
      this.stats.errorsCount++
      const message = err instanceof Error ? err.message : String(err)
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Internal error: ${message}`,
        },
        id: msg.id,
      }
    }
  }

  /**
   * Write a JSON-RPC response to stdout (line-delimited).
   */
  sendResponse(response: JsonRpcResponse): void {
    const line = JSON.stringify(response)
    process.stdout.write(line + '\n')
  }

  /**
   * Send a server-initiated notification (no id, no response expected).
   */
  sendNotification(method: string, params?: any): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    }
    const line = JSON.stringify(notification)
    process.stdout.write(line + '\n')
  }

  /**
   * Return the list of registered method names.
   */
  getMethodNames(): string[] {
    return Array.from(this.methods.keys()).sort()
  }

  // -------------------------------------------------------------------------
  // Internal: line processing
  // -------------------------------------------------------------------------

  private async processLine(line: string): Promise<void> {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      return
    }

    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      this.stats.errorsCount++
      this.sendResponse({
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.PARSE_ERROR,
          message: 'Parse error: invalid JSON.',
        },
        id: null,
      })
      return
    }

    // Validate minimal structure
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.stats.errorsCount++
      this.sendResponse({
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Invalid request: expected a JSON object.',
        },
        id: null,
      })
      return
    }

    const response = await this.handleMessage(parsed as JsonRpcRequest)
    this.sendResponse(response)
  }

  // -------------------------------------------------------------------------
  // Method registration
  // -------------------------------------------------------------------------

  private registerMethods(): void {
    this.methods.set('session/start', this.handleSessionStart.bind(this))
    this.methods.set('session/list', this.handleSessionList.bind(this))
    this.methods.set('session/resume', this.handleSessionResume.bind(this))
    this.methods.set('turn/start', this.handleTurnStart.bind(this))
    this.methods.set('turn/interrupt', this.handleTurnInterrupt.bind(this))
    this.methods.set('config/read', this.handleConfigRead.bind(this))
    this.methods.set('config/write', this.handleConfigWrite.bind(this))
    this.methods.set('model/list', this.handleModelList.bind(this))
    this.methods.set('tools/list', this.handleToolsList.bind(this))
    this.methods.set('status', this.handleStatus.bind(this))
    this.methods.set('shutdown', this.handleShutdown.bind(this))
  }

  // -------------------------------------------------------------------------
  // Method handlers
  // -------------------------------------------------------------------------

  /**
   * session/start — create a new session.
   * Params: { description?: string }
   * Returns: { session_id, created_at }
   */
  private async handleSessionStart(
    params: { description?: string } | undefined,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    const sessionId = randomUUID()
    const now = new Date().toISOString()

    const session: Session = {
      id: sessionId,
      description: params?.description ?? '',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }

    this.sessions.set(sessionId, session)

    this.sendNotification('session/created', { session_id: sessionId })

    return {
      jsonrpc: '2.0',
      result: {
        session_id: sessionId,
        created_at: now,
      },
      id,
    }
  }

  /**
   * session/list — list active sessions.
   * Returns: { sessions: Array<{ session_id, description, message_count, created_at, updated_at }> }
   */
  private async handleSessionList(
    _params: any,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    const sessions = Array.from(this.sessions.values()).map((s) => ({
      session_id: s.id,
      description: s.description,
      message_count: s.messages.length,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }))

    return {
      jsonrpc: '2.0',
      result: { sessions },
      id,
    }
  }

  /**
   * session/resume — resume an existing session.
   * Params: { session_id: string }
   * Returns: { session_id, description, message_count, created_at, updated_at }
   */
  private async handleSessionResume(
    params: { session_id?: string } | undefined,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    if (!params?.session_id) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Missing required parameter: session_id',
        },
        id,
      }
    }

    const session = this.sessions.get(params.session_id)
    if (!session) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: `Session not found: ${params.session_id}`,
        },
        id,
      }
    }

    return {
      jsonrpc: '2.0',
      result: {
        session_id: session.id,
        description: session.description,
        message_count: session.messages.length,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      },
      id,
    }
  }

  /**
   * turn/start — send a user message and get a response.
   * Params: { session_id: string, message: string }
   * Returns: { response: string, tools_used: string[], tokens: number }
   */
  private async handleTurnStart(
    params: { session_id?: string; message?: string } | undefined,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    if (!params?.session_id) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Missing required parameter: session_id',
        },
        id,
      }
    }

    if (!params?.message || typeof params.message !== 'string') {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Missing required parameter: message',
        },
        id,
      }
    }

    const session = this.sessions.get(params.session_id)
    if (!session) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: `Session not found: ${params.session_id}`,
        },
        id,
      }
    }

    // Set up abort controller for this turn
    this.currentTurnAbort = new AbortController()
    const signal = this.currentTurnAbort.signal

    const now = new Date().toISOString()

    // Record user message
    session.messages.push({
      role: 'user',
      content: params.message,
      timestamp: now,
    })

    this.sendNotification('turn/progress', {
      session_id: params.session_id,
      status: 'processing',
    })

    // Check for abort before generating response
    if (signal.aborted) {
      this.currentTurnAbort = null
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: 'Turn was interrupted.',
        },
        id,
      }
    }

    // Generate a response.
    // In a full integration this would invoke the model via the assistant
    // pipeline. For now we produce a structured acknowledgement so the
    // protocol layer can be exercised end-to-end.
    const assistantContent = `Received: ${params.message}`
    const toolsUsed: string[] = []
    const tokens = params.message.length // placeholder metric

    // Record assistant message
    session.messages.push({
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString(),
    })

    session.updatedAt = new Date().toISOString()
    this.currentTurnAbort = null

    this.sendNotification('turn/progress', {
      session_id: params.session_id,
      status: 'complete',
    })

    return {
      jsonrpc: '2.0',
      result: {
        response: assistantContent,
        tools_used: toolsUsed,
        tokens,
      },
      id,
    }
  }

  /**
   * turn/interrupt — cancel the current generation.
   * Params: { session_id: string }
   * Returns: { status: 'interrupted' | 'no_active_turn' }
   */
  private async handleTurnInterrupt(
    params: { session_id?: string } | undefined,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    if (!params?.session_id) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Missing required parameter: session_id',
        },
        id,
      }
    }

    if (!this.sessions.has(params.session_id)) {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: `Session not found: ${params.session_id}`,
        },
        id,
      }
    }

    if (this.currentTurnAbort) {
      this.currentTurnAbort.abort()
      this.currentTurnAbort = null
      return {
        jsonrpc: '2.0',
        result: { status: 'interrupted' },
        id,
      }
    }

    return {
      jsonrpc: '2.0',
      result: { status: 'no_active_turn' },
      id,
    }
  }

  /**
   * config/read — read current configuration values.
   * Returns: { config: Record<string, any> }
   */
  private async handleConfigRead(
    _params: any,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    // Return server-relevant configuration. In a full integration this would
    // read from the void settings system.
    return {
      jsonrpc: '2.0',
      result: {
        config: {
          server_mode: 'mcp',
          protocol: 'json-rpc-2.0',
          transport: 'stdio',
          sessions_active: this.sessions.size,
        },
      },
      id,
    }
  }

  /**
   * config/write — update a config value.
   * Params: { key: string, value: any }
   * Returns: { status: 'ok', key, value }
   */
  private async handleConfigWrite(
    params: { key?: string; value?: any } | undefined,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    if (!params?.key || typeof params.key !== 'string') {
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Missing required parameter: key',
        },
        id,
      }
    }

    // In a full integration this would persist the value via the settings
    // system. For now we acknowledge the write without persisting.
    return {
      jsonrpc: '2.0',
      result: {
        status: 'ok',
        key: params.key,
        value: params.value,
      },
      id,
    }
  }

  /**
   * model/list — list available models.
   * Returns: { models: Array<{ id, name, provider }> }
   */
  private async handleModelList(
    _params: any,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    // Placeholder model list. A full integration would query the model
    // registry from the void configuration.
    const models = [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic' },
      { id: 'claude-haiku-3-5-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
    ]

    return {
      jsonrpc: '2.0',
      result: { models },
      id,
    }
  }

  /**
   * tools/list — list available tools.
   * Returns: { tools: Array<{ name, description }> }
   */
  private async handleToolsList(
    _params: any,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    // Placeholder tool list. A full integration would enumerate the
    // registered tools from the tool registry.
    const tools = [
      { name: 'bash', description: 'Execute a bash command' },
      { name: 'read', description: 'Read a file' },
      { name: 'write', description: 'Write a file' },
      { name: 'edit', description: 'Edit a file' },
      { name: 'glob', description: 'Search for files by pattern' },
      { name: 'grep', description: 'Search file contents' },
    ]

    return {
      jsonrpc: '2.0',
      result: { tools },
      id,
    }
  }

  /**
   * status — server health check.
   * Returns: { status, uptime_ms, sessions, requests_handled, errors }
   */
  private async handleStatus(
    _params: any,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    const uptimeMs = this.stats.startedAt
      ? Date.now() - new Date(this.stats.startedAt).getTime()
      : 0

    return {
      jsonrpc: '2.0',
      result: {
        status: 'ok',
        uptime_ms: uptimeMs,
        sessions: this.sessions.size,
        requests_handled: this.stats.requestsHandled,
        errors: this.stats.errorsCount,
      },
      id,
    }
  }

  /**
   * shutdown — graceful shutdown.
   * Returns: { status: 'ok' } then stops the server.
   */
  private async handleShutdown(
    _params: any,
    id: number | string,
  ): Promise<JsonRpcResponse> {
    // Send response first, then schedule stop
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      result: { status: 'ok' },
      id,
    }

    // Schedule stop on next tick so the response is sent first
    process.nextTick(() => {
      this.stop()
    })

    return response
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let instance: McpServer | null = null

/**
 * Return the singleton McpServer instance, creating it on first access.
 */
export function getMcpServer(): McpServer {
  if (!instance) {
    instance = new McpServer()
  }
  return instance
}
