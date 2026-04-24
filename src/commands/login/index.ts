import type { Command } from '../../commands.js'
import { hasAnthropicApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasAnthropicApiKeyAuth()
      ? 'Switch accounts or sign in to another provider'
      : 'Sign in to a provider (Anthropic, ChatGPT, OpenAI, OpenRouter, Gemini)',
    argumentHint: '[anthropic|chatgpt|openrouter|openai|gemini]',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
