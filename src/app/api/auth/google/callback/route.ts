import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, createSession } from '@/lib/auth'
import {
  exchangeAuthorizationCode,
  fetchGoogleJwks,
  googleOAuthConfig,
  safeEqual,
  verifyGoogleIdToken,
  type GoogleOAuthError,
} from '@/lib/oauth-google'
import { clientKey, rateLimited } from '@/lib/rate-limit'
import { OAUTH_NONCE_COOKIE, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from '../start/route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PENDING_TTL_MS = 10 * 60_000

function secureCookieBase() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  }
}

function clearOAuthCookies(res: NextResponse): void {
  for (const name of [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_NONCE_COOKIE]) {
    res.cookies.set(name, '', { ...secureCookieBase(), maxAge: 0 })
  }
}

/** All outcomes are redirects back to #/auth with explicit query markers —
 *  the client keeps full routing control and the user never sees a dead end. */
function redirectAuth(base: URL, marker: Record<string, string>): NextResponse {
  const params = new URLSearchParams(marker)
  return NextResponse.redirect(new URL(`/#/auth?${params.toString()}`, base.origin))
}

function signInAndRedirect(base: URL, studentId: string, marker: Record<string, string>): Promise<NextResponse> {
  return createSession(studentId).then(({ token, expiresAt }) => {
    const res = redirectAuth(base, marker)
    clearOAuthCookies(res)
    res.cookies.set(SESSION_COOKIE, token, { ...secureCookieBase(), expires: expiresAt })
    return res
  })
}

// GET — Google OAuth callback. Validates state (cookie↔query, timing-safe),
// exchanges the code with the PKCE verifier, verifies the ID token (signature
// via Google JWKS, issuer, audience, expiry, nonce, email_verified), then:
//   • known Google subject  → sign in (session cookie) → #/auth?google_done=1
//   • email match, account has no password (Google-created) → link directly
//   • email match, password account → short-lived pending LINK record; the
//     client asks for the account password as proof of ownership
//   • no account → pending SIGNUP record; the client collects the SAME legal
//     acceptance (terms/privacy/age declaration) as normal registration
// No Google access/refresh tokens are stored — only the verified identity.
// OAuth can never raise a role: authorization stays on the Student row.
export async function GET(req: NextRequest) {
  const base = new URL(req.url)
  const fail = (marker: Record<string, string>) => {
    const res = redirectAuth(base, marker)
    clearOAuthCookies(res)
    return res
  }

  const cfg = googleOAuthConfig()
  if (!cfg.configured) return fail({ google_error: 'not_configured' })

  if (rateLimited(clientKey(req, 'oauth-callback'), 20, 60_000)) {
    return fail({ google_error: 'rate_limited' })
  }

  // Google may report an error (user cancelled consent, etc.) — surface it honestly.
  const providerError = req.nextUrl.searchParams.get('error')
  if (providerError) return fail({ google_error: providerError === 'access_denied' ? 'cancelled' : 'provider_error' })

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  if (!code || !state) return fail({ google_error: 'missing_parameters' })

  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value
  const verifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value
  const nonceCookie = req.cookies.get(OAUTH_NONCE_COOKIE)?.value
  if (!cookieState || !verifier || !nonceCookie) return fail({ google_error: 'expired' })
  if (!safeEqual(cookieState, state)) return fail({ google_error: 'invalid_state' })

  let claims
  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      verifier,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: cfg.redirectUri,
    })
    const jwks = await fetchGoogleJwks(null)
    claims = await verifyGoogleIdToken({
      idToken: tokens.id_token,
      clientId: cfg.clientId,
      jwks,
      expectedNonce: nonceCookie,
    })
  } catch (err) {
    const errCode = (err as GoogleOAuthError).code
    if (errCode) {
      const markerMap: Record<string, string> = {
        token_exchange_failed: 'token_exchange_failed',
        jwks_unavailable: 'temporarily_unavailable',
        id_token_expired: 'id_token_expired',
        id_token_nonce_mismatch: 'invalid_nonce',
        id_token_bad_issuer: 'invalid_issuer',
        id_token_bad_audience: 'invalid_audience',
        id_token_bad_signature: 'invalid_signature',
        id_token_email_unverified: 'email_unverified',
        id_token_unknown_kid: 'temporarily_unavailable',
      }
      return fail({ google_error: markerMap[errCode] ?? 'verification_failed' })
    }
    console.error('[api/auth/google/callback] unexpected failure', (err as Error).name)
    return fail({ google_error: 'verification_failed' })
  }

  try {
    const email = (claims.email ?? '').toLowerCase()
    const identity = await db.oAuthIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: claims.sub } },
      include: { student: { select: { id: true } } },
    })

    if (identity) {
      // Known subject — sign in. The role lives on the Student row and is
      // never altered by OAuth; Google cannot grant teacher or admin rights.
      return await signInAndRedirect(base, identity.studentId, { google_done: '1' })
    }

    const account = await db.student.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    })

    if (account && !account.passwordHash) {
      // Password-less (Google-created) account with no identity row: the
      // verified Google email plus the absence of any other credential is the
      // ownership proof. Link and sign in. No password is ever overwritten —
      // there is none.
      await db.oAuthIdentity.create({ data: { provider: 'google', subject: claims.sub, studentId: account.id } })
      return await signInAndRedirect(base, account.id, { google_done: '1' })
    }

    if (account) {
      // Existing password account: linking requires proof of ownership. Park
      // the verified identity server-side for 10 minutes; the client collects
      // the account password before any link happens.
      await db.oAuthPendingAuth.deleteMany({ where: { provider: 'google', subject: claims.sub } })
      const pending = await db.oAuthPendingAuth.create({
        data: {
          provider: 'google',
          subject: claims.sub,
          email,
          displayName: claims.name ?? null,
          purpose: 'LINK',
          expiresAt: new Date(Date.now() + PENDING_TTL_MS),
        },
      })
      const res = redirectAuth(base, { google_link: pending.id, google_email: email })
      clearOAuthCookies(res)
      return res
    }

    // New visitor — first-time signup goes through the same legal acceptance
    // as normal registration (terms version, privacy notice, age declaration).
    await db.oAuthPendingAuth.deleteMany({ where: { provider: 'google', subject: claims.sub } })
    const pending = await db.oAuthPendingAuth.create({
      data: {
        provider: 'google',
        subject: claims.sub,
        email,
        displayName: claims.name ?? null,
        purpose: 'SIGNUP',
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    })
    const res = redirectAuth(base, { google_signup: pending.id, google_email: email })
    clearOAuthCookies(res)
    return res
  } catch (err) {
    console.error('[api/auth/google/callback]', (err as Error).name)
    return fail({ google_error: 'unexpected' })
  }
}
