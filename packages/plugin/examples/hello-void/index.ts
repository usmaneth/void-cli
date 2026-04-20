/**
 * hello-void — the canonical @void-cli/plugin example.
 *
 * Contributes:
 *   - A tool `HelloTool` that greets by name.
 *   - A skill `/hello` that produces a greeting prompt.
 *   - A keybind (ctrl+shift+h) that logs a message.
 *
 * Drop this file into `~/.void/plugins/hello-void/index.ts` or list the
 * package in your settings.json `plugins` array.
 */

import {
  defineKeybind,
  definePlugin,
  defineSkill,
  defineTool,
  onSessionStart,
} from '@void-cli/plugin'
import { z } from 'zod'

const HelloTool = defineTool({
  name: 'Hello',
  description: 'Say hello to someone by name.',
  parameters: z.object({
    who: z.string().describe("The person's name."),
    shout: z.boolean().optional().describe('Uppercase the greeting.'),
  }),
  readOnly: true,
  async execute({ who, shout }) {
    const message = `Hello, ${who}!`
    return shout ? message.toUpperCase() : message
  },
})

const HelloSkill = defineSkill({
  name: 'hello',
  description: 'Draft a friendly greeting.',
  whenToUse: 'Use when the user asks to "say hi" or draft a welcome message.',
  argumentHint: '[name]',
  async handler({ args }) {
    const who = args.trim() || 'there'
    return `Please write a warm, brief greeting for ${who}.`
  },
})

const HelloBind = defineKeybind({
  key: 'ctrl+shift+h',
  label: 'Greet from hello-void',
  when: 'repl',
  action() {
    // eslint-disable-next-line no-console
    console.log('[hello-void] 👋')
  },
})

export default definePlugin({
  name: 'hello-void',
  version: '0.1.0',
  tools: [HelloTool],
  skills: [HelloSkill],
  keybinds: [HelloBind],
  hooks: {
    onSessionStart: onSessionStart(({ sessionId }) => {
      // eslint-disable-next-line no-console
      console.log(`[hello-void] session started: ${sessionId}`)
    }),
  },
  init({ logger }) {
    logger.info('hello-void plugin initialized')
  },
})
