import React from 'react'
import { feature } from '../../bun-bundle-shim.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'

export type LoginProviderId =
  | 'anthropic'
  | 'chatgpt'
  | 'openrouter'
  | 'openai'
  | 'gemini'

type Props = {
  onSelect: (provider: LoginProviderId) => void
  onCancel: () => void
  title?: string
  subtitle?: string
}

type Row = {
  readonly id: LoginProviderId
  readonly label: string
  readonly description: string
}

/**
 * Build the provider-picker rows. Exported so tests (and the first-run
 * flow) can check what gets surfaced under a given feature-flag state.
 */
export function buildProviderRows(opts: {
  includeChatgpt: boolean
}): Row[] {
  const rows: Row[] = [
    {
      id: 'anthropic',
      label: 'Anthropic (Claude)',
      description: 'OAuth sign-in — Pro / Max / Team / Enterprise',
    },
  ]
  if (opts.includeChatgpt) {
    rows.push({
      id: 'chatgpt',
      label: 'ChatGPT (gpt-5.4+)',
      description: 'Subscription inference — Plus / Pro',
    })
  }
  rows.push(
    {
      id: 'openai',
      label: 'OpenAI',
      description: 'API key (platform.openai.com/api-keys)',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      description: 'API key — any model, one bill (openrouter.ai/keys)',
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      description: 'API key (aistudio.google.com/apikey)',
    },
  )
  return rows
}

export function ProviderPicker({
  onSelect,
  onCancel,
  title = 'Sign in to Void',
  subtitle = 'Choose a provider to get started.',
}: Props): React.ReactNode {
  const includeChatgpt = feature('CHATGPT_SUBSCRIPTION_AUTH')
  const rows = buildProviderRows({ includeChatgpt })
  const options = rows.map(r => ({
    label: r.label,
    description: r.description,
    value: r.id,
  }))

  return (
    <Dialog title={title} onCancel={onCancel} color="permission">
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{subtitle}</Text>
        <Select
          options={options}
          onChange={value => onSelect(value as LoginProviderId)}
          onCancel={onCancel}
          inlineDescriptions={false}
        />
      </Box>
    </Dialog>
  )
}
