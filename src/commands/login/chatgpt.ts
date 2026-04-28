/**
 * `/login chatgpt` and `/logout chatgpt` — ChatGPT-subscription OAuth flow.
 *
 * Gated behind feature('CHATGPT_SUBSCRIPTION_AUTH') (disabled by default).
 * Opt in via: VOID_FEATURE_FLAGS=CHATGPT_SUBSCRIPTION_AUTH
 *
 * Exposes two surfaces:
 * - A classic text-mode Command (default export) used by non-interactive runs
 *   and the legacy /login-chatgpt slash command.
 * - A `call(onDone)` bridge used by the unified /login dispatcher in
 *   login.tsx — returns an Ink component that drives the OAuth flow with
 *   live status while the browser round-trips.
 */

import * as React from 'react'
import { useEffect, useState } from 'react'
import { feature } from '../../bun-bundle-shim.js'
import { Box, Text } from '../../ink.js'
import type {
  Command,
  LocalCommandCall,
} from '../../types/command.js'
import { startLoginFlow, revokeTokens } from '../../utils/auth/openaiOauth.js'
import {
  clearTokens,
  loadTokens,
  saveTokens,
} from '../../utils/auth/openaiTokenStore.js'
import { getPalette } from '../../theme/index.js'

function isFeatureOn(): boolean {
  return feature('CHATGPT_SUBSCRIPTION_AUTH')
}

const loginCall: LocalCommandCall = async (args: string) => {
  if (!isFeatureOn()) {
    return {
      type: 'text',
      value:
        'ChatGPT subscription auth is disabled. Enable with VOID_FEATURE_FLAGS=CHATGPT_SUBSCRIPTION_AUTH.',
    }
  }

  const trimmed = (args ?? '').trim().toLowerCase()
  const wantLogout = trimmed === 'logout' || trimmed === '--logout'

  if (wantLogout) return performLogout()
  return performLogin()
}

async function performLogin() {
  try {
    const tokens = await startLoginFlow()
    saveTokens({ ...tokens, last_refresh: Date.now() })
    const who = tokens.email ?? 'ChatGPT user'
    const plan = tokens.chatgpt_plan_type ?? 'unknown plan'
    return {
      type: 'text' as const,
      value: `✓ Signed in as ${who} (${plan}). Use VOID_USE_CHATGPT_SUBSCRIPTION=1 to route gpt-5.5 through the subscription backend.`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      type: 'text' as const,
      value: `ChatGPT login failed: ${msg}`,
    }
  }
}

async function performLogout() {
  const tokens = loadTokens()
  if (tokens?.refresh_token) {
    try {
      await revokeTokens(tokens.refresh_token)
    } catch {
      // Non-fatal — we still clear local state below.
    }
  }
  clearTokens()
  return {
    type: 'text' as const,
    value: '✓ Signed out of ChatGPT subscription.',
  }
}

const loginChatgpt = {
  type: 'local',
  name: 'login-chatgpt',
  description:
    'Sign in with your ChatGPT Plus/Pro subscription (Codex OAuth). Pass "logout" to sign out.',
  isEnabled: isFeatureOn,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call: loginCall }),
} satisfies Command

export default loginChatgpt

// ─────────────────────────────────────────────────────────────────────────────
// Bridge for the unified /login dispatcher in login.tsx.
// ─────────────────────────────────────────────────────────────────────────────

type FlowStatus =
  | { kind: 'starting' }
  | { kind: 'waiting'; url?: string }
  | { kind: 'success'; email?: string; plan?: string }
  | { kind: 'error'; message: string }

function ChatgptLoginFlow({
  onDone,
}: {
  onDone: (success: boolean) => void
}): React.ReactElement {
  const palette = getPalette()
  const [status, setStatus] = useState<FlowStatus>({ kind: 'starting' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setStatus({ kind: 'waiting' })
      try {
        const tokens = await startLoginFlow()
        if (cancelled) return
        saveTokens({ ...tokens, last_refresh: Date.now() })
        setStatus({
          kind: 'success',
          email: tokens.email,
          plan: tokens.chatgpt_plan_type,
        })
        setTimeout(() => {
          if (!cancelled) onDone(true)
        }, 1500)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setStatus({ kind: 'error', message: msg })
        setTimeout(() => {
          if (!cancelled) onDone(false)
        }, 2500)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onDone])

  if (status.kind === 'starting') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, 'Preparing ChatGPT login…'),
    )
  }
  if (status.kind === 'waiting') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        null,
        'Opening browser for ChatGPT login. Complete the flow there, then return here.',
      ),
      React.createElement(
        Text,
        { dimColor: true },
        'Listening on http://localhost:1455/auth/callback',
      ),
    )
  }
  if (status.kind === 'success') {
    const who = status.email ?? 'ChatGPT user'
    const plan = status.plan ?? 'unknown plan'
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: palette.state.success },
        `✓ Signed in as ${who} (${plan}).`,
      ),
      React.createElement(
        Text,
        { dimColor: true },
        'Set VOID_USE_CHATGPT_SUBSCRIPTION=1 to route gpt-5.5 through the subscription backend.',
      ),
    )
  }
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(
      Text,
      { color: palette.state.failure },
      `ChatGPT login failed: ${status.message}`,
    ),
  )
}

/**
 * Bridge for the unified `/login` dispatcher (login.tsx LoginRouter).
 *
 * Returns an Ink element that drives the OAuth flow with live status.
 * Calls `onDone(true|false)` when the flow resolves so the router can
 * unmount and return to the REPL.
 */
export async function call(
  onDone: (success: boolean) => void,
): Promise<React.ReactNode> {
  if (!isFeatureOn()) {
    onDone(false)
    return React.createElement(
      Text,
      { color: getPalette().state.warning },
      'ChatGPT subscription auth is disabled. Enable with VOID_FEATURE_FLAGS=CHATGPT_SUBSCRIPTION_AUTH.',
    )
  }
  return React.createElement(ChatgptLoginFlow, { onDone })
}
