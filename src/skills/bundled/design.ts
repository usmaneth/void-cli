import { registerBundledSkill } from '../bundledSkills.js'

export function registerDesignSkill(): void {
  registerBundledSkill({
    name: 'design',
    description:
      'Gemini-powered frontend design specialist. Creates beautiful, modern, production-grade UI components with exceptional visual quality.',
    aliases: ['designer', 'fronty'],
    whenToUse:
      'Visual improvement requests, UI redesigns, design-first mockups, or when the user wants beautiful/polished/modern/premium interfaces. Trigger on: "make it look better", "redesign", "10x the UI", "beautiful", "polished", editing .tsx with layout work',
    userInvocable: false,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text' as const,
          text: `This looks like a design task. Suggest the user run: /design ${args}\n\nThe /design command launches the Gemini 3.1 Pro designer agent for beautiful, production-grade UI work.`,
        },
      ]
    },
  })
}
