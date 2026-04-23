import { CLAUDE_OPUS_4_6_CONFIG, CLAUDE_OPUS_4_7_CONFIG } from '../model/configs.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// When the user has never set teammateDefaultModel in /config, new teammates
// use Opus 4.7. 3P providers fall back to 4.6 until 4.7 lands on their side.
export function getHardcodedTeammateModelFallback(): string {
  const provider = getAPIProvider()
  if (provider !== 'firstParty' && provider !== 'openrouter') {
    return CLAUDE_OPUS_4_6_CONFIG[provider]
  }
  return CLAUDE_OPUS_4_7_CONFIG[provider]
}
