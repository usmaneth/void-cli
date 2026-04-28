import React, { useState } from 'react'
import TextInput from '../../components/TextInput.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import {
  getProviderEnvVarName,
  getProviderKeychainServiceName,
  storeProviderKeyInKeychain,
  validateProviderKey,
  type ProviderKeychainName,
} from '../../utils/providerKeychain.js'
import { getPalette } from '../../theme/index.js'

type Props = {
  provider: ProviderKeychainName
  onDone: (success: boolean, message: string) => void
}

const PROVIDER_LABELS: Record<ProviderKeychainName, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
}

const KEY_HINTS: Record<ProviderKeychainName, string> = {
  openrouter: 'sk-or-v1-...',
  openai: 'sk-...',
  gemini: '39-char alphanumeric key',
}

const GET_KEY_URL: Record<ProviderKeychainName, string> = {
  openrouter: 'https://openrouter.ai/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
}

export function ApiKeyEntry({ provider, onDone }: Props): React.ReactNode {
  const palette = getPalette()
  const [value, setValue] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const label = PROVIDER_LABELS[provider]

  const handleSubmit = (raw: string): void => {
    const validation = validateProviderKey(provider, raw)
    if (validation.ok === false) {
      setError(validation.reason)
      return
    }
    if (process.platform !== 'darwin') {
      onDone(
        false,
        `Keychain storage is only supported on macOS. Set ${getProviderEnvVarName(provider)} env var instead.`,
      )
      return
    }
    const ok = storeProviderKeyInKeychain(provider, raw.trim())
    if (!ok) {
      onDone(
        false,
        `Failed to store ${label} key in keychain. Set ${getProviderEnvVarName(provider)} env var instead.`,
      )
      return
    }
    onDone(
      true,
      `✓ Saved to macOS keychain as ${getProviderKeychainServiceName(provider)}`,
    )
  }

  return (
    <Dialog
      title={`Sign in to ${label}`}
      onCancel={() => onDone(false, 'Login cancelled')}
      color="permission"
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          Paste your {label} API key below ({KEY_HINTS[provider]}).
        </Text>
        <Text dimColor>Get a key: {GET_KEY_URL[provider]}</Text>
        <Box>
          <Text>{'> '}</Text>
          <TextInput
            value={value}
            onChange={v => {
              setValue(v)
              if (error) setError(null)
            }}
            onSubmit={handleSubmit}
            placeholder={KEY_HINTS[provider]}
            columns={60}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
            mask="*"
          />
        </Box>
        {error && <Text color={palette.state.failure}>{error}</Text>}
        <Text dimColor>
          The key is stored in the macOS keychain under service{' '}
          {getProviderKeychainServiceName(provider)}.
        </Text>
      </Box>
    </Dialog>
  )
}
