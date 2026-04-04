/**
 * Native Integration types for GitHub, Slack, and Notion.
 */

export type IntegrationType = 'github' | 'slack' | 'notion'

export type IntegrationConfig = {
  type: IntegrationType
  enabled: boolean
  token?: string
  webhookUrl?: string
  defaultChannel?: string
  defaultDatabase?: string
}

export type GitHubConfig = IntegrationConfig & {
  type: 'github'
  owner?: string
  repo?: string
}

export type SlackConfig = IntegrationConfig & {
  type: 'slack'
  webhookUrl?: string
  defaultChannel?: string
}

export type NotionConfig = IntegrationConfig & {
  type: 'notion'
  defaultDatabase?: string
}

export type IntegrationEvent = {
  type: IntegrationType
  action: string
  data: Record<string, any>
  timestamp: number
}

export type GitHubIssue = {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: string[]
  assignees: string[]
  url: string
}

export type GitHubPR = {
  number: number
  title: string
  body: string
  state: 'open' | 'closed' | 'merged'
  head: string
  base: string
  url: string
  draft: boolean
}

export type SlackMessage = {
  channel: string
  text: string
  blocks?: any[]
  threadTs?: string
}

export type NotionPage = {
  id: string
  title: string
  url: string
  properties: Record<string, any>
}
