/**
 * OpenAI Responses API shim for ChatGPT-subscription auth.
 *
 * Translates Anthropic Messages API requests/events to/from OpenAI's Responses
 * API (/responses), which is what chatgpt.com/backend-api speaks — NOT the
 * Chat Completions API (/v1/chat/completions) that openaiShim.ts targets.
 *
 * Reference:
 * - codex-rs/core/src/client.rs::build_responses_request
 * - codex-rs/codex-api/src/sse/responses.rs::process_responses_event
 * - codex-rs/codex-api/src/common.rs::ResponsesApiRequest
 * - codex-rs/protocol/src/models.rs::ResponseItem / ContentItem
 *
 * All work is gated behind feature('CHATGPT_SUBSCRIPTION_AUTH'). The caller is
 * responsible for checking the flag before using this shim.
 */

import { getProxyFetchOptions } from 'src/utils/proxy.js'

// ── Responses API payload types ──────────────────────────────────────────────

/**
 * Mirrors codex-rs/protocol/src/models.rs::ResponseItem. We only emit the
 * variants we need for Anthropic Messages translation: Message, FunctionCall,
 * FunctionCallOutput. Reasoning is read-only (parsed from server stream).
 */
type ResponseItem =
  | {
      type: 'message'
      role: 'user' | 'assistant' | 'system' | 'developer'
      content: ContentItem[]
    }
  | {
      type: 'function_call'
      name: string
      arguments: string
      call_id: string
    }
  | {
      type: 'function_call_output'
      call_id: string
      output: string
    }

type ContentItem =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' }
  | { type: 'output_text'; text: string }

interface ResponsesApiRequestBody {
  model: string
  instructions?: string
  input: ResponseItem[]
  tools: unknown[]
  tool_choice?: string | { type: 'function'; name: string }
  parallel_tool_calls?: boolean
  stream: boolean
  store: boolean
  include: string[]
  reasoning?: { effort?: string; summary?: string }
  service_tier?: string
  prompt_cache_key?: string
  text?: { verbosity?: string; format?: unknown }
  metadata?: Record<string, string>
}

// ── Anthropic → Responses API translation ────────────────────────────────────

function convertSystemPrompt(
  system: string | Array<{ type: string; text: string }> | undefined,
): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
}

/**
 * Translate an Anthropic messages array into a flat list of Responses API
 * input items. Each Anthropic message may expand into multiple ResponseItems:
 * - user message with tool_result blocks → function_call_output item(s) plus
 *   an optional message item for any remaining text/image blocks
 * - assistant message with tool_use blocks → message item (for text) plus
 *   function_call item(s)
 */
function convertMessages(messages: any[]): ResponseItem[] {
  const out: ResponseItem[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        out.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: msg.content }],
        })
        continue
      }
      if (!Array.isArray(msg.content)) continue

      const parts: ContentItem[] = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push({ type: 'input_text', text: block.text })
        } else if (block.type === 'image') {
          const src = block.source
          const url =
            src?.type === 'url'
              ? src.url
              : `data:${src?.media_type};base64,${src?.data}`
          parts.push({ type: 'input_image', image_url: url, detail: 'auto' })
        } else if (block.type === 'tool_result') {
          const content =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text)
                    .join('\n')
                : ''
          out.push({
            type: 'function_call_output',
            call_id: block.tool_use_id,
            output: block.is_error ? `Error: ${content}` : content,
          })
        }
      }

      if (parts.length > 0) {
        out.push({ type: 'message', role: 'user', content: parts })
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        out.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.content }],
        })
        continue
      }
      if (!Array.isArray(msg.content)) continue

      let textBuf = ''
      const functionCalls: Array<{ id: string; name: string; arguments: string }> = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          textBuf += block.text
        } else if (block.type === 'thinking') {
          // Responses API has its own reasoning items; we don't replay cached
          // thinking through `input` since the server persists reasoning state
          // keyed on prompt_cache_key. Preserve as wrapper text for debuggability.
          if (block.thinking) textBuf += `<thinking>${block.thinking}</thinking>\n`
        } else if (block.type === 'tool_use') {
          functionCalls.push({
            id: block.id,
            name: block.name,
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          })
        }
      }

      if (textBuf) {
        out.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: textBuf }],
        })
      }
      for (const fc of functionCalls) {
        out.push({
          type: 'function_call',
          name: fc.name,
          arguments: fc.arguments,
          call_id: fc.id,
        })
      }
    }
  }

  return out
}

/**
 * Translate Anthropic tools → Responses API tools. The Responses API uses a flat
 * `{type:'function', name, description, parameters}` shape (no nested `function:`
 * wrapper like Chat Completions).
 */
function convertTools(tools: any[] | undefined): unknown[] {
  if (!tools || tools.length === 0) return []
  return tools
    .filter(t => t.type !== 'server_tool_use')
    .map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    }))
}

function convertToolChoice(
  choice: any,
): ResponsesApiRequestBody['tool_choice'] | undefined {
  if (!choice) return undefined
  if (choice.type === 'auto') return 'auto'
  if (choice.type === 'any') return 'required'
  if (choice.type === 'tool') return { type: 'function', name: choice.name }
  return undefined
}

// ── Streaming: Responses SSE → Anthropic events ──────────────────────────────

interface AnthropicStreamEvent {
  type: string
  [key: string]: any
}

interface ToolCallState {
  id: string
  name: string
  callId: string
  blockIndex: number
}

/**
 * Parse the Responses API SSE stream and yield Anthropic-format events.
 *
 * Responses API events we translate:
 * - response.created → emit message_start
 * - response.output_item.added (type=message) → content_block_start(text)
 * - response.output_text.delta → content_block_delta(text_delta)
 * - response.output_item.added (type=function_call) → content_block_start(tool_use)
 * - response.function_call_arguments.delta → content_block_delta(input_json_delta)
 * - response.output_item.done → content_block_stop
 * - response.completed → message_delta + message_stop
 * - response.failed → throw
 */
async function* responsesStreamToAnthropic(
  response: Response,
  model: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const msgId = `msg_${Date.now()}`
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string = 'end_turn'

  yield {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }

  let blockCounter = -1
  // itemId → block index for Responses API (text message is typically one item,
  // each function_call is a separate item).
  const itemIdToBlock: Map<string, { index: number; kind: 'text' | 'tool_use' }> = new Map()
  // output_index fallback when item_id is absent.
  const outputIndexToBlock: Map<number, { index: number; kind: 'text' | 'tool_use' }> = new Map()
  const toolCalls: Map<string, ToolCallState> = new Map()

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const getBlockForEvent = (
    evt: any,
  ): { index: number; kind: 'text' | 'tool_use' } | undefined => {
    if (evt.item_id && itemIdToBlock.has(evt.item_id)) {
      return itemIdToBlock.get(evt.item_id)
    }
    if (typeof evt.output_index === 'number' && outputIndexToBlock.has(evt.output_index)) {
      return outputIndexToBlock.get(evt.output_index)
    }
    return undefined
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames separated by blank line
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const trimmed = frame.trim()
        if (!trimmed) continue
        // Each frame may have "event: X\ndata: Y" or just "data: Y"
        let dataLine = ''
        for (const line of trimmed.split('\n')) {
          if (line.startsWith('data: ')) dataLine += line.slice(6)
          else if (line.startsWith('data:')) dataLine += line.slice(5).trimStart()
        }
        if (!dataLine || dataLine === '[DONE]') continue

        let evt: any
        try {
          evt = JSON.parse(dataLine)
        } catch {
          continue
        }

        const kind = evt.type as string | undefined
        if (!kind) continue

        switch (kind) {
          case 'response.created':
            // No-op — we already emitted message_start.
            break

          case 'response.output_item.added': {
            const item = evt.item ?? {}
            const itemType = item.type
            if (itemType === 'message') {
              blockCounter++
              const entry = { index: blockCounter, kind: 'text' as const }
              if (item.id) itemIdToBlock.set(item.id, entry)
              if (typeof evt.output_index === 'number') {
                outputIndexToBlock.set(evt.output_index, entry)
              }
              yield {
                type: 'content_block_start',
                index: blockCounter,
                content_block: { type: 'text', text: '' },
              }
            } else if (itemType === 'function_call') {
              blockCounter++
              const entry = { index: blockCounter, kind: 'tool_use' as const }
              if (item.id) itemIdToBlock.set(item.id, entry)
              if (typeof evt.output_index === 'number') {
                outputIndexToBlock.set(evt.output_index, entry)
              }
              const toolId = item.call_id || item.id || `call_${blockCounter}`
              toolCalls.set(toolId, {
                id: toolId,
                name: item.name ?? '',
                callId: item.call_id ?? toolId,
                blockIndex: blockCounter,
              })
              yield {
                type: 'content_block_start',
                index: blockCounter,
                content_block: {
                  type: 'tool_use',
                  id: toolId,
                  name: item.name ?? '',
                  input: {},
                },
              }
            } else if (itemType === 'reasoning') {
              // Reasoning items: we silently swallow them. They don't map onto
              // an Anthropic thinking block cleanly because the Responses API
              // emits encrypted reasoning tokens the client shouldn't surface.
              // We still need to track the item_id so subsequent reasoning_text
              // deltas for this item are ignored without errors.
              if (item.id) {
                itemIdToBlock.set(item.id, { index: -1, kind: 'text' })
              }
            }
            break
          }

          case 'response.output_text.delta': {
            const delta = evt.delta
            if (typeof delta !== 'string') break
            const block = getBlockForEvent(evt)
            if (!block || block.kind !== 'text' || block.index < 0) break
            yield {
              type: 'content_block_delta',
              index: block.index,
              delta: { type: 'text_delta', text: delta },
            }
            break
          }

          case 'response.function_call_arguments.delta': {
            const delta = evt.delta
            if (typeof delta !== 'string') break
            const block = getBlockForEvent(evt)
            if (!block || block.kind !== 'tool_use') break
            yield {
              type: 'content_block_delta',
              index: block.index,
              delta: { type: 'input_json_delta', partial_json: delta },
            }
            break
          }

          case 'response.output_item.done': {
            const block = getBlockForEvent(evt)
            if (block && block.index >= 0) {
              yield { type: 'content_block_stop', index: block.index }
            }
            break
          }

          case 'response.completed': {
            const usage = evt.response?.usage
            if (usage) {
              inputTokens = usage.input_tokens ?? inputTokens
              outputTokens = usage.output_tokens ?? outputTokens
            }
            if (toolCalls.size > 0) stopReason = 'tool_use'
            yield {
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            }
            yield { type: 'message_stop' }
            return
          }

          case 'response.incomplete': {
            const reason =
              evt.response?.incomplete_details?.reason ?? 'incomplete'
            const mapped = reason === 'max_output_tokens' ? 'max_tokens' : 'end_turn'
            yield {
              type: 'message_delta',
              delta: { stop_reason: mapped, stop_sequence: null },
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            }
            yield { type: 'message_stop' }
            return
          }

          case 'response.failed': {
            const errMsg =
              evt.response?.error?.message ?? 'response.failed event received'
            throw new Error(`Responses API error: ${errMsg}`)
          }

          // Everything else (reasoning_summary_*, reasoning_text_*, metadata,
          // etc.) is intentionally ignored.
          default:
            break
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  // Stream ended without response.completed — best-effort flush.
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
  yield { type: 'message_stop' }
}

// ── Non-streaming: Responses API response → Anthropic message ────────────────

function convertResponsesToMessage(json: any, model: string): any {
  const content: any[] = []
  const outputs: any[] = Array.isArray(json.output) ? json.output : []
  let sawToolCall = false

  for (const item of outputs) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) {
        if (c.type === 'output_text' && c.text) {
          content.push({ type: 'text', text: c.text })
        }
      }
    } else if (item.type === 'function_call') {
      sawToolCall = true
      let input: any = {}
      try {
        input = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
      } catch {
        input = {}
      }
      content.push({
        type: 'tool_use',
        id: item.call_id ?? item.id,
        name: item.name,
        input,
      })
    }
  }

  const stopReason = sawToolCall
    ? 'tool_use'
    : json.status === 'incomplete'
      ? 'max_tokens'
      : 'end_turn'

  return {
    id: json.id ?? `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: json.usage?.input_tokens ?? 0,
      output_tokens: json.usage?.output_tokens ?? 0,
    },
  }
}

// ── Shim client ──────────────────────────────────────────────────────────────

export interface ResponsesApiShimConfig {
  /** Returns a fresh access_token each call; the shim calls this before each request so refreshes happen transparently. */
  getAccessToken: () => Promise<string>
  /** ChatGPT workspace/account id — required by chatgpt.com/backend-api. */
  getAccountId?: () => Promise<string | undefined>
  /** Base URL for the Responses API — defaults to https://chatgpt.com/backend-api. */
  baseURL?: string
  /** Extra headers to include on every request. */
  defaultHeaders?: Record<string, string>
  /** Timeout in ms for a full streamed response. Defaults to 10 minutes. */
  timeout?: number
  /** Conversation id for prompt caching (optional but recommended). */
  conversationId?: string
}

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api'
const DEFAULT_TIMEOUT_MS = 10 * 60_000

/**
 * Build a shim that mimics the Anthropic SDK's `client.messages.create(...)` surface
 * but routes to OpenAI's Responses API at `{baseURL}/responses`.
 */
export function createResponsesApiShimClient(config: ResponsesApiShimConfig): any {
  const {
    getAccessToken,
    getAccountId,
    baseURL = DEFAULT_BASE_URL,
    defaultHeaders = {},
    timeout = DEFAULT_TIMEOUT_MS,
    conversationId,
  } = config

  async function createMessageStream(
    params: any,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<any> {
    const isStreaming = params.stream !== false
    const instructions = convertSystemPrompt(params.system)
    const input = convertMessages(params.messages ?? [])
    const tools = convertTools(params.tools)
    const toolChoice = convertToolChoice(params.tool_choice)

    const body: ResponsesApiRequestBody = {
      model: params.model,
      instructions: instructions || undefined,
      input,
      tools,
      parallel_tool_calls: params.parallel_tool_calls ?? true,
      stream: isStreaming,
      // `store:false` mirrors Codex's default when not running against Azure.
      // The ChatGPT backend persists responses server-side regardless via
      // prompt_cache_key; we don't opt into the public-API store semantics.
      store: false,
      include: [],
    }

    if (toolChoice) body.tool_choice = toolChoice
    if (conversationId) body.prompt_cache_key = conversationId

    // Anthropic `max_tokens` has no direct equivalent in the Responses API —
    // it caps output via `max_output_tokens`. We forward it when set.
    if (typeof params.max_tokens === 'number') {
      ;(body as any).max_output_tokens = params.max_tokens
    }
    if (params.temperature !== undefined) (body as any).temperature = params.temperature
    if (params.top_p !== undefined) (body as any).top_p = params.top_p

    const accessToken = await getAccessToken()
    const accountId = getAccountId ? await getAccountId() : undefined

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: isStreaming ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'OpenAI-Beta': 'responses=v1',
      ...defaultHeaders,
      ...(options?.headers ?? {}),
    }
    if (accountId) headers['chatgpt-account-id'] = accountId
    if (conversationId) headers['x-client-request-id'] = conversationId

    const url = `${baseURL.replace(/\/$/, '')}/responses`
    const fetchOptions = getProxyFetchOptions({ forAnthropicAPI: false }) as Record<string, unknown>

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
      ...fetchOptions,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error')
      const error = new Error(`Responses API error ${response.status}: ${errorBody}`)
      ;(error as any).status = response.status
      throw error
    }

    if (!isStreaming) {
      const json = (await response.json()) as any
      return { result: convertResponsesToMessage(json, params.model), response }
    }

    const eventStream = responsesStreamToAnthropic(response, params.model)
    const stream = {
      [Symbol.asyncIterator]() {
        return eventStream
      },
      controller: new AbortController(),
    }
    return { stream, response }
  }

  function createAPIPromise(
    params: any,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): any {
    const innerPromise = createMessageStream(params, options)

    function getData(r: any) {
      return r.stream || r.result
    }

    return {
      then(onFulfilled: any, onRejected?: any) {
        return innerPromise.then(r => getData(r)).then(onFulfilled, onRejected)
      },
      catch(onRejected: any) {
        return innerPromise.then(r => getData(r)).catch(onRejected)
      },
      finally(onFinally: any) {
        return innerPromise.then(r => getData(r)).finally(onFinally)
      },
      withResponse() {
        return innerPromise.then(r => ({
          data: getData(r),
          response: r.response,
          request_id:
            r.response.headers.get('x-request-id') || `rsp_${Date.now()}`,
        }))
      },
    }
  }

  return {
    beta: { messages: { create: createAPIPromise } },
    messages: { create: createAPIPromise },
  }
}

// ── Exports for testing ──────────────────────────────────────────────────────

export const __internal = {
  convertMessages,
  convertTools,
  convertToolChoice,
  convertSystemPrompt,
  convertResponsesToMessage,
}
