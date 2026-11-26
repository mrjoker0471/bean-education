// ─── BEAN Classroom Intelligence (CI-6B): own-evidence access + purge ─────────
// GET    /api/ci5/reviewers/me/evidence/[evidenceId] — stream the applicant's
//        OWN evidence file from the restricted store (session-authenticated,
//        ownership-checked; never a public URL; nosniff; private caching).
// DELETE /api/ci5/reviewers/me/evidence/[evidenceId] — applicant purge of an
//        ACTIVE file (bytes removed; metadata + hash retained; audited).

import { NextResponse, type NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import { requireStudent } from '@/lib/auth'
import { applicationsDbFromPrisma, getActiveEvidenceFile, purgeOwnEvidence } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ evidenceId: string }> }) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const { evidenceId } = await params
    const found = await getActiveEvidenceFile(applicationsDbFromPrisma(db), evidenceId)
    // 404 for both missing and non-owned evidence — no existence leak.
    if (!found || found.row.uploadedByStudentId !== student.id) {
      return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })
    }
    const bytes = await readFile(found.absolutePath)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': found.row.mimeType,
        'Content-Length': String(bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="evidence${found.row.mimeType === 'application/pdf' ? '.pdf' : ''}"`,
      },
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/evidence/[evidenceId] GET]', err)
    return NextResponse.json({ error: 'Could not read the evidence file — please try again.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ evidenceId: string }> }) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const { evidenceId } = await params
    let body: { reason?: unknown } = {}
    try {
      body = (await req.json()) as { reason?: unknown }
    } catch {
      body = {}
    }
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0 ? body.reason : 'evidence removed by applicant'
    const result = await purgeOwnEvidence(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, evidenceId, reason)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.evidence) return NextResponse.json({ error: 'unexpected missing evidence row' }, { status: 500 })
    return NextResponse.json({
      evidence: {
        id: result.evidence.id,
        retentionState: result.evidence.retentionState,
        purgedAt: result.evidence.purgedAt,
      },
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/evidence/[evidenceId] DELETE]', err)
    return NextResponse.json({ error: 'Could not purge the evidence file — please try again.' }, { status: 500 })
  }
}
