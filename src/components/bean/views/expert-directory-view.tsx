'use client'

// ─── BEAN Classroom Intelligence (CI-6D): public expert directory ─────────────
// #/experts — consent-gated expert profiles with the FIVE distinct capability
// states displayed separately (applicant / credential-verified /
// reviewer-eligible / domain approvals / language verified). Real APIs only;
// zero states are shown as zero. No credentials, verification notes, COI text
// or audit data exist on this surface by construction (server-side projection).

import { useCallback, useEffect, useState } from 'react'
import { Loader2, GraduationCap, BadgeCheck, ShieldCheck, Award, Languages } from 'lucide-react'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'

interface PublicExpert {
  profileId: string
  displayName: string
  category: string
  status: string
  applicant: boolean
  credentialVerified: boolean
  reviewerEligible: boolean
  domainApprovals: number
  languageVerified: number
  verifiedAreas: string[]
  specialties: string[]
  professionalSummary: string | null
  availabilityNote: string | null
  affiliation: string | null
}

export function ExpertDirectoryView() {
  const [experts, setExperts] = useState<PublicExpert[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ experts: PublicExpert[] }>('/api/ci6/experts')
      setExperts(data.experts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8" data-testid="ci6-expert-directory">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
          <GraduationCap className="h-4 w-4 text-gold" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-lg sm:text-xl">Expert network</h1>
          <p className="text-xs text-muted-foreground">
            Real, independently verified subject experts. Each capability state is derived from its own authoritative ledger — nothing is inferred.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16" role="status" data-testid="ci6-directory-loading" aria-label="Loading expert directory">
          <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="mt-6 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && (experts ?? []).length === 0 && (
        <div className="mt-6" data-testid="ci6-directory-empty">
          <EmptyState
            icon={GraduationCap}
            title="No listed experts yet"
            description="Real experts appear here only after they apply, are independently verified, and consent to public listing. The verified-expert count is genuinely zero today."
            actionLabel="Apply as an expert"
            onAction={() => { window.location.hash = '#/expert-apply' }}
          />
        </div>
      )}

      {!loading && !error && (experts ?? []).length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="ci6-directory-list">
          {(experts ?? []).map((e) => (
            <article key={e.profileId} className="rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci6-expert-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg">{e.displayName}</span>
                <span className="rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] text-muted-foreground">{e.category.replaceAll('_', ' ').toLowerCase()}</span>
                {e.reviewerEligible && (
                  <span className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] text-success" data-testid="ci6-state-eligible">
                    <ShieldCheck className="h-3 w-3" aria-hidden /> reviewer eligible
                  </span>
                )}
              </div>
              {e.affiliation && <p className="mt-1 text-xs text-muted-foreground">{e.affiliation}</p>}
              {e.professionalSummary && <p className="mt-2 text-sm">{e.professionalSummary}</p>}
              {e.specialties.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {e.specialties.map((s) => (
                    <span key={s} className="rounded-full border border-border bg-page/40 px-2 py-0.5 text-[10px] text-muted-foreground">{s}</span>
                  ))}
                </div>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs" data-testid="ci6-expert-states">
                <div className="rounded border border-border bg-page/40 px-2 py-1.5">
                  <dt className="flex items-center gap-1 text-muted-foreground"><BadgeCheck className="h-3 w-3" aria-hidden /> credential verified</dt>
                  <dd className={e.credentialVerified ? 'text-success' : 'text-muted-foreground'}>{e.credentialVerified ? 'yes' : 'no'}</dd>
                </div>
                <div className="rounded border border-border bg-page/40 px-2 py-1.5">
                  <dt className="flex items-center gap-1 text-muted-foreground"><Award className="h-3 w-3" aria-hidden /> domain approvals</dt>
                  <dd className={e.domainApprovals > 0 ? 'text-success' : 'text-muted-foreground'}>{e.domainApprovals}</dd>
                </div>
                <div className="rounded border border-border bg-page/40 px-2 py-1.5">
                  <dt className="flex items-center gap-1 text-muted-foreground"><Languages className="h-3 w-3" aria-hidden /> language verified</dt>
                  <dd className={e.languageVerified > 0 ? 'text-success' : 'text-muted-foreground'}>{e.languageVerified}</dd>
                </div>
                <div className="rounded border border-border bg-page/40 px-2 py-1.5">
                  <dt className="text-muted-foreground">applicant state</dt>
                  <dd className={e.applicant ? 'text-gold' : 'text-muted-foreground'}>{e.applicant ? 'in review' : 'past application'}</dd>
                </div>
              </dl>
              {e.verifiedAreas.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Verified areas: {e.verifiedAreas.join(', ')}</p>
              )}
              {e.availabilityNote && <p className="mt-1 text-xs text-muted-foreground">Availability: {e.availabilityNote}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
