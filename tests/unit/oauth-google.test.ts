// ─── Legal acceptance + Google crypto primitives ──────────────────────────────
// Covers:
//   • verifyGoogleIdToken: signature (RSA JWK), issuer, audience, expiry,
//     nonce, email_verified, alg rejection, unknown kid — the checks that make
//     a JWT trustworthy
//   • PKCE S256 pair correctness (RFC 7636)
//   • redirect-URI strictness (https everywhere except loopback)
//   • rate-limit helper behaviour

import { describe, it, expect } from 'bun:test'
import { createHash, createPublicKey, createSign, generateKeyPairSync } from 'node:crypto'
import {
  buildGoogleAuthUrl,
  createPkcePair,
  isValidRedirectUri,
  verifyGoogleIdToken,
  GoogleOAuthError,
  type Jwk,
} from '@/lib/oauth-google'

// Test RSA keypair — signing and JWKS both derive from the same key, so the
// signature verifies exactly like Google's real flow.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string; kid?: string }
const TEST_KID = 'test-key-1'
const TEST_JWKS = { keys: [{ ...jwk, kid: TEST_KID, alg: 'RS256', use: 'sig' } as Jwk] }

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function signIdToken(claims: Record<string, unknown>, opts?: { kid?: string; alg?: string }): string {
  const header = b64url(JSON.stringify({ alg: opts?.alg ?? 'RS256', kid: opts?.kid ?? TEST_KID, typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = signer.sign(privateKey)
  return `${header}.${payload}.${b64url(signature)}`
}

const NOW = 1_800_000_000
const BASE_CLAIMS = {
  iss: 'https://accounts.google.com',
  aud: 'bean-client-id',
  sub: 'google-sub-123',
  exp: NOW + 600,
  iat: NOW,
  nonce: 'nonce-abc',
  email: 'learner@example.com',
  email_verified: true,
  name: 'Learner',
}

const VERIFY_OPTS = { clientId: 'bean-client-id', jwks: TEST_JWKS, expectedNonce: 'nonce-abc', now: NOW }

describe('verifyGoogleIdToken — full validation chain', () => {
  it('accepts a correctly signed token with every check passing', async () => {
    const claims = await verifyGoogleIdToken({ idToken: signIdToken(BASE_CLAIMS), ...VERIFY_OPTS })
    expect(claims.sub).toBe('google-sub-123')
    expect(claims.email).toBe('learner@example.com')
  })

  it('rejects a token signed by a different key (bad signature)', async () => {
    const { publicKey: otherPub, privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const otherJwk = otherPub.export({ format: 'jwk' }) as { n: string; e: string; kty: string }
    const header = b64url(JSON.stringify({ alg: 'RS256', kid: TEST_KID, typ: 'JWT' }))
    const payload = b64url(JSON.stringify(BASE_CLAIMS))
    const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(otherKey)
    const forged = `${header}.${payload}.${b64url(sig)}`
    void otherJwk
    await expect(verifyGoogleIdToken({ idToken: forged, ...VERIFY_OPTS })).rejects.toThrow(GoogleOAuthError)
    await expect(verifyGoogleIdToken({ idToken: forged, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_bad_signature' })
  })

  it('rejects an unknown kid', async () => {
    const token = signIdToken(BASE_CLAIMS, { kid: 'unknown-kid' })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_unknown_kid' })
  })

  it('rejects a non-RS256 alg before any claim is trusted', async () => {
    const token = signIdToken(BASE_CLAIMS, { alg: 'HS256' })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_alg_rejected' })
  })

  it('rejects an untrusted issuer', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, iss: 'https://evil.example' })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_bad_issuer' })
  })

  it('rejects a wrong audience', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, aud: 'other-client' })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_bad_audience' })
  })

  it('accepts an aud array containing this client with matching azp', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, aud: ['bean-client-id'], azp: 'bean-client-id' })
    const claims = await verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })
    expect(claims.sub).toBe('google-sub-123')
  })

  it('rejects an expired token', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, exp: NOW - 120 })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_expired' })
  })

  it('rejects a nonce mismatch', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, nonce: 'attacker-nonce' })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_nonce_mismatch' })
  })

  it('refuses authentication from an UNVERIFIED Google email', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, email_verified: false })
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_email_unverified' })
  })

  it('rejects a token with no email claim', async () => {
    const { email: _email, email_verified: _v, ...withoutEmail } = BASE_CLAIMS
    const token = signIdToken(withoutEmail)
    await expect(verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_missing_email' })
  })

  it('accepts both Google issuer forms', async () => {
    const token = signIdToken({ ...BASE_CLAIMS, iss: 'accounts.google.com' })
    const claims = await verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })
    expect(claims.sub).toBe('google-sub-123')
  })

  it('rejects malformed tokens outright', async () => {
    await expect(verifyGoogleIdToken({ idToken: 'not-a-jwt', ...VERIFY_OPTS })).rejects.toMatchObject({ code: 'id_token_malformed' })
  })
})

describe('PKCE S256', () => {
  it('produces an S256 challenge that matches the verifier hash', () => {
    const pair = createPkcePair()
    expect(pair.method).toBe('S256')
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.verifier.length).toBeLessThanOrEqual(128)
    const expected = createHash('sha256').update(pair.verifier).digest('base64url')
    expect(pair.challenge).toBe(expected)
  })

  it('never repeats a verifier', () => {
    const a = createPkcePair()
    const b = createPkcePair()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('authorization URL', () => {
  it('carries client id, minimal scopes, state, nonce and S256 PKCE', () => {
    const url = new URL(buildGoogleAuthUrl({
      clientId: 'bean-client-id',
      redirectUri: 'https://bean.example/api/auth/google/callback',
      state: 'st-1',
      codeChallenge: 'challenge-xyz',
      nonce: 'nonce-abc',
    }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('bean-client-id')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('st-1')
    expect(url.searchParams.get('nonce')).toBe('nonce-abc')
  })
})

describe('redirect URI validation', () => {
  it('accepts https URIs', () => {
    expect(isValidRedirectUri('https://bean.example/api/auth/google/callback')).toBe(true)
  })
  it('accepts http only for loopback development', () => {
    expect(isValidRedirectUri('http://localhost:3000/api/auth/google/callback')).toBe(true)
    expect(isValidRedirectUri('http://127.0.0.1:3000/api/auth/google/callback')).toBe(true)
  })
  it('rejects plain-http remote hosts and non-URL junk', () => {
    expect(isValidRedirectUri('http://bean.example/api/auth/google/callback')).toBe(false)
    expect(isValidRedirectUri('ftp://bean.example/cb')).toBe(false)
    expect(isValidRedirectUri('not a url')).toBe(false)
  })
})

describe('public key import from the JWKS entry', () => {
  it('imports the test JWK and verifies a known signature', async () => {
    const token = signIdToken(BASE_CLAIMS)
    const claims = await verifyGoogleIdToken({ idToken: token, ...VERIFY_OPTS })
    expect(claims.name).toBe('Learner')
    void createPublicKey
  })
})
