// ─── BEAN Classroom Intelligence (CI-6E): invitation creation + listing ───────
// POST /api/admin/ci6/invitations — create an expert invitation. The RAW token
// and its claim URL are returned EXACTLY ONCE in this response; only the
// SHA-256 hash is stored. No email delivery is claimed or attempted —
// administrators copy the secure link and share it through their own channel.
// GET  /api/admin/ci6/invitations?status= — operational listing WITHOUT any
// token material.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { invitationsDbFromPrisma, createInvitation, listInvitations } from '@/lib/ci/fleet/invitations'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const admin = { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN administrator' }
    const result = await createInvitation(invitationsDbFromPrisma(db), admin, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.value) return NextResponse.json({ error: 'unexpected missing invitation payload' }, { status: 500 })
    const inv = result.invitation
    return NextResponse.json(
      {
        invitation: {
          id: inv.id,
          category: inv.category,
          status: inv.status,
          expiresAt: inv.expiresAt,
          requestedDomains: JSON.parse(inv.requestedDomainsJson || '[]'),
          requestedLanguages: JSON.parse(inv.requestedLanguagesJson || '[]'),
          note: inv.note,
        },
        // Shown exactly once — the server stores only the SHA-256 hash.
        rawToken: result.value.rawToken,
        claimUrl: result.value.claimUrl,
        note: 'Copy the claim link now — it is shown once and cannot be recovered. Claiming starts or links an application; it never grants reviewer privileges.',
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/admin/ci6/invitations POST]', err)
    return NextResponse.json({ error: 'Could not create the invitation — please try again.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const status = new URL(req.url).searchParams.get('status') ?? undefined
    const invitations = await listInvitations(invitationsDbFromPrisma(db), status ? { status } : {})
    return NextResponse.json({
      invitations: invitations.map((inv) => ({
        id: inv.id,
        category: inv.category,
        status: inv.status,
        expiresAt: inv.expiresAt,
        claimedAt: inv.claimedAt,
        revokedReason: inv.revokedReason,
        note: inv.note,
        requestedDomains: JSON.parse(inv.requestedDomainsJson || '[]'),
        requestedLanguages: JSON.parse(inv.requestedLanguagesJson || '[]'),
        createdByAdminId: inv.createdByAdminId,
        createdAt: inv.createdAt,
      })),
      note: 'Token material is never stored or listed — only the SHA-256 hash.',
    })
  } catch (err) {
    console.error('[api/admin/ci6/invitations GET]', err)
    return NextResponse.json({ error: 'Could not load invitations — please try again.' }, { status: 500 })
  }
}
