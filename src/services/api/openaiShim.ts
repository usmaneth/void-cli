/**
 * OpenAI-compatible API shim for OpenRouter and similar providers.
 *
 * Translates between Anthropic Messages API format (used by the codebase)
 * and OpenAI Chat Completions format (used by OpenRouter for non-Claude models).
 *
 * This enables using any model on OpenRouter (GPT-4o, GLM-5, Llama, Gemini, etc.)
 * through the existing Anthropic SDK interface without changing downstream code.
 */

import { getProxyFetchOptions } from 'src/utils/proxy.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: string }
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  index?: number
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

interface OpenAIStreamChunk {
  id: string
  object: string
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ── Conversion: Anthropic → OpenAI ───────────────────────────────────────────

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

function convertAnthropicMessages(
  messages: any[],
  system: string,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = []

  if (system) {
    result.push({ role: 'system', content: system })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        const parts: OpenAIContentPart[] = []
        const toolResults: Array<{ tool_call_id: string; content: string }> = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'image') {
            const src = block.source
            parts.push({
              type: 'image_url',
              image_url: {
                url:
                  src.type === 'url'
                    ? src.url
                    : `data:${src.media_type};base64,${src.data}`,
              },
            })
          } else if (block.type === 'tool_result') {
            // Tool results need to be sent as separate messages
            const content =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .filter((b: any) => b.type === 'text')
                      .map((b: any) => b.text)
                      .join('\n')
                  : ''
            toolResults.push({
              tool_call_id: block.tool_use_id,
              content: block.is_error ? `Error: ${content}` : content,
            })
          }
        }

        // Emit tool results first (they must follow the assistant's tool_calls)
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_call_id,
            content: tr.content,
          })
        }

        // Then emit user text/image content if any
        if (parts.length > 0) {
          result.push({
            role: 'user',
            content: parts.length === 1 && parts[0]!.type === 'text'
              ? parts[0]!.text!
              : parts,
          })
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        let textParts = ''
        const toolCalls: OpenAIToolCall[] = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts += block.text
          } else if (block.type === 'thinking') {
            // Wrap thinking in tags so it's preserved in conversation
            if (block.thinking) {
              textParts += `<thinking>${block.thinking}</thinking>\n`
            }
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments:
                  typeof block.input === 'string'
                    ? block.input
                    : JSON.stringify(block.input),
              },
            })
          }
        }

        const assistantMsg: OpenAIChatMessage = {
          role: 'assistant',
          content: textParts || null,
        }
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls
        }
        result.push(assistantMsg)
      }
    }
  }

  return result
}

function convertTools(tools: any[] | undefined): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools
    .filter(t => t.type !== 'server_tool_use') // Skip Anthropic-specific server tools
    .map(tool => {
      const schema = tool.input_schema || {}
      // OpenAI requires all properties in 'required' for strict mode
      const params: Record<string, unknown> = { ...schema }
      if (
        params.properties &&
        !params.required &&
        typeof params.properties === 'object'
      ) {
        params.required = Object.keys(params.properties as object)
      }

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: params,
        },
      }
    })
}

// ── Streaming: OpenAI SSE → Anthropic Events ─────────────────────────────────

interface AnthropicStreamEvent {
  type: string
  [key: string]: any
}

/**
 * Async iterable that consumes an OpenAI SSE stream and yields
 * Anthropic-format stream events.
 */
async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const msgId = `msg_${Date.now()}`
  let inputTokens = 0
  let outputTokens = 0

  // Emit message_start
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

  let currentBlockIndex = -1
  let currentBlockType: 'text' | 'tool_use' | null = null
  let hasEmittedTextBlock = false

  // Track tool calls by index
  const toolCallState: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map()

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        let chunk: OpenAIStreamChunk
        try {
          chunk = JSON.parse(trimmed.slice(6))
        } catch {
          continue
        }

        // Update usage if provided
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
        }

        for (const choice of chunk.choices) {
          const delta = choice.delta

          // Handle text content
          if (delta.content) {
            if (!hasEmittedTextBlock) {
              currentBlockIndex++
              currentBlockType = 'text'
              hasEmittedTextBlock = true
              yield {
                type: 'content_block_start',
                index: currentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
            }
            yield {
              type: 'content_block_delta',
              index: currentBlockIndex,
              delta: { type: 'text_delta', text: delta.content },
            }
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const tcIndex = tc.index ?? 0
              let state = toolCallState.get(tcIndex)

              if (tc.id && tc.function?.name) {
                // New tool call starting — close text block if open
                if (hasEmittedTextBlock && currentBlockType === 'text') {
                  yield {
                    type: 'content_block_stop',
                    index: currentBlockIndex,
                  }
                  currentBlockType = null
                }

                currentBlockIndex++
                state = {
                  id: tc.id,
                  name: tc.function.name,
                  arguments: tc.function.arguments || '',
                }
                toolCallState.set(tcIndex, state)

                yield {
                  type: 'content_block_start',
                  index: currentBlockIndex,
                  content_block: {
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.function.name,
                    input: {},
                  },
                }
                currentBlockType = 'tool_use'
              } else if (tc.function?.arguments && state) {
                // Continuation of tool call arguments
                state.arguments += tc.function.arguments
                yield {
                  type: 'content_block_delta',
                  index: currentBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            }
          }

          // Handle finish
          if (choice.finish_reason) {
            // Close any open block
            if (currentBlockType !== null) {
              yield {
                type: 'content_block_stop',
                index: currentBlockIndex,
              }
            }

            const stopReason =
              choice.finish_reason === 'tool_calls'
                ? 'tool_use'
                : choice.finish_reason === 'length'
                  ? 'max_tokens'
                  : 'end_turn'

            yield {
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: { output_tokens: outputTokens },
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Emit message_stop
  yield { type: 'message_stop' }
}

// ── Non-streaming: OpenAI response → Anthropic BetaMessage ───────────────────

function convertOpenAIResponseToMessage(json: any, model: string): any {
  const choice = json.choices?.[0]
  if (!choice) {
    throw new Error('No choices in OpenRouter response')
  }

  const content: any[] = []
  const msg = choice.message

  if (msg.content) {
    content.push({ type: 'text', text: msg.content })
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let input: any = {}
      try {
        input = JSON.parse(tc.function.arguments)
      } catch {
        input = {}
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      })
    }
  }

  const stopReason =
    choice.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice.finish_reason === 'length'
        ? 'max_tokens'
        : 'end_turn'

  return {
    id: json.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: json.usage?.prompt_tokens || 0,
      output_tokens: json.usage?.completion_tokens || 0,
    },
  }
}

// ── Shim Client ──────────────────────────────────────────────────────────────

/**
 * Creates a shim that implements enough of the Anthropic client interface
 * to work with the existing codebase, but translates all calls to the
 * OpenAI Chat Completions API.
 */
export function createOpenAIShimClient(config: {
  apiKey: string
  baseURL: string
  defaultHeaders?: Record<string, string>
  timeout?: number
}): any {
  const { apiKey, baseURL, defaultHeaders = {}, timeout = 600_000 } = config

  async function createMessageStream(
    params: any,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<any> {
    const isStreaming = params.stream !== false
    const system = convertSystemPrompt(params.system)
    const messages = convertAnthropicMessages(params.messages, system)
    const tools = convertTools(params.tools)

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      ...(isStreaming && { stream: true, stream_options: { include_usage: true } }),
    }

    if (params.max_tokens) {
      body.max_completion_tokens = params.max_tokens
    }

    if (tools && tools.length > 0) {
      body.tools = tools
      // Let the model decide when to use tools
      if (params.tool_choice) {
        if (params.tool_choice.type === 'auto') {
          body.tool_choice = 'auto'
        } else if (params.tool_choice.type === 'any') {
          body.tool_choice = 'required'
        } else if (params.tool_choice.type === 'tool') {
          body.tool_choice = {
            type: 'function',
            function: { name: params.tool_choice.name },
          }
        }
      }
    }

    // Temperature
    if (params.temperature !== undefined) {
      body.temperature = params.temperature
    }

    // Top-p
    if (params.top_p !== undefined) {
      body.top_p = params.top_p
    }

    const url = `${baseURL}/chat/completions`
    const fetchOptions = getProxyFetchOptions({ forAnthropicAPI: false }) as Record<string, unknown>

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...defaultHeaders,
        ...(options?.headers || {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal
        ? AbortSignal.any([
            options.signal,
            AbortSignal.timeout(timeout),
          ])
        : AbortSignal.timeout(timeout),
      ...fetchOptions,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error')
      const error = new Error(
        `OpenRouter API error ${response.status}: ${errorBody}`,
      )
      ;(error as any).status = response.status
      throw error
    }

    // Non-streaming: convert OpenAI response to Anthropic BetaMessage format
    if (!isStreaming) {
      const json = await response.json() as any
      return { result: convertOpenAIResponseToMessage(json, params.model), response }
    }

    // Streaming: create an async iterable that yields Anthropic-format events
    const eventStream = openaiStreamToAnthropic(response, params.model)

    // Wrap in an object that mimics the Anthropic SDK stream interface
    const stream = {
      [Symbol.asyncIterator]() {
        return eventStream
      },
      controller: new AbortController(),
    }

    return { stream, response }
  }

  /**
   * Creates an APIPromise-like object that mimics the Anthropic SDK's return type.
   * The Anthropic SDK's .create() returns an object where:
   * - await it → gets the stream directly
   * - .withResponse() → gets { data: stream, response, request_id }
   */
  function createAPIPromise(
    params: any,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): any {
    const innerPromise = createMessageStream(params, options)

    // Resolve to the primary data: stream for streaming, message for non-streaming
    function getData(r: any) {
      return r.stream || r.result
    }

    // Build a thenable that also has .withResponse()
    const apiPromise = {
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
            r.response.headers.get('x-request-id') || `or_${Date.now()}`,
        }))
      },
    }

    return apiPromise
  }

  // Build the shim client that looks like an Anthropic SDK client
  const shimClient = {
    beta: {
      messages: {
        create: createAPIPromise,
      },
    },
    messages: {
      create: createAPIPromise,
    },
  }

  return shimClient
}
