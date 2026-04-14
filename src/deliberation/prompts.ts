/**
 * Prompt construction for the Deliberation Room.
 *
 * Builds system prompts, round prompts, and convergence heuristics
 * to drive genuine multi-model debate.
 */

import type { ModelResponse, Round } from './types.js'

/**
 * Anti-sycophancy system prompt that instructs a model to challenge
 * rather than agree with other participants.
 */
export function getDeliberationSystemPrompt(
  modelName: string,
  totalModels: number,
): string {
  return [
    `You are "${modelName}", one of ${totalModels} AI models in a structured deliberation.`,
    '',
    'Your job is to think independently and challenge weak reasoning. Follow these rules strictly:',
    '',
    '1. CALL OUT FLAWS with specific evidence. Do not let vague or unsupported claims slide.',
    '2. PRESENT BETTER APPROACHES with clear reasoning when you disagree.',
    '3. NEVER echo another model\'s answer without adding substantial new insight.',
    '4. CONVERGE only when the argument is genuinely strong — not to be polite.',
    '5. If you agree, explain *why* the reasoning is sound, not just that you agree.',
    '6. Be direct. Do not hedge with "I think we can all agree" or "great point."',
    '',
    'The goal is the best possible answer, not consensus for its own sake.',
  ].join('\n')
}

/**
 * Builds the user-turn prompt for a model in a given round, including
 * all previous responses and optional human injection.
 */
export function getRoundPrompt(
  round: number,
  maxRounds: number,
  topic: string,
  previousResponses: ModelResponse[],
  humanInjection?: string,
): string {
  const parts: string[] = []

  // Round context
  parts.push(`[Round ${round} of ${maxRounds}]`)
  parts.push('')

  if (round === 1) {
    // First round: initial analysis
    parts.push('TOPIC:')
    parts.push(topic)
    parts.push('')
    parts.push(
      'Give your initial analysis. Be specific and take a clear position.',
    )
  } else if (round >= maxRounds) {
    // Final round: synthesize
    parts.push('TOPIC:')
    parts.push(topic)
    parts.push('')
    parts.push('--- Previous responses ---')
    parts.push(formatPreviousResponses(previousResponses))
    parts.push('')
    if (humanInjection) {
      parts.push('--- Human interjection ---')
      parts.push(humanInjection)
      parts.push('')
    }
    parts.push(
      'This is the FINAL round. Synthesize the strongest position from the discussion. ' +
        'If fundamental disagreements remain, state them clearly rather than papering over them.',
    )
  } else {
    // Mid rounds: review and challenge
    parts.push('TOPIC:')
    parts.push(topic)
    parts.push('')
    parts.push('--- Previous responses ---')
    parts.push(formatPreviousResponses(previousResponses))
    parts.push('')
    if (humanInjection) {
      parts.push('--- Human interjection ---')
      parts.push(humanInjection)
      parts.push('')
    }
    parts.push(
      'Review the other responses. Challenge anything weak, add what was missed, ' +
        'and strengthen or revise your position based on the strongest arguments.',
    )
  }

  return parts.join('\n')
}

/**
 * Format previous model responses into a readable block.
 */
function formatPreviousResponses(responses: ModelResponse[]): string {
  if (responses.length === 0) return '(none)'

  return responses
    .map(
      (r) =>
        `[${r.model} — Round ${r.round}]:\n${r.content}`,
    )
    .join('\n\n')
}

/**
 * Challenge markers that indicate models are still actively disagreeing.
 */
const CHALLENGE_MARKERS = [
  'however',
  'disagree',
  'alternatively',
  'flawed',
  'incorrect',
  'wrong',
  'overlooked',
  'missed',
  'but ',
  'on the contrary',
  'problematic',
  'weak',
  'issue with',
  'counterpoint',
  'not quite',
  'actually,',
  'i challenge',
  'misses the point',
  'fails to',
]

/**
 * Simple convergence heuristic: if the last 2 rounds have no challenge
 * markers in any of the responses, consider the deliberation converged.
 */
export function checkConvergence(rounds: Round[]): boolean {
  if (rounds.length < 2) return false

  const lastTwo = rounds.slice(-2)

  for (const round of lastTwo) {
    for (const response of round.responses) {
      const lower = response.content.toLowerCase()
      for (const marker of CHALLENGE_MARKERS) {
        if (lower.includes(marker)) {
          return false
        }
      }
    }
  }

  return true
}
