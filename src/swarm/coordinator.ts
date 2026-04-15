/**
 * Swarm Coordinator — decomposes a feature description into independent
 * workstreams by calling a coordinator model.
 *
 * The coordinator receives the feature description plus optional codebase
 * context and responds with structured JSON describing workstreams, their
 * domains, tasks, and file scopes.
 */

import { getAnthropicClient } from 'src/services/api/client.js'
import { OAUTH_BETA_HEADER } from '../constants/oauth.js'
import { isClaudeAISubscriber } from '../utils/auth.js'
import {
  DEFAULT_MODEL_ASSIGNMENTS,
  type Workstream,
  type WorkstreamDomain,
  type WorkstreamTask,
} from './types.js'

// ---------------------------------------------------------------------------
// System prompt for the coordinator model
// ---------------------------------------------------------------------------

const COORDINATOR_SYSTEM_PROMPT = `You are a senior engineering coordinator. Your job is to decompose a feature request into independent workstreams that can be implemented in parallel by different specialist agents.

Each workstream must be truly independent — it should be possible to implement them in separate git worktrees without merge conflicts. If two tasks touch the same file, they belong in the same workstream.

Respond with a JSON array of workstream objects. Each object has these fields:
- "id": a short kebab-case identifier (e.g. "ws-frontend-auth")
- "name": a short human-readable name
- "domain": one of "frontend", "backend", "wiring", "tests", "debugging", "custom"
- "description": what this workstream accomplishes (1-2 sentences)
- "scope": array of file paths or glob patterns this workstream will touch
- "tasks": array of { "description": string, "file"?: string } objects listing the concrete steps

Respond ONLY with the JSON array. No markdown fences, no commentary.`

// ---------------------------------------------------------------------------
// Decompose a feature into workstreams
// ---------------------------------------------------------------------------

/**
 * Calls the coordinator model to decompose a high-level feature description
 * into independent workstreams, then assigns default models per domain.
 */
export async function decomposeTask(
  description: string,
  codebaseContext: string,
  coordinatorModel: string,
): Promise<Workstream[]> {
  const client = await getAnthropicClient({
    maxRetries: 2,
    model: coordinatorModel,
  })

  const userPrompt = codebaseContext
    ? `Feature to decompose:\n${description}\n\nCodebase context:\n${codebaseContext}`
    : `Feature to decompose:\n${description}`

  const betas: string[] = []
  if (isClaudeAISubscriber()) {
    betas.push(OAUTH_BETA_HEADER)
  }

  const response = await client.beta.messages.create({
    model: coordinatorModel,
    max_tokens: 4096,
    system: COORDINATOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    ...(betas.length > 0 && { betas }),
  })

  // Extract text from the response
  const text = response.content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { type: string; text?: string }) => (b as { text: string }).text)
    .join('\n')

  // Parse the JSON response — strip markdown fences if the model added them
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim()

  let rawWorkstreams: RawWorkstream[]
  try {
    rawWorkstreams = JSON.parse(cleaned)
  } catch {
    throw new Error(
      `Coordinator returned invalid JSON. Raw response:\n${text}`,
    )
  }

  if (!Array.isArray(rawWorkstreams)) {
    throw new Error(
      `Coordinator response is not an array. Got: ${typeof rawWorkstreams}`,
    )
  }

  // Map raw data to typed Workstream objects with default model assignments
  return rawWorkstreams.map(raw => {
    const domain = validateDomain(raw.domain)
    const tasks: WorkstreamTask[] = (raw.tasks ?? []).map(
      (t: { description: string; file?: string }) => ({
        description: t.description,
        status: 'pending' as const,
        file: t.file,
      }),
    )

    return {
      id: raw.id ?? `ws-${domain}-${Math.random().toString(36).slice(2, 6)}`,
      name: raw.name ?? raw.id ?? domain,
      domain,
      model: DEFAULT_MODEL_ASSIGNMENTS[domain],
      description: raw.description ?? '',
      scope: Array.isArray(raw.scope) ? raw.scope : [],
      tasks,
      status: 'pending' as const,
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawWorkstream = {
  id?: string
  name?: string
  domain?: string
  description?: string
  scope?: string[]
  tasks?: Array<{ description: string; file?: string }>
}

const VALID_DOMAINS: Set<string> = new Set([
  'frontend',
  'backend',
  'wiring',
  'tests',
  'debugging',
  'custom',
])

function validateDomain(raw: string | undefined): WorkstreamDomain {
  if (raw && VALID_DOMAINS.has(raw)) return raw as WorkstreamDomain
  return 'custom'
}
