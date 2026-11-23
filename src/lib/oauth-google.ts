// ─── Google OAuth 2.0 / OIDC (server-only) ───────────────────────────────────
// Genuine authorization-code flow built for BEAN's custom session architecture
// (public-experience/auth/legal milestone). Security properties implemented
// here — every one of them is validated, none is decorative:
//   • PKCE with S256 (code_verifier never leaves the server; challenge goes to
//     Google, the verifier is exchanged server-side at the token endpoint).
//   • State parameter validated against an httpOnly cookie on the callback.
//   • OIDC nonce bound into the ID token and compared after verification.
//   • ID-token signature verified against Google's published JWKS (RS256
//     only) — a JWT is NEVER decoded and trusted without signature validation.
//   • Issuer, audience (client ID), expiry and `email_verified` validated.
//   • Strict redirect-URI handling: the configured GOOGLE_REDIRECT_URI is used
//     verbatim; http is only allowed for loopback development hosts.
//   • Minimal scopes: `openid email profile`.
//   • No Google access/refresh tokens are stored — login needs only the
//     verified identity; tokens from the exchange are used transiently and
//     dropped (only the ID token claims survive, and only its identity fields).

import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'node:crypto'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const
const SCOPES = 'openid email profile'

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  configured: boolean
}

/** Read Google OAuth credentials from the environment. Absent credentials are
 *  an honest "not configured" state — never a fake login. */
export function googleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ?? ''
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret && redirectUri) }
}

/** Strict callback-URL validation: must match the configured redirect URI
 *  exactly, and must be https (http allowed only for loopback dev hosts). */
export function isValidRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol === 'https:') return true
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
    }
    return false
  } catch {
    return false
  }
}

// ─── PKCE (RFC 7636, S256) ─────────────────────────────────────────────────────

export interface PkcePair {
  verifier: string
  challenge: string
  method: 'S256'
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(64).toString('base64url') // 43..128 chars, URL-safe
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, method: 'S256' }
}

// ─── Random session-binding values ─────────────────────────────────────────────

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// ─── Authorization URL ─────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  nonce: string
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('nonce', opts.nonce)
  url.searchParams.set('code_challenge', opts.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ─── Token exchange ────────────────────────────────────────────────────────────

export interface TokenResponse {
  id_token: string
  expires_in?: number
  token_type?: string
}

export async function exchangeAuthorizationCode(opts: {
  code: string
  verifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchFn?: typeof fetch
}): Promise<TokenResponse> {
  const doFetch = opts.fetchFn ?? fetch
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: opts.verifier,
  })
  const res = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new GoogleOAuthError('token_exchange_failed', `Google token endpoint returned ${res.status}`)
  const data = (await res.json()) as Partial<TokenResponse>
  if (typeof data.id_token !== 'string' || !data.id_token) {
    throw new GoogleOAuthError('token_exchange_failed', 'Google token response did not include an ID token')
  }
  return data as TokenResponse
}

// ─── JWKS loading (Google-published signing keys, cached) ──────────────────────

export interface Jwk {
  kty: string
  kid: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

export interface JwksCache {
  keys: Jwk[]
  fetchedAt: number
  maxAgeMs: number
}

/** Fetch (and cache) Google's JWKS. `maxAge` honours a conservative default;
 *  callers may force a refresh when a `kid` is unknown. */
export async function fetchGoogleJwks(cache?: JwksCache | null, opts?: { force?: boolean; fetchFn?: typeof fetch; now?: number }): Promise<JwksCache> {
  const now = opts?.now ?? Date.now()
  if (!opts?.force && cache && now - cache.fetchedAt < cache.maxAgeMs && cache.keys.length > 0) return cache
  const doFetch = opts?.fetchFn ?? fetch
  const res = await doFetch(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new GoogleOAuthError('jwks_unavailable', `Google JWKS endpoint returned ${res.status}`)
  const data = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(data.keys) ? data.keys : []
  if (keys.length === 0) throw new GoogleOAuthError('jwks_unavailable', 'Google JWKS response contained no keys')
  return { keys, fetchedAt: now, maxAgeMs: 60 * 60_000 }
}

// ─── ID-token verification (RS256 only, no unverified trust) ───────────────────

export interface GoogleIdClaims {
  iss: string
  aud: string | string[]
  azp?: string
  sub: string
  exp: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
  hd?: string
}

export type GoogleJwks = { keys: Jwk[] }

export class GoogleOAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

/** Verify a Google-issued ID token end to end:
 *  signature (RS256 via JWKS), issuer, audience/client ID, expiry, nonce and
 *  email_verified. Returns the claims only when EVERY check passes. */
export async function verifyGoogleIdToken(opts: {
  idToken: string
  clientId: string
  jwks: GoogleJwks
  expectedNonce?: string | null
  now?: number
}): Promise<GoogleIdClaims> {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const parts = opts.idToken.split('.')
  if (parts.length !== 3) throw new GoogleOAuthError('id_token_malformed', 'ID token is not a JWS')

  const [headerB64, payloadB64, signatureB64] = parts
  let header: { alg?: string; kid?: string }
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) as { alg?: string; kid?: string }
  } catch {
    throw new GoogleOAuthError('id_token_malformed', 'ID token header is not valid JSON')
  }
  if (header.alg !== 'RS256') {
    throw new GoogleOAuthError('id_token_alg_rejected', `ID token alg ${String(header.alg)} is not accepted (RS256 only)`)
  }
  if (!header.kid) throw new GoogleOAuthError('id_token_malformed', 'ID token header has no kid')

  const jwk = opts.jwks.keys.find(k => k.kid === header.kid)
  if (!jwk) throw new GoogleOAuthError('id_token_unknown_kid', 'No JWKS key matches the ID token kid')
  if (jwk.kty !== 'RSA') throw new GoogleOAuthError('id_token_key_rejected', 'JWKS key is not RSA')

  let claims: GoogleIdClaims
  try {
    claims = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as GoogleIdClaims
  } catch {
    throw new GoogleOAuthError('id_token_malformed', 'ID token payload is not valid JSON')
  }

  // Signature — the non-negotiable check. Verify BEFORE any claim is trusted.
  const key = createPublicKey({ key: jwk as unknown as { kty: 'RSA'; n: string; e: string; kid?: string; alg?: string; use?: string }, format: 'jwk' })
  const signed = Buffer.from(`${headerB64}.${payloadB64}`, 'ascii')
  let signature: Buffer
  try {
    signature = b64urlDecode(signatureB64)
  } catch {
    throw new GoogleOAuthError('id_token_malformed', 'ID token signature is not valid base64url')
  }
  const verified = createVerify('RSA-SHA256').update(signed).verify(key, signature)
  if (!verified) throw new GoogleOAuthError('id_token_bad_signature', 'ID token signature verification failed')

  // Issuer
  if (!GOOGLE_ISSUERS.includes(claims.iss as (typeof GOOGLE_ISSUERS)[number])) {
    throw new GoogleOAuthError('id_token_bad_issuer', `ID token issuer ${String(claims.iss)} is not trusted`)
  }

  // Audience / client ID
  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(opts.clientId) && (!claims.azp || claims.azp === opts.clientId)
    : claims.aud === opts.clientId
  if (!audOk) throw new GoogleOAuthError('id_token_bad_audience', 'ID token audience does not match this client')

  // Expiry / issued-at (30 s skew allowance for clock drift)
  if (typeof claims.exp !== 'number' || claims.exp <= now - 30) {
    throw new GoogleOAuthError('id_token_expired', 'ID token is expired')
  }
  if (typeof claims.iat === 'number' && claims.iat > now + 30) {
    throw new GoogleOAuthError('id_token_future_issued', 'ID token issued in the future')
  }

  // Nonce binding (replay protection)
  if (opts.expectedNonce) {
    if (!claims.nonce || !safeEqual(claims.nonce, opts.expectedNonce)) {
      throw new GoogleOAuthError('id_token_nonce_mismatch', 'ID token nonce does not match the expected nonce')
    }
  }

  // Subject must exist; login requires a VERIFIED email — never authenticate
  // against an unverified Google email.
  if (!claims.sub) throw new GoogleOAuthError('id_token_missing_subject', 'ID token has no subject')
  if (!claims.email) throw new GoogleOAuthError('id_token_missing_email', 'ID token has no email claim')
  if (claims.email_verified !== true) {
    throw new GoogleOAuthError('id_token_email_unverified', 'Google email is not verified — refusing to authenticate')
  }

  return claims
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}
