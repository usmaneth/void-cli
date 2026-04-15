/**
 * Native Gemini API shim.
 *
 * Translates between Anthropic Messages API format (used by the codebase)
 * and Google's native Gemini REST API (generateContent / streamGenerateContent).
 *
 * Unlike the OpenAI-compatible shim, this talks directly to the Gemini API,
 * giving first-class support for thought_signature (required by Gemini 3+
 * thinking models for multi-turn function calling).
 */

import { getProxyFetchOptions } from 'src/utils/proxy.js'

// ── Gemini API Types ────────────────────────────────────────────────────────

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { id?: string; name: string; args: Record<string, unknown> }
  functionResponse?: {
    id?: string
    name: string
    response: Record<string, unknown>
  }
  thoughtSignature?: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  parametersJsonSchema?: Record<string, unknown>
}

interface GeminiRequest {
  contents: GeminiContent[]
  systemInstruction?: { parts: Array<{ text: string }> }
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE'
      allowedFunctionNames?: string[]
    }
  }
  generationConfig?: {
    temperature?: number
    topP?: number
    maxOutputTokens?: number
    stopSequences?: string[]
  }
}

interface GeminiCandidate {
  content?: { role: string; parts: GeminiPart[] }
  finishReason?: string
  index?: number
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  modelVersion?: string
  responseId?: string
}

// ── Anthropic Stream Event (subset we emit) ─────────────────────────────────

interface AnthropicStreamEvent {
  type: string
  [key: string]: any
}

// ── Conversion: Anthropic → Gemini ──────────────────────────────────────────

function convertSystemPrompt(
  system: string | Array<{ type: string; text: string }> | undefined,
): GeminiRequest['systemInstruction'] | undefined {
  if (!system) return undefined
  const text =
    typeof system === 'string'
      ? system
      : system
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n\n')
  if (!text) return undefined
  return { parts: [{ text }] }
}

/**
 * Convert Anthropic messages array to Gemini contents array.
 *
 * Key differences:
 * - Anthropic role 'assistant' → Gemini role 'model'
 * - Anthropic tool_use content blocks → Gemini functionCall parts
 * - Anthropic tool_result content blocks → Gemini functionResponse parts (in user turn)
 * - thought_signature: stored as extra_content on Anthropic side,
 *   mapped to thoughtSignature sibling on Gemini side
 */
function convertAnthropicToGemini(messages: any[]): GeminiContent[] {
  const result: GeminiContent[] = []

  // Track tool_use_id → { name, thoughtSignature } for resolving functionResponse
  const toolUseMap = new Map<string, { name: string; thoughtSignature?: string }>()

  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: GeminiPart[] = []

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text })
          } else if (block.type === 'image') {
            const src = block.source
            if (src.type === 'base64') {
              parts.push({
                inlineData: { mimeType: src.media_type, data: src.data },
              })
            }
            // URL images would need to be fetched — skip for now
          } else if (block.type === 'tool_result') {
            // Convert tool_result → functionResponse
            const toolInfo = toolUseMap.get(block.tool_use_id)
            const name = toolInfo?.name ?? block.tool_use_id

            // Extract text content from tool result
            let responseContent: string
            if (typeof block.content === 'string') {
              responseContent = block.is_error
                ? `Error: ${block.content}`
                : block.content
            } else if (Array.isArray(block.content)) {
              responseContent = block.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
              if (block.is_error) responseContent = `Error: ${responseContent}`
            } else {
              responseContent = ''
            }

            parts.push({
              functionResponse: {
                id: block.tool_use_id,
                name,
                response: { result: responseContent },
              },
            })
          }
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'user', parts })
      }
    } else if (msg.role === 'assistant') {
      const parts: GeminiPart[] = []

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text })
          } else if (block.type === 'thinking') {
            // Skip thinking blocks — Gemini handles thinking internally
          } else if (block.type === 'tool_use') {
            // Track for later tool_result resolution
            const thoughtSig = block.extra_content?.google?.thought_signature
            toolUseMap.set(block.id, {
              name: block.name,
              thoughtSignature: thoughtSig,
            })

            const part: GeminiPart = {
              functionCall: {
                id: block.id,
                name: block.name,
                args:
                  typeof block.input === 'string'
                    ? JSON.parse(block.input || '{}')
                    : block.input ?? {},
              },
            }

            // Preserve thought_signature as sibling of functionCall
            if (thoughtSig) {
              part.thoughtSignature = thoughtSig
            }

            parts.push(part)
          }
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'model', parts })
      }
    }
  }

  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeGeminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(item => sanitizeGeminiJsonSchema(item))
  }

  if (!isPlainObject(schema)) {
    return schema
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    switch (key) {
      case '$schema':
      case '$defs':
      case 'definitions':
      case 'propertyNames':
      case 'patternProperties':
      case 'exclusiveMinimum':
      case 'exclusiveMaximum':
      case 'oneOf':
      case 'allOf':
      case 'not':
      case 'if':
      case 'then':
      case 'else':
      case 'contains':
      case 'minContains':
      case 'maxContains':
      case 'unevaluatedProperties':
      case 'unevaluatedItems':
      case 'dependentRequired':
      case 'dependentSchemas':
      case 'readOnly':
      case 'writeOnly':
      case 'deprecated':
      case 'examples':
      case 'contentEncoding':
      case 'contentMediaType':
      case 'contentSchema':
        continue
      case 'properties':
        if (isPlainObject(value)) {
          sanitized.properties = Object.fromEntries(
            Object.entries(value).map(([propName, propSchema]) => [
              propName,
              sanitizeGeminiJsonSchema(propSchema),
            ]),
          )
        }
        continue
      case 'items':
      case 'additionalProperties':
        sanitized[key] = sanitizeGeminiJsonSchema(value)
        continue
      case 'anyOf':
      case 'prefixItems':
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item => sanitizeGeminiJsonSchema(item))
        }
        continue
      default:
        sanitized[key] = value
    }
  }

  return sanitized
}

function convertTools(
  tools: any[] | undefined,
): GeminiRequest['tools'] | undefined {
  if (!tools || tools.length === 0) return undefined

  const declarations: GeminiFunctionDeclaration[] = tools
    .filter(t => t.type !== 'server_tool_use')
    .map(tool => {
      const schema = tool.input_schema || {}
      return {
        name: tool.name,
        description: tool.description || '',
        parametersJsonSchema: sanitizeGeminiJsonSchema(schema) as Record<
          string,
          unknown
        >,
      }
    })

  return [{ functionDeclarations: declarations }]
}

function convertToolChoice(
  toolChoice: any | undefined,
): GeminiRequest['toolConfig'] | undefined {
  if (!toolChoice) return undefined

  if (toolChoice.type === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } }
  }
  if (toolChoice.type === 'any') {
    return { functionCallingConfig: { mode: 'ANY' } }
  }
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [toolChoice.name],
      },
    }
  }
  return undefined
}

// ── Conversion: Gemini → Anthropic ──────────────────────────────────────────

function mapFinishReason(
  reason: string | undefined,
  hasFunctionCalls: boolean,
): string {
  if (hasFunctionCalls) return 'tool_use'
  switch (reason) {
    case 'STOP':
      return 'end_turn'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER':
    case 'LANGUAGE':
    case 'MALFORMED_FUNCTION_CALL':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

/**
 * Convert a non-streaming Gemini response to an Anthropic BetaMessage.
 */
function convertGeminiResponseToMessage(
  gemini: GeminiResponse,
  model: string,
): any {
  const candidate = gemini.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const content: any[] = []
  let hasFunctionCalls = false

  for (const part of parts) {
    if (part.text !== undefined) {
      content.push({ type: 'text', text: part.text })
    }
    if (part.functionCall) {
      hasFunctionCalls = true
      const toolUse: any = {
        type: 'tool_use',
        id: part.functionCall.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      }
      // Preserve thought_signature in the format the codebase expects
      if (part.thoughtSignature) {
        toolUse.extra_content = {
          google: { thought_signature: part.thoughtSignature },
        }
      }
      content.push(toolUse)
    }
  }

  return {
    id: gemini.responseId || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: mapFinishReason(candidate?.finishReason, hasFunctionCalls),
    stop_sequence: null,
    usage: {
      input_tokens: gemini.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: gemini.usageMetadata?.candidatesTokenCount ?? 0,
    },
  }
}

// ── Streaming: Gemini SSE → Anthropic Events ────────────────────────────────

/**
 * Async iterable that consumes a Gemini SSE stream and yields
 * Anthropic-format stream events.
 *
 * Gemini streaming sends complete GenerateContentResponse chunks via SSE.
 * Each chunk may contain text fragments or complete functionCall parts.
 * We translate these into the Anthropic content_block_start / delta / stop
 * event sequence that void.ts expects.
 */
async function* geminiStreamToAnthropic(
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
  let textBlockOpen = false
  let hasFunctionCalls = false
  let finishReason: string | undefined

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
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        let chunk: GeminiResponse
        try {
          chunk = JSON.parse(trimmed.slice(6))
        } catch {
          continue
        }

        // Update usage if provided
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount ?? 0
          outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0
        }

        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) {
          finishReason = candidate.finishReason
        }

        const parts = candidate?.content?.parts
        if (!parts) continue

        for (const part of parts) {
          // Handle text parts
          if (part.text !== undefined) {
            if (!textBlockOpen) {
              currentBlockIndex++
              textBlockOpen = true
              yield {
                type: 'content_block_start',
                index: currentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
            }
            yield {
              type: 'content_block_delta',
              index: currentBlockIndex,
              delta: { type: 'text_delta', text: part.text },
            }
          }

          // Handle functionCall parts
          if (part.functionCall) {
            hasFunctionCalls = true

            // Close text block if open
            if (textBlockOpen) {
              yield {
                type: 'content_block_stop',
                index: currentBlockIndex,
              }
              textBlockOpen = false
            }

            currentBlockIndex++
            const callId =
              part.functionCall.id ||
              `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

            const contentBlock: any = {
              type: 'tool_use',
              id: callId,
              name: part.functionCall.name,
              input: {},
            }
            // Preserve thought_signature
            if (part.thoughtSignature) {
              contentBlock.extra_content = {
                google: { thought_signature: part.thoughtSignature },
              }
            }

            yield {
              type: 'content_block_start',
              index: currentBlockIndex,
              content_block: contentBlock,
            }

            // Emit the full arguments as a single input_json_delta
            const argsJson = JSON.stringify(part.functionCall.args ?? {})
            yield {
              type: 'content_block_delta',
              index: currentBlockIndex,
              delta: { type: 'input_json_delta', partial_json: argsJson },
            }

            // Close the tool_use block
            yield {
              type: 'content_block_stop',
              index: currentBlockIndex,
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Close any open text block
  if (textBlockOpen) {
    yield {
      type: 'content_block_stop',
      index: currentBlockIndex,
    }
  }

  // Emit message_delta with stop reason
  const stopReason = mapFinishReason(finishReason, hasFunctionCalls)
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }

  // Emit message_stop
  yield { type: 'message_stop' }
}

// ── Shim Client ─────────────────────────────────────────────────────────────

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Creates a shim that implements enough of the Anthropic client interface
 * to work with the existing codebase, but translates all calls to the
 * native Gemini generateContent / streamGenerateContent REST API.
 */
export function createGeminiShimClient(config: {
  apiKey: string
  baseURL?: string
  timeout?: number
  stripModelPrefix?: string
}): any {
  const {
    apiKey,
    baseURL = GEMINI_BASE_URL,
    timeout = 600_000,
    stripModelPrefix,
  } = config

  async function createMessageStream(
    params: any,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<any> {
    const isStreaming = params.stream !== false

    // Resolve model name (strip prefix like "google/")
    const resolvedModel =
      stripModelPrefix && params.model.startsWith(stripModelPrefix)
        ? params.model.slice(stripModelPrefix.length)
        : params.model

    // Build Gemini request body
    const body: GeminiRequest = {
      contents: convertAnthropicToGemini(params.messages),
    }

    const systemInstruction = convertSystemPrompt(params.system)
    if (systemInstruction) {
      body.systemInstruction = systemInstruction
    }

    const tools = convertTools(params.tools)
    if (tools) {
      body.tools = tools
    }

    const toolConfig = convertToolChoice(params.tool_choice)
    if (toolConfig) {
      body.toolConfig = toolConfig
    }

    // Generation config
    const genConfig: NonNullable<GeminiRequest['generationConfig']> = {}
    if (params.max_tokens) genConfig.maxOutputTokens = params.max_tokens
    if (params.temperature !== undefined)
      genConfig.temperature = params.temperature
    if (params.top_p !== undefined) genConfig.topP = params.top_p
    if (Object.keys(genConfig).length > 0) {
      body.generationConfig = genConfig
    }

    // Build URL
    const action = isStreaming ? 'streamGenerateContent' : 'generateContent'
    const queryParams = isStreaming
      ? `alt=sse&key=${apiKey}`
      : `key=${apiKey}`
    const url = `${baseURL}/models/${resolvedModel}:${action}?${queryParams}`

    const fetchOptions = getProxyFetchOptions({
      forAnthropicAPI: false,
    }) as Record<string, unknown>

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
      ...fetchOptions,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error')
      const error = new Error(
        `Gemini API error ${response.status}: ${errorBody}`,
      )
      ;(error as any).status = response.status
      throw error
    }

    // Non-streaming
    if (!isStreaming) {
      const json = (await response.json()) as GeminiResponse
      return {
        result: convertGeminiResponseToMessage(json, params.model),
        response,
      }
    }

    // Streaming
    const eventStream = geminiStreamToAnthropic(response, params.model)
    const stream = {
      [Symbol.asyncIterator]() {
        return eventStream
      },
      controller: new AbortController(),
    }

    return { stream, response }
  }

  /**
   * APIPromise-like wrapper matching the Anthropic SDK interface:
   * - await it → gets stream or message
   * - .withResponse() → gets { data, response, request_id }
   */
  function createAPIPromise(
    params: any,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): any {
    const innerPromise = createMessageStream(params, options)

    function getData(r: any) {
      return r.stream || r.result
    }

    const apiPromise = {
      then(onFulfilled: any, onRejected?: any) {
        return innerPromise
          .then(r => getData(r))
          .then(onFulfilled, onRejected)
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
            r.response.headers.get('x-request-id') || `gem_${Date.now()}`,
        }))
      },
    }

    return apiPromise
  }

  return {
    beta: {
      messages: { create: createAPIPromise },
    },
    messages: { create: createAPIPromise },
  }
}
