/**
 * GitHub integration using the REST API (fetch-based, no external deps).
 *
 * Configuration via env vars:
 *   GITHUB_TOKEN  — Personal access token
 *   GITHUB_OWNER  — Repository owner (auto-detected from git remote if unset)
 *   GITHUB_REPO   — Repository name  (auto-detected from git remote if unset)
 */

import type { GitHubConfig, GitHubIssue, GitHubPR } from './types.js'

const API_BASE = 'https://api.github.com'

function getConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN
  let owner = process.env.GITHUB_OWNER
  let repo = process.env.GITHUB_REPO

  if (!owner || !repo) {
    const detected = detectOwnerRepo()
    if (detected) {
      owner = owner ?? detected.owner
      repo = repo ?? detected.repo
    }
  }

  return {
    type: 'github',
    enabled: !!token,
    token,
    owner,
    repo,
  }
}

/**
 * Attempt to detect owner/repo from the git remote origin URL.
 */
function detectOwnerRepo(): { owner: string; repo: string } | null {
  try {
    // Use Bun.spawnSync when available, fall back to node child_process
    let stdout: string | undefined
    try {
      const result = (globalThis as any).Bun?.spawnSync?.(['git', 'remote', 'get-url', 'origin'])
      stdout = result?.stdout?.toString().trim()
    } catch {
      // Not in Bun — try node child_process
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process')
      stdout = cp.execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
    }

    if (!stdout) return null

    // SSH: git@github.com:owner/repo.git
    const sshMatch = stdout.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = stdout.match(/github\.com\/([^/]+)\/([^/.]+)/)
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }
  } catch {
    // Not inside a git repo or git not available — silently ignore.
  }
  return null
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const config = getConfig()
  if (!config.token) {
    throw new Error('GITHUB_TOKEN is not set. Run: export GITHUB_TOKEN=<your-token>')
  }

  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers as Record<string, string> ?? {}),
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, { ...options, headers })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

function repoPath(): string {
  const config = getConfig()
  if (!config.owner || !config.repo) {
    throw new Error(
      'GitHub owner/repo not configured. Set GITHUB_OWNER and GITHUB_REPO or ensure a git remote is available.',
    )
  }
  return `/repos/${config.owner}/${config.repo}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createIssue(
  title: string,
  body: string,
  labels?: string[],
): Promise<GitHubIssue> {
  const payload: Record<string, any> = { title, body }
  if (labels?.length) payload.labels = labels

  const raw: any = await request(`${repoPath()}/issues`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  return mapIssue(raw)
}

export async function createPR(
  title: string,
  body: string,
  head: string,
  base: string,
): Promise<GitHubPR> {
  const raw: any = await request(`${repoPath()}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head, base }),
  })

  return mapPR(raw)
}

export async function listIssues(
  state: 'open' | 'closed' | 'all' = 'open',
  labels?: string[],
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams({ state })
  if (labels?.length) params.set('labels', labels.join(','))

  const raw: any[] = await request(`${repoPath()}/issues?${params}`)
  return raw.filter((i: any) => !i.pull_request).map(mapIssue)
}

export async function listPRs(
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GitHubPR[]> {
  const params = new URLSearchParams({ state })
  const raw: any[] = await request(`${repoPath()}/pulls?${params}`)
  return raw.map(mapPR)
}

export async function addComment(
  issueNumber: number,
  body: string,
): Promise<{ id: number; url: string }> {
  const raw: any = await request(`${repoPath()}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  return { id: raw.id, url: raw.html_url }
}

export async function getRepo(): Promise<{
  name: string
  fullName: string
  description: string
  url: string
  stars: number
  forks: number
  openIssues: number
}> {
  const raw: any = await request(repoPath())
  return {
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description ?? '',
    url: raw.html_url,
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    openIssues: raw.open_issues_count,
  }
}

export function isConfigured(): boolean {
  return getConfig().enabled
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapIssue(raw: any): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    state: raw.state,
    labels: (raw.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)),
    assignees: (raw.assignees ?? []).map((a: any) => a.login),
    url: raw.html_url,
  }
}

function mapPR(raw: any): GitHubPR {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    state: raw.merged ? 'merged' : raw.state,
    head: raw.head?.ref ?? '',
    base: raw.base?.ref ?? '',
    url: raw.html_url,
    draft: raw.draft ?? false,
  }
}
