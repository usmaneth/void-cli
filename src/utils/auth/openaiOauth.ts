// TOS NOTE: this client_id is registered to OpenAI's Codex CLI; using it from Void is personal-use impersonation.
/**
 * OpenAI OAuth flow for ChatGPT subscription authentication.
 *
 * Ported from Codex CLI's Rust implementation (codex-rs/login/src/{server,pkce,auth/manager}.rs).
 * Implements the PKCE authorization-code grant against auth.openai.com, with a short-lived
 * localhost:1455 callback server to capture the redirect.
 *
 * All work is gated behind feature('CHATGPT_SUBSCRIPTION_AUTH'). The caller (login command) is
 * responsible for checking the flag before invoking these functions.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { URL } from 'node:url'

import { getProxyFetchOptions } from '../proxy.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** OAuth client_id registered to OpenAI's Codex CLI. See TOS note above. */
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/** Default OAuth issuer. */
export const DEFAULT_ISSUER = 'https://auth.openai.com'

/** Callback port Codex uses; matching it lets the issuer's allowlist accept the redirect_uri. */
export const DEFAULT_CALLBACK_PORT = 1455

/**
 * ChatGPT backend base URL for the Responses API.
 * Path segment is `/codex/...` (e.g. /codex/responses, /codex/models) — matches
 * codex-rs/response-debug-context. Callers append `/responses`, `/models`, etc.
 */
export const DEFAULT_CHATGPT_BACKEND_BASE_URL =
  'https://chatgpt.com/backend-api/codex'

/** OAuth scopes (verbatim from Codex's build_authorize_url). */
const AUTH_SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'

const REFRESH_TOKEN_URL = `${DEFAULT_ISSUER}/oauth/token`
const REVOKE_TOKEN_URL = `${DEFAULT_ISSUER}/oauth/revoke`
const TOKEN_EXCHANGE_URL = `${DEFAULT_ISSUER}/oauth/token`
const AUTHORIZE_URL = `${DEFAULT_ISSUER}/oauth/authorize`

/** How long to wait for the browser redirect before giving up. */
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000

// ── Types ────────────────────────────────────────────────────────────────────

export interface PkceCodes {
  code_verifier: string
  code_challenge: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  id_token: string
  /** Epoch ms when access_token expires (derived from JWT `exp` claim). */
  expires_at: number
  /** "free" | "plus" | "pro" | "business" | "enterprise" | "edu" — parsed from id_token claims. */
  chatgpt_plan_type?: string
  /** Email of signed-in user, parsed from id_token claims. */
  email?: string
  /** ChatGPT workspace/account id — required on x-chatgpt-account-id header for Responses API. */
  chatgpt_account_id?: string
}

interface RawTokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Generate a PKCE code_verifier (64 random bytes, base64url-encoded) and its
 * S256 challenge. Mirrors codex-rs/login/src/pkce.rs.
 */
export function generatePkce(): PkceCodes {
  const verifierBytes = randomBytes(64)
  const code_verifier = base64UrlEncode(verifierBytes)
  const challengeBytes = createHash('sha256').update(code_verifier).digest()
  const code_challenge = base64UrlEncode(challengeBytes)
  return { code_verifier, code_challenge }
}

/**
 * Derive a PKCE challenge from a known verifier. Exposed for testing deterministic pairs.
 */
export function pkceChallengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest())
}

function generateState(): string {
  return base64UrlEncode(randomBytes(32))
}

// ── JWT parsing ──────────────────────────────────────────────────────────────

interface JwtClaims {
  exp?: number
  email?: string
  'https://api.openai.com/auth'?: {
    chatgpt_plan_type?: string
    chatgpt_account_id?: string
    chatgpt_user_id?: string
    user_id?: string
  }
  'https://api.openai.com/profile'?: { email?: string }
}

export function decodeJwtPayload(jwt: string): JwtClaims {
  const parts = jwt.split('.')
  if (parts.length !== 3) return {}
  try {
    const payload = parts[1]!
    // base64url → base64
    const padLen = (4 - (payload.length % 4)) % 4
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen)
    const json = Buffer.from(b64, 'base64').toString('utf-8')
    return JSON.parse(json) as JwtClaims
  } catch {
    return {}
  }
}

/**
 * Extract the ChatGPT-subscription-relevant claims from an id_token/access_token pair.
 */
export function extractTokenMetadata(tokens: {
  id_token: string
  access_token: string
  expires_in?: number
}): Pick<AuthTokens, 'expires_at' | 'chatgpt_plan_type' | 'email' | 'chatgpt_account_id'> {
  const idClaims = decodeJwtPayload(tokens.id_token)
  const accessClaims = decodeJwtPayload(tokens.access_token)

  const idAuth = idClaims['https://api.openai.com/auth']
  const accessAuth = accessClaims['https://api.openai.com/auth']

  const email = idClaims.email ?? idClaims['https://api.openai.com/profile']?.email
  const plan = accessAuth?.chatgpt_plan_type ?? idAuth?.chatgpt_plan_type
  const accountId = idAuth?.chatgpt_account_id ?? accessAuth?.chatgpt_account_id

  // Prefer access_token.exp since it gates API calls; fall back to expires_in or a safe default.
  const now = Date.now()
  const accessExp = typeof accessClaims.exp === 'number' ? accessClaims.exp * 1000 : undefined
  const expiresAt =
    accessExp ??
    (tokens.expires_in ? now + tokens.expires_in * 1000 : now + 60 * 60 * 1000)

  return {
    expires_at: expiresAt,
    chatgpt_plan_type: plan,
    email,
    chatgpt_account_id: accountId,
  }
}

// ── Authorize URL ────────────────────────────────────────────────────────────

function buildAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: AUTH_SCOPES,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state: args.state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

// ── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForTokens(args: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<RawTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: CLIENT_ID,
    code_verifier: args.codeVerifier,
  })
  const fetchOptions = getProxyFetchOptions({ forAnthropicAPI: false }) as Record<string, unknown>
  const res = await fetch(TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    ...fetchOptions,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth token exchange failed: ${res.status} ${text}`)
  }
  return (await res.json()) as RawTokenResponse
}

/**
 * Exchanges a refresh token for a fresh access/id token pair.
 * Mirrors codex-rs/login/src/auth/manager.rs::request_chatgpt_token_refresh.
 */
export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const fetchOptions = getProxyFetchOptions({ forAnthropicAPI: false }) as Record<string, unknown>
  const res = await fetch(REFRESH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    ...fetchOptions,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`OAuth token refresh failed: ${res.status} ${text}`)
    ;(err as any).status = res.status
    throw err
  }
  const raw = (await res.json()) as RawTokenResponse
  // Refresh response may omit id_token/refresh_token; fall back to originals where needed.
  const id_token = raw.id_token ?? ''
  const metadata = extractTokenMetadata({
    id_token,
    access_token: raw.access_token,
    expires_in: raw.expires_in,
  })
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token ?? refreshToken,
    id_token,
    ...metadata,
  }
}

/**
 * Revokes a refresh token at /oauth/revoke. Mirrors codex-rs/login/src/auth/revoke.rs.
 * Failures are swallowed by callers — we still want to clear local state on logout.
 */
export async function revokeTokens(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  })
  const fetchOptions = getProxyFetchOptions({ forAnthropicAPI: false }) as Record<string, unknown>
  const res = await fetch(REVOKE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
    ...fetchOptions,
  })
  if (!res.ok && res.status !== 400) {
    // 400 is commonly returned when the token was already revoked — treat as success.
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth token revoke failed: ${res.status} ${text}`)
  }
}

// ── Local callback server ────────────────────────────────────────────────────

/**
 * Runs the full interactive login flow: generates PKCE, binds a localhost callback
 * server on `port`, opens the browser to the authorize URL, and waits for the
 * redirect containing the authorization code. Returns freshly exchanged tokens.
 *
 * Caller is responsible for persisting the returned tokens via openaiTokenStore.
 */
export async function startLoginFlow(options?: {
  port?: number
  openBrowser?: boolean
  timeoutMs?: number
  /** Injected for tests — returns the auth code directly instead of opening a browser. */
  __testCallbackCode?: string
}): Promise<AuthTokens> {
  const port = options?.port ?? DEFAULT_CALLBACK_PORT
  const openBrowser = options?.openBrowser ?? true
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS

  const pkce = generatePkce()
  const state = generateState()
  const redirectUri = `http://localhost:${port}/auth/callback`
  const authUrl = buildAuthorizeUrl({
    clientId: CLIENT_ID,
    redirectUri,
    codeChallenge: pkce.code_challenge,
    state,
  })

  if (options?.__testCallbackCode) {
    const raw = await exchangeCodeForTokens({
      code: options.__testCallbackCode,
      codeVerifier: pkce.code_verifier,
      redirectUri,
    })
    return assembleAuthTokens(raw)
  }

  const { code } = await waitForCallback({
    port,
    expectedState: state,
    timeoutMs,
    onReady: openBrowser ? () => openBrowserBestEffort(authUrl) : () => {},
    authUrl,
  })

  const raw = await exchangeCodeForTokens({
    code,
    codeVerifier: pkce.code_verifier,
    redirectUri,
  })
  return assembleAuthTokens(raw)
}

function assembleAuthTokens(raw: RawTokenResponse): AuthTokens {
  const id_token = raw.id_token ?? ''
  const metadata = extractTokenMetadata({
    id_token,
    access_token: raw.access_token,
    expires_in: raw.expires_in,
  })
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token ?? '',
    id_token,
    ...metadata,
  }
}

interface CallbackResult {
  code: string
}

function waitForCallback(args: {
  port: number
  expectedState: string
  timeoutMs: number
  onReady: () => void
  authUrl: string
}): Promise<CallbackResult> {
  return new Promise<CallbackResult>((resolve, reject) => {
    let server: Server | null = null
    let settled = false

    const cleanup = () => {
      if (server) {
        try {
          server.close()
        } catch {
          // ignore
        }
        server = null
      }
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
      cleanup()
    }

    const timer = setTimeout(() => {
      settle(() => reject(new Error('OAuth login timed out waiting for browser callback')))
    }, args.timeoutMs)

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost:${args.port}`)
        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404
          res.end('Not Found')
          return
        }
        const params = url.searchParams
        const code = params.get('code')
        const state = params.get('state')
        const error = params.get('error')
        const errorDescription = params.get('error_description')

        if (error) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(
            `<html><body><h2>Sign-in failed</h2><p>${escapeHtml(errorDescription ?? error)}</p></body></html>`,
          )
          clearTimeout(timer)
          settle(() => reject(new Error(`OAuth error: ${error}: ${errorDescription ?? ''}`)))
          return
        }

        if (!state || state !== args.expectedState) {
          res.statusCode = 400
          res.end('State mismatch')
          clearTimeout(timer)
          settle(() => reject(new Error('OAuth state mismatch')))
          return
        }

        if (!code) {
          res.statusCode = 400
          res.end('Missing authorization code')
          clearTimeout(timer)
          settle(() => reject(new Error('OAuth callback missing authorization code')))
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Connection', 'close')
        res.end(
          `<html><body style="font-family:system-ui;padding:2rem"><h2>Signed in — you can close this window.</h2></body></html>`,
        )
        clearTimeout(timer)
        settle(() => resolve({ code }))
      } catch (e) {
        clearTimeout(timer)
        settle(() => reject(e instanceof Error ? e : new Error(String(e))))
      }
    })

    server.on('error', err => {
      clearTimeout(timer)
      settle(() => reject(err))
    })

    server.listen(args.port, '127.0.0.1', () => {
      try {
        args.onReady()
      } catch {
        // Browser opening failure is non-fatal — user can manually visit the URL.
      }
      // Also print the URL so users can copy-paste when the browser doesn't auto-open.
      console.log(`Open this URL to sign in if the browser did not launch:\n  ${args.authUrl}`)
    })
  })
}

function openBrowserBestEffort(url: string): void {
  const platform = process.platform
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  try {
    if (platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
  } catch {
    // ignore — user can use the URL we printed
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
