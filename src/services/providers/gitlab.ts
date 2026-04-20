/**
 * GitLab Duo Agent Platform provider — routes requests through GitLab's
 * hosted or self-managed AI gateway. Enabled when `VOID_USE_GITLAB=1` and a
 * `GITLAB_TOKEN` is present. Self-hosted instances are supported via the
 * `GITLAB_HOST` env var.
 *
 * GitLab exposes an OpenAI-compatible chat completions endpoint under
 * `/api/v4/ai/agents/chat/completions`, authenticated with a Personal Access
 * Token using the `PRIVATE-TOKEN` header.
 */

import { createOpenAIShimClient } from '../api/openaiShim.js'

/** Default GitLab instance host. */
export const GITLAB_DEFAULT_HOST = 'https://gitlab.com'

const DEFAULT_TIMEOUT_MS = 60_000

export interface GitLabClientOptions {
  timeout?: number
  /** Override the GitLab host (e.g. self-hosted instance). */
  host?: string
}

/** Resolve the GitLab Personal Access Token from env vars. */
export function getGitLabToken(): string | null {
  return process.env.GITLAB_TOKEN ?? null
}

/** Resolve the configured GitLab host, honouring `GITLAB_HOST`. */
export function getGitLabHost(): string {
  const host = process.env.GITLAB_HOST ?? GITLAB_DEFAULT_HOST
  return host.replace(/\/$/, '')
}

/**
 * Build the base URL for GitLab's OpenAI-compatible AI endpoint. The path
 * mirrors GitLab's Duo Agent Platform routing.
 */
export function getGitLabAiBaseUrl(host: string = getGitLabHost()): string {
  return `${host.replace(/\/$/, '')}/api/v4/ai/agents`
}

/**
 * Create an Anthropic-compatible client that talks to a GitLab instance via
 * its OpenAI-compatible chat endpoint. Uses `PRIVATE-TOKEN` auth.
 */
export function createGitLabClient(
  token: string,
  options: GitLabClientOptions = {},
) {
  const host = options.host ?? getGitLabHost()
  return createOpenAIShimClient({
    apiKey: token,
    baseURL: getGitLabAiBaseUrl(host),
    defaultHeaders: {
      // GitLab's API accepts PATs via PRIVATE-TOKEN; the shim forwards custom
      // headers on every request.
      'PRIVATE-TOKEN': token,
      'x-provider': 'gitlab-duo',
    },
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  })
}
