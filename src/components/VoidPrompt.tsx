import * as React from 'react'
import { Text } from '../ink.js'
import { getPalette } from '../theme/index.js'

interface VoidPromptProps {
  model?: string
  mode?: 'default' | 'council'
  symbol?: string
  accentColor?: string
}

export function getPromptString(model?: string, mode?: string, symbol: string = '›', showModel: boolean = true): string {
  if (mode === 'council') {
    return `void council ${symbol} `
  }
  if (model && showModel) {
    const shortName = getShortModelName(model)
    return `void ${shortName} ${symbol} `
  }
  return `void ${symbol} `
}

function getShortModelName(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('claude')) return 'claude'
  if (lower.includes('gpt')) return 'gpt'
  if (lower.includes('gemini')) return 'gemini'
  if (lower.includes('deepseek')) return 'deepseek'
  if (lower.includes('llama') || lower.includes('local')) return 'local'
  if (lower.includes('mistral')) return 'mistral'
  const parts = model.split('/')
  return parts[parts.length - 1]?.split('-')[0] ?? 'void'
}

export function VoidPrompt({ model, mode, symbol = '›', accentColor }: VoidPromptProps) {
  const palette = getPalette()
  const resolvedAccent = accentColor ?? palette.brand.diamond
  const promptStr = getPromptString(model, mode, symbol)
  const symbolIndex = promptStr.lastIndexOf(symbol)
  const before = promptStr.slice(0, symbolIndex)
  const after = promptStr.slice(symbolIndex + symbol.length)

  return (
    <Text>
      <Text bold>{before}</Text>
      <Text color={resolvedAccent}>{symbol}</Text>
      <Text>{after}</Text>
    </Text>
  )
}
