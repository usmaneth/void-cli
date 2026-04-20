/**
 * /deliberate command — Multi-model Deliberation Room.
 *
 * Usage:
 *   /deliberate <topic>
 *   /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o --rounds 3 <topic>
 *   /deliberate --duo <topic>
 */
import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useInput } from '../../ink.js'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import type {
  DeliberationConfig,
  DeliberationState,
} from '../../deliberation/types.js'
import type { DeliberationCallbacks } from '../../deliberation/engine.js'
import { runDeliberation } from '../../deliberation/engine.js'
import { launchVoidex } from '../../utils/voidexLauncher.js'
import {
  DeliberationRenderer,
  type ModelStatus,
} from '../../deliberation/renderer.js'
import {
  extractFriendlyModelsFromText,
  resolveFriendlyModelInput,
} from '../../utils/model/friendlyModelResolver.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

// ── Default models for quick presets ────────────────────────────────────────

const DUO_MODELS = [
  'claude-sonnet-4-6',
  'openai/gpt-4o',
]

const DEFAULT_MODELS = DUO_MODELS

const DEFAULT_ROUNDS = 5

// ── Format helpers ──────────────────────────────────────────────────────────

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(5)}`
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function cleanNaturalLanguageTopic(input: string): string {
  return input
    .replace(/\b(?:use|have|let|with|get|make|between|compare|versus|vs)\b/gi, ' ')
    .replace(
      /\b(?:to\s+(?:debate|discuss|deliberate|argue|talk|compare)|(?:debate|discuss|deliberate|argue|talk|compare)\s+(?:about|on|whether|if)?|(?:about|on|whether|if)\b)\s*/gi,
      ' ',
    )
    .replace(/\b\d{1,2}\s*rounds?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Try to extract model names from natural language input.
 * Looks for patterns like "use opus and glm 5.1 to debate X"
 * or "have gemini and gpt-4o discuss Y".
 *
 * Returns matched models and the remaining text (the topic).
 */
function extractModelsFromNaturalLanguage(
  input: string,
): { models: string[]; topic: string } | null {
  const connectorPattern = /\b(?:use|have|let|with|get|make|between)\b/i
  const topicSplitter = /\b(?:to\s+(?:debate|discuss|deliberate|argue|talk)|(?:debate|discuss|deliberate|argue)\s+(?:about|on|whether|if)?|(?:about|on|whether|if)\b)/i

  if (!connectorPattern.test(input)) return null

  const splitMatch = topicSplitter.exec(input)
  if (splitMatch) {
    const modelSection = input.slice(0, splitMatch.index)
    const topicSection = input.slice(splitMatch.index + splitMatch[0].length).trim()
    const extracted = extractFriendlyModelsFromText(modelSection)
    if (extracted.models.length >= 2 && topicSection) {
      return { models: extracted.models, topic: topicSection }
    }
  }

  const extracted = extractFriendlyModelsFromText(input)
  const topic = cleanNaturalLanguageTopic(extracted.remainingText)
  if (extracted.models.length >= 2 && topic) {
    return { models: extracted.models, topic }
  }

  return null
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  topic: string
  models: string[]
  rounds: number
  hasModelOverride: boolean
  hasRoundOverride: boolean
  duo: boolean
}

function parseArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/)
  let models = DEFAULT_MODELS
  let rounds = DEFAULT_ROUNDS
  let hasModelOverride = false
  let hasRoundOverride = false
  const topicParts: string[] = []
  let isDuo = false

  // First: check for --flags (they take priority)
  let hasFlags = false
  for (const t of tokens) {
    if (t.startsWith('--')) { hasFlags = true; break }
  }

  if (hasFlags) {
    // Flag-based parsing (original behavior)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      if (token === '--models' && tokens[i + 1]) {
        models = tokens[i + 1]!
          .split(',')
          .map(m => resolveFriendlyModelInput(m.trim()) ?? m.trim())
          .filter(Boolean)
        hasModelOverride = true
        i++
      } else if (token === '--rounds' && tokens[i + 1]) {
        rounds = Math.max(1, Math.min(20, parseInt(tokens[i + 1]!, 10) || DEFAULT_ROUNDS))
        hasRoundOverride = true
        i++
      } else if (token === '--duo') {
        isDuo = true
      } else {
        topicParts.push(token)
      }
    }
    if (isDuo) {
      models = DUO_MODELS
    }
  } else {
    // Natural language parsing: try to extract models from conversational input
    const nlResult = extractModelsFromNaturalLanguage(args.trim())
    if (nlResult) {
      models = nlResult.models
      hasModelOverride = true
      topicParts.push(nlResult.topic)
    } else {
      // Fallback: no models detected, entire input is the topic
      topicParts.push(args.trim())
    }
  }

  // Check for round hints in natural language (e.g. "3 rounds", "for 5 rounds")
  if (!hasRoundOverride) {
    const roundMatch = args.match(/\b(\d{1,2})\s*rounds?\b/i)
    if (roundMatch) {
      rounds = Math.max(1, Math.min(20, parseInt(roundMatch[1]!, 10)))
      hasRoundOverride = true
    }
  }

  return {
    topic: topicParts.join(' '),
    models,
    rounds,
    hasModelOverride,
    hasRoundOverride,
    duo: isDuo,
  }
}

// ── Deliberation Runner Component ───────────────────────────────────────────

interface DeliberationRunnerProps {
  config: DeliberationConfig
  onDone: LocalJSXCommandOnDone
}

function DeliberationRunner({
  config,
  onDone,
}: DeliberationRunnerProps): React.ReactNode {
  const [state, setState] = useState<DeliberationState | null>(null)
  const [modelStatuses, setModelStatuses] = useState<Map<string, ModelStatus>>(
    () => new Map(config.models.map((m) => [m, 'waiting' as ModelStatus])),
  )
  const [streamingContent, setStreamingContent] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [currentModel, setCurrentModel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const callbacks: DeliberationCallbacks = {
      onRoundStart(round, maxRounds) {
        if (cancelled) return
        setState((prev) =>
          prev
            ? { ...prev, currentRound: round }
            : {
                config,
                rounds: [],
                currentRound: round,
                status: 'running',
                totalCostUSD: 0,
                humanInjections: [],
              },
        )
        // Reset model statuses for the new round
        setModelStatuses(
          new Map(config.models.map((m) => [m, 'waiting' as ModelStatus])),
        )
        setStreamingContent(new Map())
      },

      onModelStart(model) {
        if (cancelled) return
        setCurrentModel(model)
        setModelStatuses((prev) => {
          const next = new Map(prev)
          next.set(model, 'streaming')
          return next
        })
        setStreamingContent((prev) => {
          const next = new Map(prev)
          next.set(model, '')
          return next
        })
      },

      onModelChunk(model, chunk) {
        if (cancelled) return
        setStreamingContent((prev) => {
          const next = new Map(prev)
          next.set(model, (next.get(model) ?? '') + chunk)
          return next
        })
      },

      onModelComplete(response) {
        if (cancelled) return
        const isError = response.content.startsWith('[Error:')
        setModelStatuses((prev) => {
          const next = new Map(prev)
          next.set(response.model, isError ? 'error' : 'done')
          return next
        })
        setCurrentModel(null)
      },

      onRoundComplete(round) {
        if (cancelled) return
        setState((prev) => {
          if (!prev) return prev
          const totalCost = [...prev.rounds, round].reduce(
            (sum, r) => sum + r.responses.reduce((s, resp) => s + resp.costUSD, 0),
            0,
          )
          return {
            ...prev,
            rounds: [...prev.rounds, round],
            totalCostUSD: totalCost,
          }
        })
        setStreamingContent(new Map())
      },

      onConverged(round) {
        if (cancelled) return
        setState((prev) => (prev ? { ...prev, status: 'converged' } : prev))
      },

      onComplete(finalState) {
        if (cancelled) return
        setState(finalState)
        const totalTokens = finalState.rounds.reduce(
          (sum, r) =>
            sum +
            r.responses.reduce(
              (s, resp) => s + resp.tokens.input + resp.tokens.output,
              0,
            ),
          0,
        )
        // Detect if models failed and surface actionable errors
        const errorModels = new Set<string>()
        for (const r of finalState.rounds) {
          for (const resp of r.responses) {
            if (resp.content.startsWith('[Error:')) {
              errorModels.add(resp.model)
            }
          }
        }
        const allErrors = finalState.rounds.length > 0 && finalState.rounds.every(r =>
          r.responses.every(resp => resp.tokens.output === 0 || resp.content.startsWith('[Error:')),
        )

        let summary =
          `Deliberation complete: ${finalState.rounds.length} round(s), ` +
          `${formatUSD(finalState.totalCostUSD)} total, ` +
          `${formatTokens(totalTokens)} tokens, ` +
          `status: ${finalState.status}`

        if (allErrors) {
          const errorDetails: string[] = []
          for (const round of finalState.rounds) {
            for (const resp of round.responses) {
              if (resp.content.startsWith('[Error:')) {
                const detail = `  ${resp.model}: ${resp.content}`
                if (!errorDetails.includes(detail)) {
                  errorDetails.push(detail)
                }
              }
            }
          }
          summary +=
            `\n\n⚠ All model calls failed. Check your API keys and auth configuration.` +
            `\nFailing models: ${[...errorModels].join(', ')}` +
            (errorDetails.length > 0 ? `\nErrors:\n${errorDetails.join('\n')}` : '') +
            `\nTip: Set ANTHROPIC_API_KEY for Claude models, or use OpenRouter model names (e.g. anthropic/claude-sonnet-4)`
        } else if (errorModels.size > 0) {
          summary += `\n\n⚠ Some models failed: ${[...errorModels].join(', ')}`
        }

        onDone(summary, { display: 'system' })
      },
    }

    // Initialize state
    setState({
      config,
      rounds: [],
      currentRound: 0,
      status: 'running',
      totalCostUSD: 0,
      humanInjections: [],
    })

    runDeliberation(config, callbacks).catch((err) => {
      if (!cancelled) {
        onDone(`Deliberation error: ${err.message ?? String(err)}`, {
          display: 'system',
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+S: save transcript to file
  const stateRef = useRef(state)
  stateRef.current = state

  useInput((_input, key) => {
    if (key.ctrl && _input === 's' && stateRef.current) {
      const s = stateRef.current
      const lines: string[] = [
        `# Deliberation Transcript`,
        `Topic: ${s.config.topic}`,
        `Models: ${s.config.models.join(', ')}`,
        `Status: ${s.status}`,
        `Total cost: $${s.totalCostUSD.toFixed(4)}`,
        '',
      ]
      for (const round of s.rounds) {
        lines.push(`## Round ${round.number}${round.converged ? ' (converged)' : ''}`)
        lines.push('')
        for (const resp of round.responses) {
          lines.push(`### ${resp.model}`)
          lines.push(`_${resp.latencyMs}ms · ${resp.tokens.input}↑ ${resp.tokens.output}↓ · $${resp.costUSD.toFixed(4)}_`)
          lines.push('')
          lines.push(resp.content)
          lines.push('')
        }
      }
      const filename = `deliberation-${Date.now()}.md`
      const dir = join(process.cwd(), '.void')
      void mkdir(dir, { recursive: true }).then(() =>
        writeFile(join(dir, filename), lines.join('\n'))
      )
    }
  })

  return (
    <DeliberationRenderer
      state={state}
      modelStatuses={modelStatuses}
      streamingContent={streamingContent}
      currentModel={currentModel}
    />
  )
}

// ── Command entry point ─────────────────────────────────────────────────────

function extractGuiFlag(input: string): { input: string; gui: boolean } {
  const tokens = (input || '').split(/\s+/)
  const filtered: string[] = []
  let gui = false
  for (const t of tokens) {
    if (t === '--gui' || t === '-g') gui = true
    else filtered.push(t)
  }
  return { input: filtered.join(' ').trim(), gui }
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const stripped = extractGuiFlag(args)
  if (stripped.gui) {
    // /deliberate --gui hands off to Voidex without disturbing the TUI flow.
    const result = launchVoidex({
      mode: 'deliberate',
      prompt: stripped.input,
      cwd: process.env.VOID_LAUNCH_CWD || process.cwd(),
    })
    onDone(
      result.ok
        ? `Opened Voidex in deliberate mode${stripped.input ? ' with your topic' : ''}.`
        : `Failed to open Voidex: ${result.error}`,
      { display: 'system' },
    )
    return null
  }

  const parsed = parseArgs(stripped.input)
  const settings = getSettingsForSource('userSettings')
  const deliberationSettings = settings?.deliberation

  if (!parsed.topic) {
    onDone(
      'Usage: /deliberate <topic> [--models m1,m2] [--rounds N] [--duo]\n' +
        '\n' +
        'Examples:\n' +
        '  /deliberate Should we use microservices or a monolith?\n' +
        '  /deliberate use opus 4.6 and glm 5.1 to debate whether Rust or Go is better for CLIs\n' +
        '  /deliberate have gemini and gpt 4o discuss the best approach to error handling\n' +
        '  /deliberate --duo What is the best approach to error handling in Rust?\n' +
        '  /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o --rounds 3 Is TDD worth it?',
      { display: 'system' },
    )
    return null
  }

  const config: DeliberationConfig = {
    topic: parsed.topic,
    models:
      parsed.duo || parsed.hasModelOverride
        ? parsed.models
        : (deliberationSettings?.defaultModels?.filter(Boolean) ?? DEFAULT_MODELS),
    maxRounds:
      parsed.hasRoundOverride
        ? parsed.rounds
        : (deliberationSettings?.maxRounds ?? DEFAULT_ROUNDS),
    autoStop: deliberationSettings?.autoStop ?? true,
    showTokenUsage: deliberationSettings?.showTokenUsage ?? true,
  }

  return <DeliberationRunner config={config} onDone={onDone} />
}
