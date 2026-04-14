import { registerBundledSkill } from '../bundledSkills.js'

export function registerDeliberateSkill(): void {
  registerBundledSkill({
    name: 'deliberate',
    description:
      'Multi-model deliberation for hard decisions. 2-3 models debate sequentially, challenging assumptions to converge on the best solution.',
    aliases: ['debate', 'discuss'],
    whenToUse:
      'Architecture decisions, tradeoff discussions, design pattern selection, or when the user is stuck choosing between approaches. Trigger on: "should we X or Y?", "best approach", "tradeoffs", "pros and cons", "which one"',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text' as const,
          text: `The user wants to start a multi-model deliberation on: "${args}"\n\nUse the /deliberate command to launch the deliberation room. If no specific models were requested, use defaults from settings or fall back to opus + the user's secondary model. Present the deliberation results and consensus when complete.`,
        },
      ]
    },
  })
}
