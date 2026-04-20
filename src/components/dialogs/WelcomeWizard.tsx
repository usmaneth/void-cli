/**
 * First-run wizard: provider → API key → default model.
 *
 * The reducer lives in `src/hooks/dialogs/useWelcomeWizard.ts` so Voidex
 * can drive the same flow without mounting Ink. This component is a thin
 * render shell that wires the reducer to the terminal UI.
 *
 * Completion writes `~/.void/initialized` and persists the selected
 * provider/model via the caller-supplied `onComplete` callback. The
 * caller owns the settings file so we don't double-write.
 */
import * as React from 'react'
import { useReducer } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import type { Key } from '../../ink.js'
import {
  WIZARD_INITIAL,
  WIZARD_MODEL_SUGGESTIONS,
  WIZARD_PROVIDERS,
  canAdvance,
  wizardReducer,
  type WizardProvider,
  type WizardState,
} from '../../hooks/dialogs/useWelcomeWizard.js'
import { markInitialized } from '../../utils/initialized.js'
import { ListDialog, type ListDialogItem } from './ListDialog.js'

type Props = {
  /** Called with the final state once the user confirms or skips. */
  readonly onComplete: (state: WizardState) => void
  /** Called when the user presses Ctrl+C or Esc on step 0. */
  readonly onCancel?: () => void
  /**
   * When true, completion does NOT write `~/.void/initialized` — caller
   * handles persistence. Defaults to false so /model-less callers Just
   * Work.
   */
  readonly skipInitializedWrite?: boolean
}

export function WelcomeWizard({ onComplete, onCancel, skipInitializedWrite }: Props): React.ReactNode {
  const [state, dispatch] = useReducer(wizardReducer, WIZARD_INITIAL)

  if (state.complete) {
    // Caller renders the terminating confirmation screen; we short-circuit.
    if (!skipInitializedWrite) {
      try {
        markInitialized({
          provider: state.provider ?? undefined,
          model: state.model ?? undefined,
          skipped: state.skipped,
        })
      } catch {
        // best-effort — never block completion on disk errors
      }
    }
    // Defer call so React doesn't fire it in render.
    queueMicrotask(() => onComplete(state))
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX={2} paddingY={1}>
        <Text bold color="success">
          {state.skipped ? 'Setup skipped.' : "You're all set."}
        </Text>
        <Text dimColor>
          {state.skipped
            ? 'Run Ctrl+W to re-run the welcome wizard.'
            : `Default provider: ${state.provider}. Default model: ${state.model}.`}
        </Text>
      </Box>
    )
  }

  if (state.stepIndex === 0) {
    const items: ListDialogItem[] = WIZARD_PROVIDERS.map(p => ({
      id: p,
      label: p,
      description: providerBlurb(p),
    }))
    return (
      <WizardChrome step={0} title="Step 1 of 3 · Pick a provider">
        <ListDialog
          title="Choose a provider"
          subtitle="You can add more later with /provider."
          items={items}
          isSelected={it => it.id === state.provider}
          onSelect={it => {
            dispatch({ kind: 'selectProvider', provider: it.id as WizardProvider })
            dispatch({ kind: 'next' })
          }}
          onCancel={() => onCancel?.()}
          placeholder="Search providers…"
        />
      </WizardChrome>
    )
  }

  if (state.stepIndex === 1) {
    return (
      <WizardChrome step={1} title="Step 2 of 3 · API key">
        <ApiKeyStep state={state} dispatch={dispatch} />
      </WizardChrome>
    )
  }

  // step 2 — model picker
  const suggestions = state.provider ? WIZARD_MODEL_SUGGESTIONS[state.provider] : []
  const items: ListDialogItem[] = suggestions.map(m => ({
    id: m.id,
    label: m.id,
    description: m.label,
  }))
  return (
    <WizardChrome step={2} title="Step 3 of 3 · Default model">
      <ListDialog
        title="Pick a default model"
        subtitle={`Provider: ${state.provider}`}
        items={items}
        isSelected={it => it.id === state.model}
        onSelect={it => {
          dispatch({ kind: 'selectModel', model: it.id })
          dispatch({ kind: 'next' })
        }}
        onCancel={() => dispatch({ kind: 'back' })}
        placeholder="Search models…"
        footerHint={
          canAdvance({ ...state, model: state.model }) ? undefined : (
            <Text dimColor>Enter to pick · Esc to go back</Text>
          )
        }
      />
    </WizardChrome>
  )
}

function WizardChrome({
  step,
  title,
  children,
}: {
  step: number
  title: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="suggestion">
          {title}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          {'○ '.repeat(step) + '● ' + '○ '.repeat(Math.max(0, 2 - step))}
        </Text>
      </Box>
      {children}
    </Box>
  )
}

function ApiKeyStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<Parameters<typeof wizardReducer>[1]>
}): React.ReactNode {
  useInput((input: string, key: Key) => {
    if (key.escape) {
      dispatch({ kind: 'back' })
      return
    }
    if (key.return) {
      if (canAdvance(state)) dispatch({ kind: 'next' })
      return
    }
    if (key.backspace || key.delete) {
      dispatch({ kind: 'setApiKey', value: state.apiKey.slice(0, -1) })
      return
    }
    if (key.ctrl && input === 's') {
      dispatch({ kind: 'skip' })
      return
    }
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      dispatch({ kind: 'setApiKey', value: state.apiKey + input })
    }
  })

  const masked = state.apiKey.length === 0 ? '' : '•'.repeat(Math.min(state.apiKey.length, 48))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={2} paddingY={1}>
      <Text bold>Enter your {state.provider} API key</Text>
      <Text dimColor>We store it in the macOS keychain (or OS equivalent). Esc goes back.</Text>
      <Box marginTop={1}>
        <Text>
          <Text dimColor>key › </Text>
          <Text>{masked}</Text>
          <Text dimColor>_</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor italic>
          {state.provider === 'anthropic'
            ? 'Enter to continue (OAuth available via /login) · Ctrl+S skip'
            : canAdvance(state)
            ? 'Enter to continue · Ctrl+S skip'
            : 'Paste a key to continue · Ctrl+S skip'}
        </Text>
      </Box>
    </Box>
  )
}

function providerBlurb(p: WizardProvider): string {
  switch (p) {
    case 'anthropic':
      return 'Claude Opus / Sonnet / Haiku — OAuth login supported.'
    case 'openrouter':
      return 'Hundreds of models behind a single key.'
    case 'openai':
      return 'GPT-5.4 and OpenAI catalog.'
    case 'gemini':
      return 'Gemini 3 Pro / Flash.'
  }
}
