// ─── BEAN Classroom Intelligence (CI-6C): restricted evidence access ──────────
// GET /api/admin/ci6/evidence/[evidenceId] — the ONLY way an authorised
// administrator reads a credential-evidence file. requireAdmin-guarded,
// nosniff, no-store, never a public URL, never listed by ordinary profile
// endpoints. Purged evidence returns 410 (metadata survives; bytes do not).

import { NextResponse, type NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import { requireAdmin } from '@/lib/teach'
import { evidenceFilePath } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ evidenceId: string }> }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { evidenceId } = await params
    const row = await db.expertCredentialEvidence.findUnique({ where: { id: evidenceId } })
    // 404 for missing / non-existent; 410 for purged (honest retention state);
    // no existence leak between the two for unauthorised callers — this route
    // is admin-only to begin with.
    if (!row) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })
    if (row.retentionState !== 'ACTIVE') {
      return NextResponse.json({ error: 'Evidence has been purged (metadata and hash retained)' }, { status: 410 })
    }
    let bytes: Buffer
    try {
      bytes = await readFile(evidenceFilePath(row.storagePath))
    } catch {
      return NextResponse.json({ error: 'Evidence content is no longer retained' }, { status: 410 })
    }
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': row.mimeType,
        'Content-Length': String(bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
      },
    })
  } catch (err) {
    console.error('[api/admin/ci6/evidence/[evidenceId] GET]', err)
    return NextResponse.json({ error: 'Could not read the evidence file — please try again.' }, { status: 500 })
  }
}
