/**
 * Adapter boundary between the HTTP server and Void's chat pipeline.
 *
 * The server doesn't construct the model pipeline itself — callers inject a
 * `ChatAdapter` when they instantiate {@link VoidServer}. This keeps the
 * server independently testable and avoids circular imports between the
 * server and the REPL/entrypoints.
 *
 * Default adapter is an echo implementation: useful for pairing/UI testing
 * before the real pipeline is wired up, and for environments (CI, preview)
 * that don't have API keys available.
 */

export interface ChatStreamEvent {
  type: 'text' | 'tool-call' | 'tool-result' | 'done' | 'error'
  /** Incremental text chunk (for type='text'). */
  delta?: string
  /** Tool metadata (for type='tool-call' | 'tool-result'). */
  tool?: { name: string; input?: string; output?: string }
  /** Error message (for type='error'). */
  message?: string
  /** Final usage stats (for type='done'). */
  usage?: { input: number; output: number }
}

export interface ChatAdapterRequest {
  message: string
  sessionId: string
  model?: string
  cwd?: string
}

/**
 * Streams response events for a chat message. Adapters should yield at
 * least one `done` event at the end of a successful turn, or one `error`
 * event on failure.
 */
export type ChatAdapter = (
  req: ChatAdapterRequest,
) => AsyncIterable<ChatStreamEvent>

/**
 * Default echo adapter — returns the input as a streamed response, one
 * word at a time, with a synthetic delay so clients can verify incremental
 * rendering. Replace with a real pipeline adapter in production.
 */
export const echoChatAdapter: ChatAdapter = async function* (req) {
  const words = req.message.split(/(\s+)/)
  for (const w of words) {
    yield { type: 'text', delta: w }
    await new Promise((r) => setTimeout(r, 20))
  }
  yield {
    type: 'done',
    usage: { input: Math.ceil(req.message.length / 4), output: words.length },
  }
}
