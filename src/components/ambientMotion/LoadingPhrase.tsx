/**
 * Rotating loading phrase. Shows one phrase from the library at a time,
 * cycling every ~2s. Avoids repeats within the last 5 picks.
 */
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Text } from '../../ink.js'
import { getPalette } from '../../theme/index.js'
import { pickPhrase, type PhraseCategory } from './phraseLibrary.js'

const ROTATION_INTERVAL_MS = 2000

export type LoadingPhraseProps = {
  category: PhraseCategory
}

export function computeNextPhrase(input: {
  category: PhraseCategory
  lastFive: readonly string[]
  seed: number
}): string {
  return pickPhrase({
    category: input.category,
    lastFive: input.lastFive,
    easterEggSeed: input.seed,
  })
}

export function LoadingPhrase({ category }: LoadingPhraseProps): React.ReactNode {
  const palette = getPalette()
  const [phrase, setPhrase] = useState<string>(() =>
    computeNextPhrase({ category, lastFive: [], seed: Math.random() }),
  )
  const [history, setHistory] = useState<readonly string[]>([])

  useEffect(() => {
    const id = setInterval(() => {
      setHistory(h => {
        const next = computeNextPhrase({
          category,
          lastFive: h,
          seed: Math.random(),
        })
        setPhrase(next)
        return [next, ...h].slice(0, 5)
      })
    }, ROTATION_INTERVAL_MS)
    return () => clearInterval(id)
  }, [category])

  return <Text color={palette.text.default} italic>{phrase}</Text>
}
