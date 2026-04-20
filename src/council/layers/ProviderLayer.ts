/**
 * ProviderLayer — dispatches a single council member's prompt to its provider
 * (Anthropic native SDK or OpenRouter Chat Completions).
 *
 * Depends on AuthLayer for credential resolution. Tests substitute `mockLayer`
 * to return scripted responses without touching the network.
 */
import { Context, Effect, Layer } from 'effect'
import { Auth } from './AuthLayer.js'
import type {
  ProviderExecuteInput,
  ProviderExecuteOutput,
} from './types.js'

export interface ProviderService {
  readonly execute: (
    input: ProviderExecuteInput,
  ) => Effect.Effect<ProviderExecuteOutput, Error>
}

export class Provider extends Context.Tag('council/Provider')<
  Provider,
  ProviderService
>() {}

/**
 * Default layer — real network calls. Depends on Auth.
 */
export const defaultLayer = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const auth = yield* Auth
    return Provider.of({
      execute: ({ member, prompt, systemPrompt }) =>
        Effect.tryPromise({
          try: async () => {
            if (member.provider === 'anthropic') {
              const { getAnthropicClient } = await import(
                '../../services/api/client.js'
              )
              const { OAUTH_BETA_HEADER } = await import(
                '../../constants/oauth.js'
              )
              const { token: _token, isOAuth } = await Effect.runPromise(
                auth.anthropicToken(),
              )
              const client = await getAnthropicClient({ maxRetries: 1 })
              const betas: string[] = []
              if (isOAuth) betas.push(OAUTH_BETA_HEADER)
              const response = await client.beta.messages.create({
                model: member.model.replace('anthropic/', ''),
                max_tokens: 4096,
                system: systemPrompt || '',
                messages: [{ role: 'user', content: prompt }],
                ...(betas.length > 0 && { betas }),
              })
              const content = response.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
              return {
                content,
                tokens: {
                  input: response.usage?.input_tokens ?? 0,
                  output: response.usage?.output_tokens ?? 0,
                },
              }
            }

            // OpenRouter path
            const apiKey = await Effect.runPromise(auth.openrouterKey())
            const baseURL =
              process.env.OPENROUTER_BASE_URL ??
              'https://openrouter.ai/api/v1'
            const response = await fetch(`${baseURL}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://github.com/usmaneth/void-cli',
                'X-Title': 'Void CLI Council',
              },
              body: JSON.stringify({
                model: member.model,
                messages: [
                  ...(systemPrompt
                    ? [{ role: 'system' as const, content: systemPrompt }]
                    : []),
                  { role: 'user' as const, content: prompt },
                ],
                max_tokens: 4096,
              }),
            })
            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(
                `OpenRouter error (${response.status}): ${errorText}`,
              )
            }
            const data = (await response.json()) as any
            return {
              content: data.choices?.[0]?.message?.content ?? '',
              tokens: {
                input: data.usage?.prompt_tokens ?? 0,
                output: data.usage?.completion_tokens ?? 0,
              },
            }
          },
          catch: (err) =>
            err instanceof Error ? err : new Error(String(err)),
        }),
    })
  }),
)

/**
 * Mock layer — scripted responses keyed by member id. If `responder` is a
 * function, it's invoked per-request (useful for timeout/error scenarios).
 */
export type MockResponder =
  | Record<string, ProviderExecuteOutput>
  | ((
      input: ProviderExecuteInput,
    ) => Promise<ProviderExecuteOutput> | ProviderExecuteOutput)

export const mockLayer = (responder: MockResponder) =>
  Layer.succeed(
    Provider,
    Provider.of({
      execute: (input) =>
        Effect.tryPromise({
          try: async () => {
            if (typeof responder === 'function') {
              return await responder(input)
            }
            const hit = responder[input.member.id]
            if (!hit) {
              throw new Error(
                `mock provider: no scripted response for memberId=${input.member.id}`,
              )
            }
            return hit
          },
          catch: (err) =>
            err instanceof Error ? err : new Error(String(err)),
        }),
    }),
  )
