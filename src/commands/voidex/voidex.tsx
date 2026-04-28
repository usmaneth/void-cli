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
import { getPalette } from '../../theme/index.js'

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

type Phase = 'launching' | 'ready' | 'error'

function VoidexLauncher({
  args,
  onDone,
}: {
  args: VoidexArgs
  onDone: LocalJSXCommandOnDone
}) {
  const palette = getPalette()
  const [phase, setPhase] = useState<Phase>('launching')
  const [detail, setDetail] = useState<string>('')

  useEffect(() => {
    const opts: VoidexLaunchOptions = {
      mode: args.mode,
      prompt: args.prompt || undefined,
      model: args.model,
      models: args.models,
      rounds: args.rounds,
      cwd: process.env.VOID_LAUNCH_CWD || process.cwd(),
    }
    const result = launchVoidex(opts)
    if (!result.ok) {
      setDetail(result.error || 'Failed to launch Voidex.')
      setPhase('error')
      setTimeout(
        () =>
          onDone(result.error || 'Failed to launch Voidex.', {
            display: 'system',
          }),
        400,
      )
      return
    }
    setDetail(`pid ${result.pid} — ${result.appPath}`)
    setPhase('ready')
    setTimeout(
      () => onDone(`Opened Voidex (${args.mode}).`, { display: 'system' }),
      400,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color={palette.state.failure}>Voidex failed to launch</Text>
        <Text dimColor>{detail}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text>Opening Voidex…</Text>
      <Text dimColor>
        mode: {args.mode}
        {args.model ? ` · model: ${args.model}` : ''}
        {args.models?.length ? ` · models: ${args.models.join(', ')}` : ''}
      </Text>
      {detail ? <Text dimColor>{detail}</Text> : null}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, rawArgs) => {
  const args = parseArgs(rawArgs || '')
  return <VoidexLauncher args={args} onDone={onDone} />
}
