import { NextRequest, NextResponse } from 'next/server'
import {
  buildGoogleAuthUrl,
  createPkcePair,
  googleOAuthConfig,
  isValidRedirectUri,
  newOpaqueToken,
} from '@/lib/oauth-google'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const OAUTH_STATE_COOKIE = 'bean_oauth_state'
export const OAUTH_VERIFIER_COOKIE = 'bean_oauth_verifier'
export const OAUTH_NONCE_COOKIE = 'bean_oauth_nonce'
const OAUTH_COOKIE_MAX_AGE = 600 // 10 minutes — one attempt, then it expires

// GET — start the Google authorization-code flow (PKCE S256). Rate limited.
// Without credentials this returns a truthful configuration error (503) —
// never a fake login. On success the caller is redirected to Google with
// state/nonce/code-challenge bound into httpOnly SameSite=Lax cookies.
export async function GET(req: NextRequest) {
  const cfg = googleOAuthConfig()
  if (!cfg.configured) {
    return NextResponse.json(
      {
        error: 'Google sign-in is not configured yet — the owner still needs to provide the Google OAuth credentials.',
        code: 'google_not_configured',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  if (!isValidRedirectUri(cfg.redirectUri)) {
    return NextResponse.json(
      { error: 'Google sign-in is misconfigured (invalid redirect URI).', code: 'google_bad_redirect' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  if (rateLimited(clientKey(req, 'oauth-start'), 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment and try again.' }, { status: 429 })
  }

  const state = newOpaqueToken()
  const nonce = newOpaqueToken()
  const pkce = createPkcePair()

  const secure = process.env.NODE_ENV === 'production'
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  }
  const res = NextResponse.redirect(buildGoogleAuthUrl({
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    state,
    codeChallenge: pkce.challenge,
    nonce,
  }))
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookieBase)
  res.cookies.set(OAUTH_VERIFIER_COOKIE, pkce.verifier, cookieBase)
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, cookieBase)
  return res
}
