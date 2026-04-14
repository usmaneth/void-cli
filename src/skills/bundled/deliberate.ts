import { registerBundledSkill } from '../bundledSkills.js'

export function registerDeliberateSkill(): void {
  registerBundledSkill({
    name: 'deliberate',
    description:
      'Multi-model deliberation for hard decisions. 2-3 models debate sequentially, challenging assumptions to converge on the best solution.',
    aliases: ['debate', 'discuss'],
    whenToUse:
      'Architecture decisions, tradeoff discussions, design pattern selection, or when the user is stuck choosing between approaches. Trigger on: "should we X or Y?", "best approach", "tradeoffs", "pros and cons", "which one"',
    userInvocable: false,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text' as const,
          text: `This looks like a good candidate for multi-model deliberation. Suggest the user run: /deliberate ${args}\n\nThe /deliberate command starts a live debate room where 2-3 models challenge each other's ideas across rounds.`,
        },
      ]
    },
  })
}
