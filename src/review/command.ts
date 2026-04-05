import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'
import {
  DiffParser,
  DiffFormatter,
  ReviewSession,
  type DiffFilter,
} from './index.js'

/**
 * Build a human-readable diff review report for the given sub-command.
 *
 * Sub-commands:
 *   (empty)           — review unstaged changes
 *   staged            — review staged changes
 *   branch <name>     — review changes vs a branch
 *   summary           — compact summary only
 *   file <path>       — review a single file
 *   side-by-side      — side-by-side view
 */
async function buildReviewContent(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] ?? ''
  const session = new ReviewSession()
  const formatter = new DiffFormatter()

  switch (subcommand) {
    case '':
      // Default: review unstaged changes
      await session.loadFromGit()
      break

    case 'staged':
      await session.loadFromStaged()
      break

    case 'branch': {
      const branchName = parts[1]
      if (!branchName) {
        return 'Usage: /diff-review branch <branch-name>'
      }
      await session.loadFromBranch(branchName)
      break
    }

    case 'summary': {
      // May combine with staged, branch, etc. For now default to unstaged.
      await session.loadFromGit()
      if (session.entries.length === 0) {
        return 'No changes found.'
      }
      return formatter.formatSummary(session.entries)
    }

    case 'file': {
      const filePath = parts[1]
      if (!filePath) {
        return 'Usage: /diff-review file <path>'
      }
      await session.loadFromGit()
      const filtered = session.filter({ files: [filePath] })
      if (filtered.length === 0) {
        // Try staged
        await session.loadFromStaged()
        const stagedFiltered = session.filter({ files: [filePath] })
        if (stagedFiltered.length === 0) {
          return `No changes found for file: ${filePath}`
        }
        return formatter.formatUnified(stagedFiltered)
      }
      return formatter.formatUnified(filtered)
    }

    case 'side-by-side': {
      await session.loadFromGit()
      if (session.entries.length === 0) {
        return 'No changes found.'
      }
      const width = process.stdout.columns ?? 120
      return formatter.formatSideBySide(session.entries, width)
    }

    default:
      return [
        'Unknown sub-command. Available options:',
        '  /diff-review            — review unstaged changes',
        '  /diff-review staged     — review staged changes',
        '  /diff-review branch <n> — review changes vs a branch',
        '  /diff-review summary    — compact summary only',
        '  /diff-review file <p>   — review a single file',
        '  /diff-review side-by-side — side-by-side view',
      ].join('\n')
  }

  // Default rendering for non-summary sub-commands
  if (session.entries.length === 0) {
    return 'No changes found.'
  }

  const summaryText = formatter.formatSummary(session.entries)
  const unifiedText = formatter.formatUnified(session.entries)

  return [
    '## Diff Review',
    '',
    '### Summary',
    summaryText,
    '',
    '### Changes',
    unifiedText,
  ].join('\n')
}

const diffReview: Command = {
  type: 'prompt',
  name: 'diff-review',
  description:
    'Review multi-file diffs in a unified multibuffer view (unstaged, staged, branch, summary, file, side-by-side)',
  progressMessage: 'reviewing diffs',
  contentLength: 0,
  source: 'builtin',
  argumentHint: '[staged | branch <name> | summary | file <path> | side-by-side]',
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    const content = await buildReviewContent(args)

    return [
      {
        type: 'text',
        text: [
          'Here is a diff review of the current repository changes. Please analyse the changes and provide feedback.',
          '',
          '```',
          content,
          '```',
          '',
          'Please review the above diff and provide:',
          '1. A brief summary of the changes',
          '2. Any potential issues, bugs, or improvements',
          '3. Comments on code quality, style, and conventions',
          '4. Any security or performance concerns',
        ].join('\n'),
      },
    ]
  },
}

export default diffReview
