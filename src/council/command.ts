/**
 * Council slash command handler.
 *
 * /council on              — Activate council mode (duo preset)
 * /council off             — Deactivate council mode
 * /council preset <name>   — Switch preset (duo, trinity, full, open-source)
 * /council status          — Show current config
 * /council method <method> — Set consensus method (leader-picks, voting, longest, first)
 * /council ask <prompt>    — One-shot council query with all members
 * /council add <model>     — Add a model to the council
 * /council remove <id>     — Remove a member by ID
 * /council list            — List available presets
 */
import {
  activatePreset,
  addCouncilMember,
  COUNCIL_PRESETS,
  deactivateCouncil,
  getCouncilConfig,
  isCouncilActive,
  removeCouncilMember,
  setCouncilConfig,
} from './config.js'
import { queryCouncil } from './orchestrator.js'
import type { CouncilMember, ConsensusMethod } from './types.js'

export type CouncilCommandResult = {
  output: string
  isError?: boolean
}

/**
 * Parse and execute a /council command.
 *
 * @param args The arguments after "/council" (e.g., "on", "preset duo", "ask what is 2+2")
 * @returns A result with output text to display
 */
export async function handleCouncilCommand(
  args: string,
): Promise<CouncilCommandResult> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? 'status'
  const rest = parts.slice(1).join(' ')

  switch (subcommand) {
    case 'on':
    case 'enable':
    case 'activate': {
      const preset = rest || 'duo'
      try {
        const config = activatePreset(preset)
        const memberList = config.members
          .map((m) => `  ${m.name} (${m.model})`)
          .join('\n')
        return {
          output: `⚡ Council activated with "${preset}" preset:\n${memberList}\n\nConsensus: ${config.consensusMethod}`,
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    case 'off':
    case 'disable':
    case 'deactivate': {
      deactivateCouncil()
      return { output: 'Council mode deactivated.' }
    }

    case 'preset': {
      if (!rest) {
        const presets = Object.entries(COUNCIL_PRESETS)
          .map(
            ([key, p]) =>
              `  ${key}: ${p.description} (${p.members.length} members)`,
          )
          .join('\n')
        return { output: `Available presets:\n${presets}` }
      }
      try {
        const config = activatePreset(rest)
        const memberList = config.members
          .map((m) => `  ${m.name} (${m.model})`)
          .join('\n')
        return {
          output: `⚡ Council preset "${rest}" activated:\n${memberList}`,
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    case 'status':
    case 'info': {
      const config = getCouncilConfig()
      const active = isCouncilActive()
      const memberList = config.members
        .map(
          (m) =>
            `  ${m.id}: ${m.name} (${m.model}) [weight: ${m.weight}${m.canExecuteTools ? ', tools' : ''}]`,
        )
        .join('\n')
      return {
        output: [
          `Council Mode: ${active ? '⚡ ACTIVE' : '○ Inactive'}`,
          `Preset: ${config.preset}`,
          `Consensus: ${config.consensusMethod}`,
          `Timeout: ${config.memberTimeoutMs}ms`,
          `Show All: ${config.showAllResponses}`,
          `Members:\n${memberList}`,
        ].join('\n'),
      }
    }

    case 'method': {
      const validMethods: ConsensusMethod[] = [
        'leader-picks',
        'voting',
        'longest',
        'first',
      ]
      if (!rest || !validMethods.includes(rest as ConsensusMethod)) {
        return {
          output: `Available methods: ${validMethods.join(', ')}\nCurrent: ${getCouncilConfig().consensusMethod}`,
        }
      }
      setCouncilConfig({ consensusMethod: rest as ConsensusMethod })
      return { output: `Consensus method set to: ${rest}` }
    }

    case 'ask':
    case 'query': {
      if (!rest) {
        return { output: 'Usage: /council ask <prompt>', isError: true }
      }

      const config = getCouncilConfig()
      if (!config.enabled || config.members.length === 0) {
        // Auto-activate with duo preset if not active
        activatePreset('duo')
      }

      try {
        const result = await queryCouncil(rest)
        const responseSummaries = result.responses
          .map((r) => {
            const isWinner = r.memberId === result.winner.memberId
            const prefix = isWinner ? '★' : ' '
            const preview =
              r.content.split('\n').slice(0, 5).join('\n  ') ||
              '(empty response)'
            return `${prefix} ${r.memberName} (${formatMs(r.latencyMs)}, ${formatUSD(r.costUSD)}):\n  ${preview}`
          })
          .join('\n\n')

        return {
          output: [
            `⚡ Council Results (${result.method}):`,
            '',
            responseSummaries,
            '',
            `─── Winner: ${result.winner.memberName} ───`,
            `Total: ${formatMs(result.totalLatencyMs)} · ${formatUSD(result.totalCostUSD)}`,
          ].join('\n'),
        }
      } catch (e: any) {
        return { output: `Council error: ${e.message}`, isError: true }
      }
    }

    case 'add': {
      if (!rest) {
        return {
          output: 'Usage: /council add <model> (e.g., openai/gpt-4o)',
          isError: true,
        }
      }
      const model = rest.trim()
      const id = model.split('/').pop()?.replace(/[^a-z0-9]/gi, '-') ?? model
      const name = id.charAt(0).toUpperCase() + id.slice(1)
      const member: CouncilMember = {
        id,
        name,
        model,
        provider: model.startsWith('anthropic/') ? 'anthropic' : 'openrouter',
        weight: 0.8,
        canExecuteTools: false,
      }
      addCouncilMember(member)
      return { output: `Added ${name} (${model}) to the council.` }
    }

    case 'remove': {
      if (!rest) {
        const members = getCouncilConfig()
          .members.map((m) => `  ${m.id}: ${m.name}`)
          .join('\n')
        return {
          output: `Usage: /council remove <id>\n\nMembers:\n${members}`,
          isError: true,
        }
      }
      removeCouncilMember(rest.trim())
      return { output: `Removed member "${rest.trim()}" from the council.` }
    }

    case 'list':
    case 'presets': {
      const presets = Object.entries(COUNCIL_PRESETS)
        .map(([key, p]) => {
          const members = p.members
            .map((m) => `    ${m.name} (${m.model})`)
            .join('\n')
          return `  ${key}: ${p.description}\n${members}`
        })
        .join('\n\n')
      return { output: `Available presets:\n\n${presets}` }
    }

    default:
      return {
        output: [
          'Council commands:',
          '  /council on [preset]      — Activate (default: duo)',
          '  /council off              — Deactivate',
          '  /council preset <name>    — Switch preset',
          '  /council status           — Show config',
          '  /council method <method>  — Set consensus method',
          '  /council ask <prompt>     — Query all members',
          '  /council add <model>      — Add a model',
          '  /council remove <id>      — Remove a member',
          '  /council list             — List presets',
        ].join('\n'),
      }
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatUSD(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}
