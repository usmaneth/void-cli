/**
 * Slack integration via incoming webhooks.
 *
 * Configuration via env vars:
 *   SLACK_WEBHOOK_URL — Incoming webhook URL
 */

import type { SlackConfig, SlackMessage } from './types.js'

function getConfig(): SlackConfig {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  return {
    type: 'slack',
    enabled: !!webhookUrl,
    webhookUrl,
    defaultChannel: process.env.SLACK_DEFAULT_CHANNEL,
  }
}

async function postWebhook(payload: Record<string, any>): Promise<void> {
  const config = getConfig()
  if (!config.webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL is not set. Run: export SLACK_WEBHOOK_URL=<your-url>')
  }

  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Slack webhook ${res.status}: ${body}`)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendMessage(text: string, channel?: string): Promise<void> {
  const config = getConfig()
  const payload: Record<string, any> = { text }
  const ch = channel ?? config.defaultChannel
  if (ch) payload.channel = ch

  await postWebhook(payload)
}

export async function sendCodeBlock(
  code: string,
  language?: string,
  channel?: string,
): Promise<void> {
  const label = language ? ` (${language})` : ''
  const text = `\`\`\`${code}\`\`\``

  const payload: Record<string, any> = {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Code block${label}:*\n\`\`\`\n${code}\n\`\`\``,
        },
      },
    ],
  }

  const config = getConfig()
  const ch = channel ?? config.defaultChannel
  if (ch) payload.channel = ch

  await postWebhook(payload)
}

export async function sendSessionSummary(
  summary: string,
  stats: { duration?: number; tokensUsed?: number; toolCalls?: number; cost?: number },
): Promise<void> {
  const fields: string[] = []
  if (stats.duration != null) fields.push(`*Duration:* ${Math.round(stats.duration / 1000)}s`)
  if (stats.tokensUsed != null) fields.push(`*Tokens:* ${stats.tokensUsed.toLocaleString()}`)
  if (stats.toolCalls != null) fields.push(`*Tool calls:* ${stats.toolCalls}`)
  if (stats.cost != null) fields.push(`*Cost:* $${stats.cost.toFixed(4)}`)

  const payload: Record<string, any> = {
    text: `Session Summary: ${summary}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Session Summary' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summary },
      },
      ...(fields.length
        ? [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: fields.join('  |  ') },
            },
          ]
        : []),
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `_Sent from void-cli at ${new Date().toISOString()}_` },
        ],
      },
    ],
  }

  await postWebhook(payload)
}

export async function notifyError(
  error: string | Error,
  context?: string,
): Promise<void> {
  const message = error instanceof Error ? error.message : error
  const stack = error instanceof Error ? error.stack : undefined

  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:rotating_light: *Error${context ? ` in ${context}` : ''}*\n\`\`\`\n${message}\n\`\`\``,
      },
    },
  ]

  if (stack) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Stack trace:*\n\`\`\`\n${stack.slice(0, 2000)}\n\`\`\``,
      },
    })
  }

  await postWebhook({
    text: `Error: ${message}`,
    blocks,
  })
}

export function isConfigured(): boolean {
  return getConfig().enabled
}
