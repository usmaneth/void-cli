import { registerBundledSkill } from '../bundledSkills.js'

export function registerDesignSkill(): void {
  registerBundledSkill({
    name: 'design',
    description:
      'Gemini-powered frontend design specialist. Creates beautiful, modern, production-grade UI components with exceptional visual quality.',
    aliases: ['designer', 'fronty'],
    whenToUse:
      'Visual improvement requests, UI redesigns, design-first mockups, or when the user wants beautiful/polished/modern/premium interfaces. Trigger on: "make it look better", "redesign", "10x the UI", "beautiful", "polished", editing .tsx with layout work',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text' as const,
          text: `The user wants the designer agent to work on: "${args}"\n\nLaunch the designer agent (Gemini 3.1 Pro) using Agent tool with subagent_type="designer". The designer reads existing components and design tokens, then writes beautiful production-grade UI code. You handle types, state, and testing after.`,
        },
      ]
    },
  })
}
