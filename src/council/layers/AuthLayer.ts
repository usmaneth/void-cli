/**
 * AuthLayer — resolves API credentials for council providers.
 *
 * In production, pulls from env vars and the macOS keychain (same as the
 * original orchestrator). In tests, swap for `mockLayer` with hard-coded
 * creds.
 */
import { Context, Effect, Layer } from 'effect'
import type { AuthCredentials } from './types.js'

export interface AuthService {
  readonly credentials: () => Effect.Effect<AuthCredentials>
  readonly openrouterKey: () => Effect.Effect<string, Error>
  readonly anthropicToken: () => Effect.Effect<
    { token?: string; isOAuth: boolean },
    Error
  >
}

export class Auth extends Context.Tag('council/Auth')<Auth, AuthService>() {}

async function readKeychainSecret(service: string): Promise<string | undefined> {
  try {
    const { execFileSync } = await import('child_process')
    return execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf-8' },
    ).trim()
  } catch {
    return undefined
  }
}

/**
 * Default layer — reads env + macOS keychain, lazily.
 */
export const defaultLayer = Layer.succeed(
  Auth,
  Auth.of({
    credentials: () =>
      Effect.promise(async () => {
        const openrouter =
          process.env.OPENROUTER_API_KEY ??
          (await readKeychainSecret('Void-openrouter'))
        const anthropic = process.env.ANTHROPIC_API_KEY
        let isOAuth = false
        try {
          const { isClaudeAISubscriber } = await import('../../utils/auth.js')
          isOAuth = !!isClaudeAISubscriber()
        } catch {
          isOAuth = false
        }
        return {
          openrouter,
          anthropic,
          anthropicIsOAuth: isOAuth,
        }
      }),
    openrouterKey: () =>
      Effect.promise(async () => {
        const key =
          process.env.OPENROUTER_API_KEY ??
          (await readKeychainSecret('Void-openrouter'))
        if (!key)
          throw new Error(
            'OPENROUTER_API_KEY not set — run /provider add openrouter <key>',
          )
        return key
      }),
    anthropicToken: () =>
      Effect.promise(async () => {
        const token = process.env.ANTHROPIC_API_KEY
        let isOAuth = false
        try {
          const { isClaudeAISubscriber } = await import('../../utils/auth.js')
          isOAuth = !!isClaudeAISubscriber()
        } catch {
          isOAuth = false
        }
        return { token, isOAuth }
      }),
  }),
)

/**
 * Mock layer — hard-code creds for tests.
 */
export const mockLayer = (creds: AuthCredentials) =>
  Layer.succeed(
    Auth,
    Auth.of({
      credentials: () => Effect.succeed(creds),
      openrouterKey: () =>
        creds.openrouter
          ? Effect.succeed(creds.openrouter)
          : Effect.fail(new Error('mock: no openrouter key')),
      anthropicToken: () =>
        Effect.succeed({
          token: creds.anthropic,
          isOAuth: !!creds.anthropicIsOAuth,
        }),
    }),
  )
