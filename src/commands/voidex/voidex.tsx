/**
 * /voidex slash command — open Voidex, the Void desktop app.
 *
 * Usage:
 *   /voidex
 *   /voidex <prompt>
 *   /voidex --mode swarm --model opus <prompt>
 *   /voidex --mode deliberate --models sonnet,openai/gpt-4o <topic>
 *
 * Ported from PR #56 (claude/build-voidex-app-47ZMJ). The new Voidex app at
 * apps/voidex is a full electron-vite + electron-builder shell, but the
 * slash-command UX is intentionally unchanged.
 */
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Box, Text } from '../../ink.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import {
  launchVoidex,
  type VoidexLaunchOptions,
  type VoidexMode,
} from '../../utils/voidexLauncher.js'

type VoidexArgs = {
  mode: VoidexMode
  model?: string
  models?: string[]
  rounds?: number
  prompt: string
}

const MODES: readonly VoidexMode[] = ['chat', 'swarm', 'deliberate', 'plan']

function isMode(x: string): x is VoidexMode {
  return (MODES as readonly string[]).includes(x)
}

function parseArgs(input: string): VoidexArgs {
  const out: VoidexArgs = { mode: 'chat', prompt: '' }
  const parts: string[] = []
  const tokens = (input || '').trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--mode' && tokens[i + 1]) {
      const v = tokens[++i]
      if (isMode(v)) out.mode = v
    } else if (t === '--model' && tokens[i + 1]) {
      out.model = tokens[++i]
    } else if (t === '--models' && tokens[i + 1]) {
      out.models = tokens[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (t === '--rounds' && tokens[i + 1]) {
      const n = Number(tokens[++i])
      if (!Number.isNaN(n) && n > 0) out.rounds = n
    } else {
      parts.push(t)
    }
  }
  out.prompt = parts.join(' ')
  return out
}

interface Props {
  call: LocalJSXCommandCall
  onDone: LocalJSXCommandOnDone
}

const VoidexComponent: React.FC<Props> = ({ call, onDone }) => {
  const input = typeof call.args === 'string' ? call.args : ''
  const args = parseArgs(input)

  const [status, setStatus] = useState<
    | { phase: 'launching' }
    | { phase: 'launched'; pid?: number; appPath: string }
    | { phase: 'error'; error: string }
  >({ phase: 'launching' })

  useEffect(() => {
    const options: VoidexLaunchOptions = {
      mode: args.mode,
      prompt: args.prompt || undefined,
      model: args.model,
      models: args.models,
      rounds: args.rounds,
      cwd: process.cwd(),
    }
    const result = launchVoidex(options)
    if (result.ok) {
      setStatus({ phase: 'launched', pid: result.pid, appPath: result.appPath })
    } else {
      setStatus({ phase: 'error', error: result.error || 'unknown error' })
    }
    const t = setTimeout(
      () => onDone(result.ok ? 'Voidex launched.' : `Voidex launch failed: ${result.error}`),
      600,
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status.phase === 'launching') {
    return (
      <Box>
        <Text dimColor>Opening Voidex ({args.mode})…</Text>
      </Box>
    )
  }
  if (status.phase === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Voidex failed to launch: {status.error}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text>
        Voidex launched (mode=<Text bold>{args.mode}</Text>
        {status.pid ? `, pid=${status.pid}` : ''}).
      </Text>
      <Text dimColor>app: {status.appPath}</Text>
    </Box>
  )
}

export default VoidexComponent
