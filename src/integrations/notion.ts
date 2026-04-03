/**
 * Notion integration via REST API.
 *
 * Configuration via env vars:
 *   NOTION_TOKEN       — Notion integration token
 *   NOTION_DATABASE_ID — Default database ID for session logs
 */

import type { NotionConfig, NotionPage } from './types.js'

const API_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

function getConfig(): NotionConfig {
  const token = process.env.NOTION_TOKEN
  return {
    type: 'notion',
    enabled: !!token,
    token,
    defaultDatabase: process.env.NOTION_DATABASE_ID,
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const config = getConfig()
  if (!config.token) {
    throw new Error('NOTION_TOKEN is not set. Run: export NOTION_TOKEN=<your-token>')
  }

  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }

  const res = await fetch(url, { ...options, headers })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Notion API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function richText(content: string): any[] {
  return [{ type: 'text', text: { content } }]
}

function mapPage(raw: any): NotionPage {
  const titleProp = Object.values(raw.properties ?? {}).find(
    (p: any) => p.type === 'title',
  ) as any

  const title =
    titleProp?.title?.map((t: any) => t.plain_text).join('') ?? ''

  return {
    id: raw.id,
    title,
    url: raw.url ?? '',
    properties: raw.properties ?? {},
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createPage(
  title: string,
  content: string,
  databaseId?: string,
): Promise<NotionPage> {
  const config = getConfig()
  const dbId = databaseId ?? config.defaultDatabase

  const parent = dbId
    ? { database_id: dbId }
    : undefined

  if (!parent) {
    throw new Error(
      'No database ID provided and NOTION_DATABASE_ID is not set.',
    )
  }

  const raw: any = await request('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent,
      properties: {
        title: { title: richText(title) },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: richText(content) },
        },
      ],
    }),
  })

  return mapPage(raw)
}

export async function appendToPage(
  pageId: string,
  content: string,
): Promise<void> {
  await request(`/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: richText(content) },
        },
      ],
    }),
  })
}

export async function searchPages(query: string): Promise<NotionPage[]> {
  const raw: any = await request('/search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    }),
  })

  return (raw.results ?? []).map(mapPage)
}

export async function createSessionLog(
  sessionId: string,
  summary: string,
  stats: { duration?: number; tokensUsed?: number; toolCalls?: number; cost?: number },
): Promise<NotionPage> {
  const config = getConfig()
  const dbId = config.defaultDatabase

  if (!dbId) {
    throw new Error(
      'NOTION_DATABASE_ID is not set. Cannot create session log without a target database.',
    )
  }

  const children: any[] = [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: richText('Summary') },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText(summary) },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: richText('Stats') },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: richText(
          `Duration: ${stats.duration != null ? `${Math.round(stats.duration / 1000)}s` : 'N/A'}`,
        ),
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: richText(
          `Tokens: ${stats.tokensUsed != null ? stats.tokensUsed.toLocaleString() : 'N/A'}`,
        ),
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: richText(
          `Tool calls: ${stats.toolCalls != null ? String(stats.toolCalls) : 'N/A'}`,
        ),
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: richText(
          `Cost: ${stats.cost != null ? `$${stats.cost.toFixed(4)}` : 'N/A'}`,
        ),
      },
    },
  ]

  const raw: any = await request('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        title: {
          title: richText(`Session ${sessionId} — ${new Date().toISOString().slice(0, 10)}`),
        },
      },
      children,
    }),
  })

  return mapPage(raw)
}

export function isConfigured(): boolean {
  return getConfig().enabled
}
