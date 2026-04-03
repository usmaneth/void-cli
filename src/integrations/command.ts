/**
 * Slash command handler for /integrate.
 *
 * Usage:
 *   /integrate status                    — Show integration statuses
 *   /integrate github setup              — Configure GitHub
 *   /integrate github issue <title>      — Create issue
 *   /integrate github pr <title>         — Create PR from current branch
 *   /integrate slack send <message>      — Send Slack message
 *   /integrate slack summary             — Send session summary to Slack
 *   /integrate notion log                — Log session to Notion
 *   /integrate notion page <title>       — Create Notion page
 */

import * as github from './github.js'
import * as slack from './slack.js'
import * as notion from './notion.js'

export type CommandResult = {
  success: boolean
  message: string
  data?: any
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function handleIntegrateCommand(args: string[]): Promise<CommandResult> {
  const sub = args[0]

  switch (sub) {
    case 'status':
      return statusCommand()

    case 'github':
      return githubCommand(args.slice(1))

    case 'slack':
      return slackCommand(args.slice(1))

    case 'notion':
      return notionCommand(args.slice(1))

    default:
      return {
        success: false,
        message: formatUsage(),
      }
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function statusCommand(): CommandResult {
  const lines: string[] = [
    'Integration Status:',
    `  GitHub  — ${github.isConfigured() ? 'configured' : 'not configured (set GITHUB_TOKEN)'}`,
    `  Slack   — ${slack.isConfigured() ? 'configured' : 'not configured (set SLACK_WEBHOOK_URL)'}`,
    `  Notion  — ${notion.isConfigured() ? 'configured' : 'not configured (set NOTION_TOKEN)'}`,
  ]
  return { success: true, message: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// GitHub sub-commands
// ---------------------------------------------------------------------------

async function githubCommand(args: string[]): Promise<CommandResult> {
  const action = args[0]

  switch (action) {
    case 'setup':
      return {
        success: true,
        message: [
          'GitHub Setup:',
          '  1. Create a personal access token at https://github.com/settings/tokens',
          '  2. Export the following environment variables:',
          '       export GITHUB_TOKEN=<your-token>',
          '       export GITHUB_OWNER=<owner>     # optional — auto-detected from git remote',
          '       export GITHUB_REPO=<repo>       # optional — auto-detected from git remote',
        ].join('\n'),
      }

    case 'issue': {
      const title = args.slice(1).join(' ')
      if (!title) return { success: false, message: 'Usage: /integrate github issue <title>' }

      try {
        const issue = await github.createIssue(title, '')
        return {
          success: true,
          message: `Created issue #${issue.number}: ${issue.url}`,
          data: issue,
        }
      } catch (err: any) {
        return { success: false, message: `GitHub error: ${err.message}` }
      }
    }

    case 'pr': {
      const title = args.slice(1).join(' ')
      if (!title) return { success: false, message: 'Usage: /integrate github pr <title>' }

      try {
        const currentBranch = await detectCurrentBranch()
        const pr = await github.createPR(title, '', currentBranch, 'main')
        return {
          success: true,
          message: `Created PR #${pr.number}: ${pr.url}`,
          data: pr,
        }
      } catch (err: any) {
        return { success: false, message: `GitHub error: ${err.message}` }
      }
    }

    default:
      return {
        success: false,
        message:
          'GitHub commands:\n' +
          '  /integrate github setup\n' +
          '  /integrate github issue <title>\n' +
          '  /integrate github pr <title>',
      }
  }
}

// ---------------------------------------------------------------------------
// Slack sub-commands
// ---------------------------------------------------------------------------

async function slackCommand(args: string[]): Promise<CommandResult> {
  const action = args[0]

  switch (action) {
    case 'send': {
      const message = args.slice(1).join(' ')
      if (!message) return { success: false, message: 'Usage: /integrate slack send <message>' }

      try {
        await slack.sendMessage(message)
        return { success: true, message: 'Message sent to Slack.' }
      } catch (err: any) {
        return { success: false, message: `Slack error: ${err.message}` }
      }
    }

    case 'summary': {
      try {
        await slack.sendSessionSummary('Session summary from void-cli.', {})
        return { success: true, message: 'Session summary sent to Slack.' }
      } catch (err: any) {
        return { success: false, message: `Slack error: ${err.message}` }
      }
    }

    default:
      return {
        success: false,
        message:
          'Slack commands:\n' +
          '  /integrate slack send <message>\n' +
          '  /integrate slack summary',
      }
  }
}

// ---------------------------------------------------------------------------
// Notion sub-commands
// ---------------------------------------------------------------------------

async function notionCommand(args: string[]): Promise<CommandResult> {
  const action = args[0]

  switch (action) {
    case 'log': {
      try {
        const sessionId = `session-${Date.now()}`
        const page = await notion.createSessionLog(sessionId, 'Session log from void-cli.', {})
        return {
          success: true,
          message: `Session logged to Notion: ${page.url}`,
          data: page,
        }
      } catch (err: any) {
        return { success: false, message: `Notion error: ${err.message}` }
      }
    }

    case 'page': {
      const title = args.slice(1).join(' ')
      if (!title) return { success: false, message: 'Usage: /integrate notion page <title>' }

      try {
        const page = await notion.createPage(title, '')
        return {
          success: true,
          message: `Created Notion page: ${page.url}`,
          data: page,
        }
      } catch (err: any) {
        return { success: false, message: `Notion error: ${err.message}` }
      }
    }

    default:
      return {
        success: false,
        message:
          'Notion commands:\n' +
          '  /integrate notion log\n' +
          '  /integrate notion page <title>',
      }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function detectCurrentBranch(): Promise<string> {
  try {
    let stdout: string | undefined
    try {
      const result = (globalThis as any).Bun?.spawnSync?.(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
      stdout = result?.stdout?.toString().trim()
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process')
      stdout = cp.execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
    }
    return stdout || 'HEAD'
  } catch {
    return 'HEAD'
  }
}

function formatUsage(): string {
  return [
    'Usage: /integrate <subcommand>',
    '',
    '  status                    — Show integration statuses',
    '  github setup              — Configure GitHub',
    '  github issue <title>      — Create issue',
    '  github pr <title>         — Create PR from current branch',
    '  slack send <message>      — Send Slack message',
    '  slack summary             — Send session summary to Slack',
    '  notion log                — Log session to Notion',
    '  notion page <title>       — Create Notion page',
  ].join('\n')
}
