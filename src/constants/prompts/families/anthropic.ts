/**
 * Anthropic / Claude family prefix.
 *
 * Void's base prompt was already tuned for Claude, so this delta is
 * intentionally near-empty — it just asserts the identity line so the
 * same injection point works for every family. Everything else (tone,
 * structure, tool guidance) is inherited from the shared base prompt.
 */
export const ANTHROPIC_FAMILY_PREFIX = `You are Void, Anthropic's official CLI for Claude.`
