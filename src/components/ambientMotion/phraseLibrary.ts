/**
 * Loading phrase library — replaces the single "Fracturing…" with a
 * vocabulary of ~50 phrases across 5 operation categories. Plus rare
 * easter-egg phrases (1-in-50) drawn from a separate pool.
 *
 * Selection rules:
 *   - 2% of picks (controlled by easterEggSeed < 0.02) draw from EASTER_EGGS
 *   - Otherwise draw from the requested category, skipping any phrase
 *     already in the last-5 buffer (unless the pool is too small)
 *   - Unknown category falls back to generic
 */

export type PhraseCategory =
  | 'generic' | 'bash' | 'fileEdit' | 'subagent' | 'compaction'

export const PHRASES: Record<PhraseCategory, readonly string[]> = {
  generic: [
    'fracturing reality…',
    'channeling the void…',
    'folding context…',
    'the cursor ponders…',
    'feeling the weight of the void…',
    'consulting the silence…',
    'reading between the bytes…',
    'the void considers…',
    'unfolding…',
    'aligning the diamond…',
    'composing thought…',
    'the prompt steeps…',
  ],
  bash: [
    'consulting the shell oracle…',
    'summoning subprocess…',
    'piping the impossible…',
    'feeding bash a question…',
    'asking the kernel politely…',
    'translating intent to syscalls…',
  ],
  fileEdit: [
    'bending bytes…',
    're-stitching the file…',
    'careful surgery…',
    'rewriting the line…',
    'placing the comma…',
    'the cursor finds the spot…',
  ],
  subagent: [
    'spawning a fragment…',
    'the void multiplies…',
    'lighting another candle…',
    'sending a worker…',
    'splitting attention…',
    'one voice becomes two…',
  ],
  compaction: [
    'condensing the past…',
    'folding history into a single sigh…',
    'compressing the memory of memory…',
    'shedding load…',
    'remembering less, better…',
    'the conversation distills…',
  ],
}

export const EASTER_EGGS: readonly string[] = [
  'the void remembers',
  'everything here is yours',
  '◆',
  'ready when you are',
  'the cursor ends, the void begins',
  'a single prompt to rule them all',
]

export type PickInput = {
  category: PhraseCategory
  lastFive: readonly string[]
  easterEggSeed: number
}

const EASTER_EGG_RATE = 0.02

export function pickPhrase({
  category,
  lastFive,
  easterEggSeed,
}: PickInput): string {
  if (easterEggSeed < EASTER_EGG_RATE) {
    const idx = Math.floor(easterEggSeed * EASTER_EGGS.length / EASTER_EGG_RATE) % EASTER_EGGS.length
    return EASTER_EGGS[idx]!
  }

  const list: readonly string[] = PHRASES[category] ?? PHRASES.generic
  const candidates = list.filter(p => !lastFive.includes(p))
  const pool = candidates.length > 0 ? candidates : list

  const idx = Math.floor((easterEggSeed - EASTER_EGG_RATE) * pool.length / (1 - EASTER_EGG_RATE)) % pool.length
  return pool[Math.max(0, idx)]!
}
