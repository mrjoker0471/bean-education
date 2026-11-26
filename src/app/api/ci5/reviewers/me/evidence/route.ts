// ─── BEAN Classroom Intelligence (CI-6B): protected credential-evidence upload ─
// POST /api/ci5/reviewers/me/evidence — multipart upload of one credential
//   evidence file into the RESTRICTED evidence store (db/evidence/, 0600).
// GET  /api/ci5/reviewers/me/evidence — the applicant's own evidence METADATA
//   (id/kind/size/hash/state — never content, never storage paths).
//
// Security: session-authenticated (requireStudent) + server-resolved profile
// ownership; content-type validated from MAGIC BYTES (PDF/PNG/JPEG), never the
// client MIME string; hard size cap; rate limited; audit events carry metadata
// only. Files are never served from /public and never appear in ordinary
// profile endpoints — possession of a document is never treated as proof of
// its authenticity.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { applicationsDbFromPrisma, recordEvidenceUpload, listApplicationEvidence, EVIDENCE_MAX_BYTES, EVIDENCE_KINDS, type EvidenceKind } from '@/lib/ci/fleet/applications'
import { clientKey, rateLimited } from '@/lib/rate-limit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    // Rate limit BEFORE any parse/write work (credential uploads are a
    // low-volume, high-sensitivity flow).
    if (rateLimited(clientKey(req, `ci6-evidence:${student.id}`), 12, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many evidence uploads in this window — please try again later.' }, { status: 429 })
    }
    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (contentLength > EVIDENCE_MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ error: `evidence file exceeds the ${Math.floor(EVIDENCE_MAX_BYTES / (1024 * 1024))} MiB limit` }, { status: 413 })
    }
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid multipart form.' }, { status: 400 })
    }
    const kindRaw = form.get('kind')
    const file = form.get('file')
    if (typeof kindRaw !== 'string' || !(EVIDENCE_KINDS as readonly string[]).includes(kindRaw)) {
      return NextResponse.json({ error: `evidence kind required (allowed: ${EVIDENCE_KINDS.join(', ')})` }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'evidence file required' }, { status: 400 })
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      return NextResponse.json({ error: `evidence file exceeds the ${Math.floor(EVIDENCE_MAX_BYTES / (1024 * 1024))} MiB limit` }, { status: 413 })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await recordEvidenceUpload(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, {
      kind: kindRaw as EvidenceKind,
      fileName: file.name || 'evidence',
      bytes,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.evidence) return NextResponse.json({ error: 'unexpected missing evidence row' }, { status: 500 })
    const e = result.evidence
    return NextResponse.json(
      {
        evidence: {
          id: e.id,
          kind: e.kind,
          fileName: e.fileName,
          byteSize: e.byteSize,
          sha256: e.sha256,
          mimeType: e.mimeType,
          retentionState: e.retentionState,
          createdAt: e.createdAt,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/ci5/reviewers/me/evidence POST]', err)
    return NextResponse.json({ error: 'Could not store the evidence file — please try again.' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const detailDb = applicationsDbFromPrisma(db)
    const profile = await detailDb.expertReviewerProfile.findUnique({ where: { studentId: student.id } })
    if (!profile) return NextResponse.json({ error: 'no expert application exists for this account' }, { status: 404 })
    const evidence = await listApplicationEvidence(detailDb, profile.id)
    return NextResponse.json({
      evidence: evidence.map((e) => ({
        id: e.id,
        kind: e.kind,
        fileName: e.fileName,
        byteSize: e.byteSize,
        sha256: e.sha256,
        mimeType: e.mimeType,
        retentionState: e.retentionState,
        createdAt: e.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/evidence GET]', err)
    return NextResponse.json({ error: 'Could not load evidence metadata — please try again.' }, { status: 500 })
  }
}
