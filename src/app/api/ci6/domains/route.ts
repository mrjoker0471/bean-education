// ─── BEAN Classroom Intelligence (CI-6B): public application vocabulary ───────
// GET /api/ci6/domains — the PUBLIC, non-sensitive vocabulary the expert
// application form needs: registered domain-pack domains (id + title from the
// CI-3 pack registry — the same source validateReviewerScope enforces),
// reviewer categories, credential-evidence kinds and language tasks. Contains
// no personal data, no qualification state, no internal notes.

import { NextResponse } from 'next/server'
import { listDomainPacks } from '@/lib/ci/fleet/domain-packs'
import '@/lib/ci/fleet/packs/registry'
import { REVIEWER_CATEGORY } from '@/lib/ci/fleet/reviewers'
import { EVIDENCE_KINDS } from '@/lib/ci/fleet/applications'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const domains = listDomainPacks().map(({ pack }) => ({
      domainId: pack.domainId,
      title: pack.title,
    }))
    return NextResponse.json({
      domains,
      categories: [...REVIEWER_CATEGORY],
      evidenceKinds: [...EVIDENCE_KINDS],
      note: 'Proposed domains and specialties are advisory — the administrator-approved scope remains the authoritative authority (CI-5B).',
    })
  } catch (err) {
    console.error('[api/ci6/domains GET]', err)
    return NextResponse.json({ error: 'Could not load the application vocabulary — please try again.' }, { status: 500 })
  }
}
