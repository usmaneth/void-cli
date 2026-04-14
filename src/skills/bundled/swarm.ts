import { registerBundledSkill } from '../bundledSkills.js'

export function registerSwarmSkill(): void {
  registerBundledSkill({
    name: 'swarm',
    description:
      'Multi-model parallel implementation. Different models build different parts of the codebase simultaneously in isolated worktrees.',
    aliases: ['crew', 'team'],
    whenToUse:
      'Multi-layer features with clear frontend/backend/data separation, large features with 3+ independent components, or full-stack tasks. Trigger on: "build X with Y and Z", "full feature", "from scratch", "end to end"',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text' as const,
          text: `The user wants swarm mode to build: "${args}"\n\nUse the /swarm command. The coordinator (Opus) will decompose the task into workstreams and assign models. Present the decomposition plan for user approval before launching workers.`,
        },
      ]
    },
  })
}
