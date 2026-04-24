/**
 * Persisted storage for ChatGPT-subscription OAuth tokens.
 *
 * Stores `{access_token, refresh_token, id_token, expires_at, chatgpt_plan_type, ...}`
 * at `~/.void/auth.json` (parent dir 0700, file 0600). Refresh-on-demand is handled
 * by `getValidAccessToken()` so callers don't need to track expiry themselves.
 *
 * All work is gated behind feature('CHATGPT_SUBSCRIPTION_AUTH'). The caller is
 * responsible for checking the flag before using these functions.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getClaudeConfigHomeDir } from '../envUtils.js'
import { refreshTokens, type AuthTokens } from './openaiOauth.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** File name under ~/.void/ — kept distinct from the Anthropic `.credentials.json`. */
const AUTH_FILE = 'chatgpt-auth.json'

/** Refresh access token this many ms before it actually expires. Matches Codex's ~5min skew. */
const REFRESH_SKEW_MS = 5 * 60_000

// ── Path helpers ─────────────────────────────────────────────────────────────

export function getAuthFilePath(): string {
  return join(getClaudeConfigHomeDir(), AUTH_FILE)
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

// ── Persisted shape ──────────────────────────────────────────────────────────

export interface StoredAuthTokens extends AuthTokens {
  /** Epoch ms when we last refreshed — useful for diagnostics. */
  last_refresh?: number
}

// ── API ──────────────────────────────────────────────────────────────────────

export function loadTokens(): StoredAuthTokens | null {
  const path = getAuthFilePath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as StoredAuthTokens
    if (!parsed.access_token || !parsed.refresh_token) return null
    return parsed
  } catch {
    return null
  }
}

export function saveTokens(tokens: StoredAuthTokens): void {
  const path = getAuthFilePath()
  ensureParentDir(path)
  const payload: StoredAuthTokens = {
    ...tokens,
    last_refresh: tokens.last_refresh ?? Date.now(),
  }
  writeFileSync(path, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // non-fatal
  }
}

export function clearTokens(): void {
  const path = getAuthFilePath()
  if (existsSync(path)) {
    try {
      rmSync(path, { force: true })
    } catch {
      // non-fatal
    }
  }
}

/**
 * Returns an access token that is valid for at least REFRESH_SKEW_MS.
 *
 * If the cached token is nearing expiry, refresh it against auth.openai.com and
 * persist the new tokens before returning.
 *
 * Throws if no tokens are persisted — callers should direct the user to `void login chatgpt`.
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens()
  if (!tokens) {
    throw new Error(
      'No ChatGPT subscription tokens persisted. Run `void login chatgpt` first.',
    )
  }

  const now = Date.now()
  if (tokens.expires_at && tokens.expires_at - REFRESH_SKEW_MS > now) {
    return tokens.access_token
  }

  // Expired (or about to be) — refresh.
  const refreshed = await refreshTokens(tokens.refresh_token)
  const merged: StoredAuthTokens = {
    ...tokens,
    ...refreshed,
    // refreshTokens() may return empty id_token — retain the original if so.
    id_token: refreshed.id_token || tokens.id_token,
    // Preserve account id / plan if the refresh JWT omits them.
    chatgpt_account_id: refreshed.chatgpt_account_id ?? tokens.chatgpt_account_id,
    chatgpt_plan_type: refreshed.chatgpt_plan_type ?? tokens.chatgpt_plan_type,
    email: refreshed.email ?? tokens.email,
    last_refresh: Date.now(),
  }
  saveTokens(merged)
  return merged.access_token
}

/**
 * Returns the full cached token blob (refreshing if needed). Useful when the
 * caller needs the chatgpt_account_id for the `chatgpt-account-id` request header.
 */
export async function getValidAuthTokens(): Promise<StoredAuthTokens> {
  const token = await getValidAccessToken() // triggers refresh + persist
  const fresh = loadTokens()
  if (!fresh) {
    throw new Error('Auth tokens disappeared immediately after refresh')
  }
  // Ensure the token we just validated matches the one on disk.
  return { ...fresh, access_token: token }
}
