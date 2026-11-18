import { NextRequest, NextResponse } from 'next/server'
import { destroyCurrentSession, sameOrigin } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — sign out: delete the current session row and clear the cookie.
// Guest mode keeps working afterwards (guest identity lives on the device).
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  try {
    await destroyCurrentSession()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/auth/logout]', err)
    return NextResponse.json({ error: 'Could not sign you out — please try again.' }, { status: 500 })
  }
}
