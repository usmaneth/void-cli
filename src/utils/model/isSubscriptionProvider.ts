/**
 * Returns true iff the given model id resolves to a subscription-billed
 * inference path (ChatGPT Plus/Pro). Used by status panel cost rendering.
 *
 * Mirrors the dispatch logic in services/api/client.ts which routes bare
 * gpt-5.* to the ChatGPT subscription backend.
 */
export function isSubscriptionProvider(
  model: string | null | undefined,
): boolean {
  if (!model) return false
  const id = model.toLowerCase().trim()
  if (!id) return false
  if (/(^|\/)openai\//i.test(id)) return false
  return /^gpt-5(\.|-)/.test(id)
}
