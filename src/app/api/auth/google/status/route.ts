import { NextResponse } from 'next/server'
import { googleOAuthConfig } from '@/lib/oauth-google'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — public configuration-status probe for the Google sign-in button.
// Returns NO secrets — only whether the owner has configured the integration.
// The UI disables the button with an honest message until credentials exist;
// an attempted start without credentials returns a truthful error instead of
// faking a login.
export async function GET() {
  const cfg = googleOAuthConfig()
  return NextResponse.json(
    { configured: cfg.configured },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
