// ─── Legal acceptance status (server-side) ────────────────────────────────────
// Computes per-student legal acceptance state against the CURRENT policy
// versions. Used by /api/auth/me (re-acceptance gating) and the export.
// The server validates versions itself — browsers cannot assert acceptance by
// sending a version string; acceptance rows are only written by routes that
// compare against CURRENT_TERMS_VERSION / CURRENT_PRIVACY_VERSION.

import { db } from '@/lib/db'
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@/lib/legal-config'

export interface LegalDocumentStatus {
  document: 'TERMS' | 'PRIVACY'
  currentVersion: string
  acceptedVersion: string | null
  acceptedAt: string | null
}

export interface LegalStatus {
  reacceptanceRequired: boolean
  terms: LegalDocumentStatus
  privacy: LegalDocumentStatus
}

export async function legalStatusForStudent(studentId: string | null | undefined): Promise<LegalStatus | null> {
  const current = (): LegalStatus => ({
    reacceptanceRequired: false,
    terms: { document: 'TERMS', currentVersion: CURRENT_TERMS_VERSION, acceptedVersion: null, acceptedAt: null },
    privacy: { document: 'PRIVACY', currentVersion: CURRENT_PRIVACY_VERSION, acceptedVersion: null, acceptedAt: null },
  })
  if (!studentId) return null
  const rows = await db.legalAcceptance.findMany({
    where: { studentId },
    orderBy: { acceptedAt: 'desc' },
    select: { document: true, version: true, acceptedAt: true },
  })
  const status = current()
  for (const doc of ['TERMS', 'PRIVACY'] as const) {
    const latest = rows.find(r => r.document === doc)
    const target = doc === 'TERMS' ? status.terms : status.privacy
    target.acceptedVersion = latest?.version ?? null
    target.acceptedAt = latest ? latest.acceptedAt.toISOString() : null
  }
  status.reacceptanceRequired =
    status.terms.acceptedVersion !== CURRENT_TERMS_VERSION || status.privacy.acceptedVersion !== CURRENT_PRIVACY_VERSION
  return status
}
