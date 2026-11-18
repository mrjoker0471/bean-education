import { NextResponse } from 'next/server'
import { getSessionStudent } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — who is signed in? `student` is null for guests; guest mode keeps
// working without any session. Always no-store: never cache identity.
export async function GET() {
  try {
    const student = await getSessionStudent()
    return NextResponse.json({ student }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/auth/me]', err)
    return NextResponse.json(
      { student: null, error: 'Could not check your session — please try again.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
