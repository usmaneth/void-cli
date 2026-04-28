/**
 * Transforms a model id into a hero-display string: uppercases each
 * character, separates them with single spaces, and joins meaningful
 * tokens with " · ". Strips org prefixes (e.g. "openrouter/anthropic/")
 * and date suffixes, and drops generic family prefixes (claude/gpt/etc.)
 * when a more specific token follows.
 *
 * Examples:
 *   "claude-opus-4-7" -> "O P U S · 4 · 7"
 *   "gpt-5.5" -> "G P T · 5 · 5"
 *   "openrouter/anthropic/claude-sonnet-4-6" -> "S O N N E T · 4 · 6"
 */
const FAMILY_PREFIXES = new Set([
  'claude','gpt','gemini','grok','deepseek','qwen','kimi','glm','moonshot','chatglm',
])

const DATE_SUFFIX_RE = /-\d{8}$|-\d{4}-\d{2}-\d{2}$/

function stripOrgPrefix(id: string): string {
  while (id.includes('/')) {
    id = id.slice(id.indexOf('/') + 1)
  }
  return id
}

function isVersionToken(t: string): boolean {
  return /^\d+(\.\d+)?$/.test(t) || /^[a-z]$/.test(t)
}

function letterspace(token: string): string {
  return token.toUpperCase().split('').join(' ')
}

export function heroSpaceModelName(
  raw: string | null | undefined,
): string {
  if (!raw) return ''
  let id = raw.toLowerCase().trim()
  if (!id) return ''

  id = stripOrgPrefix(id)
  id = id.replace(DATE_SUFFIX_RE, '')

  const rawTokens = id.split(/[-.]/).filter(Boolean)
  if (rawTokens.length === 0) return ''

  const tokens: string[] = []
  for (const t of rawTokens) {
    const parts = t.match(/[a-z]+|\d+/g)
    if (parts) tokens.push(...parts)
  }
  if (tokens.length === 0) return ''

  let workingTokens = tokens
  if (tokens.length > 1 && FAMILY_PREFIXES.has(tokens[0]!)) {
    const tail = tokens.slice(1)
    if (tail.length > 0 && !isVersionToken(tail[0]!)) {
      workingTokens = tail
    }
  }

  return workingTokens.map(letterspace).join(' · ')
}
