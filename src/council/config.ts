/**
 * Council Mode configuration and presets.
 */
import type { CouncilConfig, CouncilMember, CouncilPreset } from './types.js'

// Default council presets
export const COUNCIL_PRESETS: Record<string, CouncilPreset> = {
  'duo': {
    name: 'Duo',
    description: 'Claude + GPT-4o for quick second opinions',
    members: [
      {
        id: 'claude',
        name: 'Claude',
        model: 'anthropic/claude-sonnet-4',
        provider: 'anthropic',
        weight: 1,
        canExecuteTools: true,
        role: 'Primary reasoning model',
      },
      {
        id: 'gpt4o',
        name: 'GPT-4o',
        model: 'openai/gpt-4o',
        provider: 'openrouter',
        weight: 0.8,
        canExecuteTools: false,
        role: 'Second opinion',
      },
    ],
  },
  'trinity': {
    name: 'Trinity',
    description: 'Claude + GPT-4o + Gemini for diverse perspectives',
    members: [
      {
        id: 'claude',
        name: 'Claude',
        model: 'anthropic/claude-sonnet-4',
        provider: 'anthropic',
        weight: 1,
        canExecuteTools: true,
        role: 'Primary reasoning model',
      },
      {
        id: 'gpt4o',
        name: 'GPT-4o',
        model: 'openai/gpt-4o',
        provider: 'openrouter',
        weight: 0.8,
        canExecuteTools: false,
        role: 'Code review and alternatives',
      },
      {
        id: 'gemini',
        name: 'Gemini Pro',
        model: 'google/gemini-2.5-pro-preview',
        provider: 'openrouter',
        weight: 0.7,
        canExecuteTools: false,
        role: 'Architecture and patterns',
      },
    ],
  },
  'full': {
    name: 'Full Council',
    description: 'Five models for comprehensive analysis',
    members: [
      {
        id: 'claude-opus',
        name: 'Claude Opus',
        model: 'anthropic/claude-opus-4',
        provider: 'anthropic',
        weight: 1,
        canExecuteTools: true,
        role: 'Deep reasoning lead',
      },
      {
        id: 'claude-sonnet',
        name: 'Claude Sonnet',
        model: 'anthropic/claude-sonnet-4',
        provider: 'anthropic',
        weight: 0.9,
        canExecuteTools: true,
        role: 'Fast implementation',
      },
      {
        id: 'gpt4o',
        name: 'GPT-4o',
        model: 'openai/gpt-4o',
        provider: 'openrouter',
        weight: 0.8,
        canExecuteTools: false,
        role: 'Alternative approaches',
      },
      {
        id: 'gemini',
        name: 'Gemini Pro',
        model: 'google/gemini-2.5-pro-preview',
        provider: 'openrouter',
        weight: 0.7,
        canExecuteTools: false,
        role: 'Broad knowledge base',
      },
      {
        id: 'llama',
        name: 'Llama 4',
        model: 'meta-llama/llama-4-maverick',
        provider: 'openrouter',
        weight: 0.6,
        canExecuteTools: false,
        role: 'Open-source perspective',
      },
    ],
  },
  'open-source': {
    name: 'Open Source',
    description: 'All open-source models via OpenRouter',
    members: [
      {
        id: 'llama',
        name: 'Llama 4',
        model: 'meta-llama/llama-4-maverick',
        provider: 'openrouter',
        weight: 1,
        canExecuteTools: false,
        role: 'Lead open-source model',
      },
      {
        id: 'qwen',
        name: 'Qwen 3',
        model: 'qwen/qwen3-235b-a22b',
        provider: 'openrouter',
        weight: 0.9,
        canExecuteTools: false,
        role: 'Code specialist',
      },
      {
        id: 'deepseek',
        name: 'DeepSeek V3',
        model: 'deepseek/deepseek-chat-v3-0324',
        provider: 'openrouter',
        weight: 0.85,
        canExecuteTools: false,
        role: 'Reasoning model',
      },
    ],
  },
}

const DEFAULT_CONFIG: CouncilConfig = {
  enabled: false,
  preset: 'duo',
  members: COUNCIL_PRESETS['duo']!.members,
  consensusMethod: 'leader-picks',
  memberTimeoutMs: 60_000,
  showAllResponses: true,
  leaderPicks: true,
  tiebreaker: 'leader',
  unanimousMaxRetries: 2,
}

let currentConfig: CouncilConfig = { ...DEFAULT_CONFIG }

export function getCouncilConfig(): CouncilConfig {
  return currentConfig
}

export function setCouncilConfig(config: Partial<CouncilConfig>): void {
  currentConfig = { ...currentConfig, ...config }
}

export function activatePreset(presetName: string): CouncilConfig {
  const preset = COUNCIL_PRESETS[presetName]
  if (!preset) {
    throw new Error(
      `Unknown council preset: ${presetName}. Available: ${Object.keys(COUNCIL_PRESETS).join(', ')}`,
    )
  }
  currentConfig = {
    ...currentConfig,
    enabled: true,
    preset: presetName,
    members: preset.members,
  }
  return currentConfig
}

export function deactivateCouncil(): void {
  currentConfig = { ...currentConfig, enabled: false }
}

export function isCouncilActive(): boolean {
  return currentConfig.enabled && currentConfig.members.length > 1
}

export function addCouncilMember(member: CouncilMember): void {
  currentConfig = {
    ...currentConfig,
    preset: 'custom',
    members: [...currentConfig.members, member],
  }
}

export function removeCouncilMember(memberId: string): void {
  currentConfig = {
    ...currentConfig,
    preset: 'custom',
    members: currentConfig.members.filter(m => m.id !== memberId),
  }
}
