import { registerBundledSkill } from '../bundledSkills.js'

export function registerSwarmSkill(): void {
  registerBundledSkill({
    name: 'swarm',
    description:
      'Multi-model parallel implementation. Different models build different parts of the codebase simultaneously in isolated worktrees.',
    aliases: ['crew', 'team'],
    whenToUse:
      'Multi-layer features with clear frontend/backend/data separation, large features with 3+ independent components, or full-stack tasks. Trigger on: "build X with Y and Z", "full feature", "from scratch", "end to end"',
    userInvocable: false,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text' as const,
          text: `This task looks like a great candidate for swarm mode. Suggest the user run: /swarm ${args}\n\nThe /swarm command decomposes tasks into parallel workstreams with different models, shows real-time progress, and merges results automatically.`,
        },
      ]
    },
  })
}
