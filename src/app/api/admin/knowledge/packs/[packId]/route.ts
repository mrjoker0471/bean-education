// ─── BEAN Classroom Intelligence (CI-4C): admin pack inspection ──────────────
// GET /api/admin/knowledge/packs/[packId] — ADMIN-only deep inspection: the
// pack content, its machine-gate validation (V1–V8 checks), declared source
// references WITH their licence restrictions (read-only provenance), the
// domain fixtures it cites, and the FULL append-only review history. The
// source records are deliberately surfaced as read-only: a reviewer can never
// approve or alter a source licence on behalf of its rights holder from here.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { getDomainPack } from '@/lib/ci/fleet/domain-packs'
import { listPackReviews, resolveCuratedStatus, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { getSource } from '@/lib/ci/fleet/sources'
import { ensurePackSourcesRegistered } from '@/lib/ci/fleet/packs/sources'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const { packId } = await params
    ensurePackSourcesRegistered()
    const entry = getDomainPack(packId)
    if (!entry) {
      return NextResponse.json({ error: `unknown pack: ${packId}` }, { status: 404 })
    }

    const reviews = await listPackReviews(curatorDbFromPrisma(db), packId)
    const curated = resolveCuratedStatus(entry.pack, reviews)

    // Read-only provenance snapshot for the inspector (licence facts only).
    const sources = entry.pack.sources.map((ref) => {
      const rec = getSource(ref.sourceId)
      return {
        sourceId: ref.sourceId,
        scope: ref.scope,
        spdx: rec?.licence.spdx ?? null,
        restrictions: rec?.licence.restrictions ?? [],
        licenceVerifiedAt: rec?.licence.verifiedAt ?? null,
        qualityClass: rec?.qualityClass ?? null,
        attribution: rec?.attribution ?? null,
        readonly: true,
      }
    })

    return NextResponse.json({
      pack: {
        domainId: entry.pack.domainId,
        title: entry.pack.title,
        riskClass: entry.pack.riskClass,
        packVersion: entry.pack.packVersion,
        declaredStatus: entry.pack.status,
        checksum: entry.checksum,
        iscedCodes: entry.pack.iscedCodes,
        relatedSubjectDomainIds: entry.pack.relatedSubjectDomainIds,
        safetyBoundary: entry.pack.safetyBoundary,
        allowedTasks: entry.pack.allowedTasks,
        prohibitedTasks: entry.pack.prohibitedTasks,
        competencyLevels: entry.pack.competencyLevels,
        glossarySize: entry.pack.glossary.length,
        languageSupport: entry.pack.languageSupport,
        benchmark: entry.pack.benchmark,
        changeHistory: entry.pack.changeHistory,
      },
      curated,
      sources,
      reviews,
    })
  } catch (err) {
    console.error('[api/admin/knowledge/packs/[packId] GET]', err)
    return NextResponse.json({ error: 'Could not load the pack — please try again.' }, { status: 500 })
  }
}
