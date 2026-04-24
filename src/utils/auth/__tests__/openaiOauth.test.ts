import { describe, expect, it } from 'vitest'

import {
  decodeJwtPayload,
  extractTokenMetadata,
  generatePkce,
  pkceChallengeFromVerifier,
} from '../openaiOauth.js'

// ─ PKCE ──────────────────────────────────────────────────────────────────────

describe('generatePkce', () => {
  it('returns a verifier of the expected URL-safe base64 length', () => {
    const pkce = generatePkce()
    // 64 random bytes → 88-char base64, minus 2 padding chars = ~86 base64url chars
    expect(pkce.code_verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pkce.code_verifier.length).toBeGreaterThanOrEqual(80)
    expect(pkce.code_challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    // SHA-256 → 32 bytes → 43 base64url chars (no padding)
    expect(pkce.code_challenge.length).toBe(43)
  })

  it('derives a matching challenge from the verifier', () => {
    const pkce = generatePkce()
    const derived = pkceChallengeFromVerifier(pkce.code_verifier)
    expect(derived).toBe(pkce.code_challenge)
  })

  it('produces distinct verifier/challenge pairs across calls', () => {
    const a = generatePkce()
    const b = generatePkce()
    expect(a.code_verifier).not.toBe(b.code_verifier)
    expect(a.code_challenge).not.toBe(b.code_challenge)
  })

  it('challenge is deterministic given a fixed verifier (known-answer test)', () => {
    // RFC 7636 Appendix B known-answer test vector:
    //   verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    //   challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    expect(pkceChallengeFromVerifier(verifier)).toBe(expected)
  })
})

// ─ JWT parsing ──────────────────────────────────────────────────────────────

function encodeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.signature`
}

describe('decodeJwtPayload', () => {
  it('decodes a well-formed JWT', () => {
    const jwt = encodeJwt({ email: 'a@example.com', exp: 1_700_000_000 })
    const parsed = decodeJwtPayload(jwt)
    expect(parsed.email).toBe('a@example.com')
    expect(parsed.exp).toBe(1_700_000_000)
  })

  it('returns {} on malformed input', () => {
    expect(decodeJwtPayload('not-a-jwt')).toEqual({})
    expect(decodeJwtPayload('')).toEqual({})
    expect(decodeJwtPayload('a.b.c')).toEqual({})
  })
})

describe('extractTokenMetadata', () => {
  it('pulls plan + account from the access JWT claim', () => {
    const idToken = encodeJwt({
      email: 'user@example.com',
      exp: 2_000_000_000,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    })
    const accessToken = encodeJwt({
      exp: 1_700_000_000,
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
      },
    })
    const meta = extractTokenMetadata({ id_token: idToken, access_token: accessToken })
    expect(meta.chatgpt_plan_type).toBe('pro')
    expect(meta.chatgpt_account_id).toBe('acct_123')
    expect(meta.email).toBe('user@example.com')
    expect(meta.expires_at).toBe(1_700_000_000 * 1000)
  })

  it('falls back to expires_in when JWT lacks exp', () => {
    const idToken = encodeJwt({})
    const accessToken = encodeJwt({}) // no exp
    const now = Date.now()
    const meta = extractTokenMetadata({
      id_token: idToken,
      access_token: accessToken,
      expires_in: 3600,
    })
    expect(meta.expires_at).toBeGreaterThanOrEqual(now + 3_500_000)
    expect(meta.expires_at).toBeLessThanOrEqual(now + 3_700_000)
  })
})
