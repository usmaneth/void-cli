import { feature } from '../../bun-bundle-shim.js'
import * as React from 'react'
import { useState } from 'react'
import { resetCostState } from '../../bootstrap/state.js'
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
} from '../../bridge/trustedDevice.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Text, useInput } from '../../ink.js'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import { refreshPolicyLimits } from '../../services/policyLimits/index.js'
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  checkAndDisableAutoModeIfNeeded,
  checkAndDisableBypassPermissionsIfNeeded,
  resetAutoModeGateCheck,
  resetBypassPermissionsCheck,
} from '../../utils/permissions/bypassPermissionsKillswitch.js'
import { resetUserCache } from '../../utils/user.js'
import {
  PROVIDER_KEYCHAIN_NAMES,
  type ProviderKeychainName,
} from '../../utils/providerKeychain.js'
import { ApiKeyEntry } from './apiKeyEntry.js'
import {
  ProviderPicker,
  type LoginProviderId,
} from './providerPicker.js'

// -----------------------------------------------------------------------------
// /login command entrypoint. Routes by the first arg:
//   /login                      → picker
//   /login anthropic            → Anthropic OAuth (legacy behavior)
//   /login chatgpt              → delegate to ./chatgpt (other agent's file)
//   /login openrouter|openai|gemini → paste-API-key UX
// -----------------------------------------------------------------------------

const VALID_PROVIDERS: readonly LoginProviderId[] = [
  'anthropic',
  'chatgpt',
  'openrouter',
  'openai',
  'gemini',
]

function parseProviderArg(raw: string): LoginProviderId | null {
  const arg = raw.trim().toLowerCase().split(/\s+/)[0]
  if (!arg) return null
  if ((VALID_PROVIDERS as readonly string[]).includes(arg)) {
    return arg as LoginProviderId
  }
  return null
}

/**
 * Public entrypoint used by the command router and by the first-run
 * auth prompt. `args` mirrors the slash-command syntax:
 *   ''             → picker
 *   'anthropic'    → anthropic OAuth
 *   'chatgpt'      → ChatGPT subscription (other agent)
 *   '<provider>'   → API-key paste UX
 */
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const provider = parseProviderArg(args ?? '')
  return (
    <LoginRouter
      initialProvider={provider}
      onDone={async (success, providerId) => {
        await finalizeLogin(success, providerId, context)
        onDone(
          success
            ? `Login successful${providerId ? ` (${providerId})` : ''}`
            : 'Login interrupted',
        )
      }}
    />
  )
}

/**
 * Shared post-login refresh — keeps in sync with the original login.tsx
 * behavior. The heavy Anthropic-specific refreshes (GrowthBook, trusted
 * device, etc.) don't hurt for other providers, but the signature-block
 * strip is important when switching auth.
 */
async function finalizeLogin(
  success: boolean,
  provider: LoginProviderId | null,
  context: LocalJSXCommandContext,
): Promise<void> {
  context.onChangeAPIKey()
  context.setMessages(stripSignatureBlocks)
  if (!success) return

  resetCostState()
  void refreshRemoteManagedSettings()
  void refreshPolicyLimits()
  resetUserCache()
  refreshGrowthBookAfterAuthChange()
  clearTrustedDeviceToken()
  void enrollTrustedDevice()
  resetBypassPermissionsCheck()

  const appState = context.getAppState()
  void checkAndDisableBypassPermissionsIfNeeded(
    appState.toolPermissionContext,
    context.setAppState,
  )
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    resetAutoModeGateCheck()
    void checkAndDisableAutoModeIfNeeded(
      appState.toolPermissionContext,
      context.setAppState,
      appState.fastMode,
    )
  }
  context.setAppState(prev => ({
    ...prev,
    authVersion: prev.authVersion + 1,
  }))
}

type LoginRouterProps = {
  initialProvider: LoginProviderId | null
  onDone: (success: boolean, provider: LoginProviderId | null) => void
}

/**
 * State machine: picker → provider-specific UI. The router is exported
 * so the first-run onboarding flow can mount it directly without going
 * through the slash-command layer.
 */
export function LoginRouter({
  initialProvider,
  onDone,
}: LoginRouterProps): React.ReactNode {
  const [provider, setProvider] = useState<LoginProviderId | null>(
    initialProvider,
  )

  if (provider === null) {
    return (
      <ProviderPicker
        onSelect={setProvider}
        onCancel={() => onDone(false, null)}
      />
    )
  }

  if (provider === 'anthropic') {
    return <AnthropicLogin onDone={success => onDone(success, 'anthropic')} />
  }

  if (provider === 'chatgpt') {
    return (
      <ChatgptLogin
        onDone={success => onDone(success, 'chatgpt')}
        onFallback={() => setProvider(null)}
      />
    )
  }

  // Paste-API-key providers
  if ((PROVIDER_KEYCHAIN_NAMES as readonly string[]).includes(provider)) {
    return (
      <ApiKeyEntry
        provider={provider as ProviderKeychainName}
        onDone={success => onDone(success, provider)}
      />
    )
  }

  return null
}

// -----------------------------------------------------------------------------
// Anthropic OAuth — identical to the pre-unification login.tsx.
// -----------------------------------------------------------------------------

function AnthropicLogin({
  onDone,
  startingMessage,
}: {
  onDone: (success: boolean, mainLoopModel: string) => void
  startingMessage?: string
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel()
  return (
    <Dialog
      title="Login"
      onCancel={() => onDone(false, mainLoopModel)}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="cancel"
          />
        )
      }
    >
      <ConsoleOAuthFlow
        onDone={() => onDone(true, mainLoopModel)}
        startingMessage={startingMessage}
      />
    </Dialog>
  )
}

// -----------------------------------------------------------------------------
// ChatGPT subscription — the other agent owns ./chatgpt.js.
// Dynamic import so this worktree compiles before that file lands.
// -----------------------------------------------------------------------------

function ChatgptLogin({
  onDone,
  onFallback,
}: {
  onDone: (success: boolean) => void
  onFallback: () => void
}): React.ReactNode {
  const [status, setStatus] = useState<
    | { kind: 'loading' }
    | { kind: 'unavailable'; reason: string }
    | { kind: 'ready'; node: React.ReactNode }
  >({ kind: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!feature('CHATGPT_SUBSCRIPTION_AUTH')) {
        if (!cancelled) {
          setStatus({
            kind: 'unavailable',
            reason:
              "ChatGPT subscription auth requires feature('CHATGPT_SUBSCRIPTION_AUTH').",
          })
        }
        return
      }
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — sibling file owned by a different worktree; may not exist at compile time.
        const mod: unknown = await import('./chatgpt.js')
        const callFn = (mod as { call?: unknown }).call
        if (typeof callFn !== 'function') {
          if (!cancelled) {
            setStatus({
              kind: 'unavailable',
              reason:
                'ChatGPT login module is present but missing a `call` export.',
            })
          }
          return
        }
        const node = await (callFn as (
          onDone: (success: boolean) => void,
        ) => Promise<React.ReactNode>)(onDone)
        if (!cancelled) {
          setStatus({ kind: 'ready', node: node ?? null })
        }
      } catch {
        if (!cancelled) {
          setStatus({
            kind: 'unavailable',
            reason:
              'ChatGPT subscription auth is not yet available in this build.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onDone])

  if (status.kind === 'ready') return status.node
  if (status.kind === 'loading') {
    return (
      <Dialog
        title="ChatGPT"
        onCancel={() => onDone(false)}
        color="permission"
      >
        <Text dimColor>Loading ChatGPT sign-in…</Text>
      </Dialog>
    )
  }
  // unavailable
  return (
    <Dialog
      title="ChatGPT (unavailable)"
      onCancel={() => onDone(false)}
      color="warning"
    >
      <Text>{status.reason}</Text>
      <Text dimColor>Pick a different provider or press Esc to cancel.</Text>
      <Text dimColor> </Text>
      <Text dimColor>
        Press Enter to return to the provider picker.
      </Text>
      <ChatgptFallbackKey onBack={onFallback} onCancel={() => onDone(false)} />
    </Dialog>
  )
}

function ChatgptFallbackKey({
  onBack,
  onCancel,
}: {
  onBack: () => void
  onCancel: () => void
}): React.ReactNode {
  useInput((_input, key) => {
    if (key.return) onBack()
    else if (key.escape) onCancel()
  })
  return null
}

/**
 * Legacy component export so any callers that did
 *   import { Login } from './login.js'
 * keep working. Routes through the new LoginRouter.
 */
export function Login(props: {
  onDone: (success: boolean, mainLoopModel: string) => void
  startingMessage?: string
}): React.ReactNode {
  // Preserve pre-unification behavior: bare <Login /> still runs Anthropic OAuth.
  return (
    <AnthropicLogin
      onDone={props.onDone}
      startingMessage={props.startingMessage}
    />
  )
}
