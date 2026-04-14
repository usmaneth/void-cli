/**
 * /design slash command
 *
 * Dispatches the Gemini Designer Agent for visual improvement tasks.
 *
 * Usage:
 *   /design <topic>       — design-first mode: build or redesign UI
 *   /design --review      — review existing UI for design improvements
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../../commands.js'
import { assembleDesignContext } from '../../agents/designer/context.js'

function buildDesignPrompt(topic: string, context: string): string {
  return [
    'Use the designer agent to complete this task.',
    '',
    '## Design Request',
    topic,
    '',
    '## Project Design Context',
    context,
    '',
    'Dispatch the designer agent with the above request and context.',
  ].join('\n')
}

function buildReviewPrompt(context: string): string {
  return [
    'Use the designer agent to review the current UI for design improvements.',
    '',
    '## Review Request',
    'Audit the existing components for:',
    '- Visual quality and polish',
    '- Animation and micro-interaction gaps',
    '- Dark mode correctness',
    '- Spacing and typography consistency',
    '- Accessibility issues',
    '- Missing states (hover, focus, loading, empty, error)',
    '',
    'Provide specific, actionable improvements with code.',
    '',
    '## Project Design Context',
    context,
    '',
    'Dispatch the designer agent with the above review request and context.',
  ].join('\n')
}

function formatDesignContext(ctx: {
  designTokens: string | null
  existingComponents: Array<{ path: string; preview: string }>
  projectStack: string[]
}): string {
  const sections: string[] = []

  if (ctx.projectStack.length > 0) {
    sections.push(`**Stack:** ${ctx.projectStack.join(', ')}`)
  }

  if (ctx.designTokens) {
    sections.push(`**Design Tokens:**\n\`\`\`\n${ctx.designTokens}\n\`\`\``)
  }

  if (ctx.existingComponents.length > 0) {
    const list = ctx.existingComponents
      .slice(0, 10)
      .map((c) => `- \`${c.path}\``)
      .join('\n')
    sections.push(
      `**Existing Components (${ctx.existingComponents.length} found):**\n${list}`,
    )
  }

  return sections.length > 0 ? sections.join('\n\n') : '(no design context discovered)'
}

const design: Command = {
  type: 'prompt',
  name: 'design',
  description:
    'Dispatch the Gemini Designer Agent for beautiful, polished UI work',
  progressMessage: 'assembling design context',
  contentLength: 0,
  source: 'builtin',
  argumentHint: '<topic> | --review',
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    const cwd = process.cwd()
    const designCtx = await assembleDesignContext(cwd)
    const contextStr = formatDesignContext(designCtx)

    const trimmed = args.trim()
    const isReview = trimmed === '--review' || trimmed === '-r'

    const prompt = isReview
      ? buildReviewPrompt(contextStr)
      : buildDesignPrompt(trimmed || 'Improve the overall UI design', contextStr)

    return [{ type: 'text', text: prompt }]
  },
}

export default design
