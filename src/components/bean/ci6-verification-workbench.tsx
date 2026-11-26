'use client'

// ─── BEAN Classroom Intelligence (CI-6C): independent verification workbench ───
// Administrator surface for verifying REAL expert applicants, wired to the
// REAL backend APIs only (no mock data, no fabricated third-party results):
//   • Queue of open applications (account association included — authorised
//     personnel only).
//   • Per-application workbench: application detail, credential-evidence
//     metadata with restricted-streaming view links, the information-request
//     loop, and the append-only verification records.
//   • Verification form: honest method vocabulary (DOCUMENT_EXAMINATION /
//     ISSUING_BODY_REFERENCE / PUBLISHED_REGISTRY), documented reason for
//     every decision, expiry where applicable. Refusals surface verbatim.
//   • The reviewer LIFECYCLE decision (approve/activate) deliberately stays in
//     the CI-5B Reviewers tab — verification records never change status.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, FileCheck, RefreshCw, ExternalLink, MessageSquarePlus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { toast } from '@/hooks/use-toast'

interface QueueItem {
  profileId: string
  reviewerCode: string
  category: string
  status: string
  account: { email: string; displayName: string | null; createdAt: string } | null
  qualificationCategory: string | null
  professionalExperience: string | null
  institutionAffiliation: string | null
  issuingBody: string | null
  specialties: string[]
  conflictOfInterest: string
  applicationConsentAt: string | null
  evidenceCount: number
  verification: { verified: boolean; latestDecision: string | null; recordCount: number }
  createdAt: string
}

interface WorkbenchDetail {
  profile: {
    id: string
    reviewerCode: string
    category: string
    status: string
    qualificationCategory: string | null
    professionalExperience: string | null
    issuingBody: string | null
    institutionAffiliation: string | null
    specialties: string[]
    conflictOfInterest: string
    verificationStatus: string
    applicationConsentAt: string | null
    scope: { approvedDomains: string[]; approvedLanguages: { tag: string; tasks: string[]; domains?: string[] }[] }
    expiresAt: string | null
    createdAt: string
  }
  account: { email: string; displayName: string | null; createdAt: string; role: string } | null
  evidence: { id: string; kind: string; fileName: string; byteSize: number; sha256: string; mimeType: string; retentionState: string; createdAt: string }[]
  infoRequests: { id: string; requestText: string; status: string; responseText: string | null; requestedByAdminId: string; requestedAt: string; answeredAt: string | null }[]
  verificationRecords: { id: string; credentialType: string; issuingInstitution: string; qualificationScope: string; evidenceIds: string[]; verificationMethod: string; referenceDetail: string | null; decision: string; reason: string; expiresAt: string | null; verifiedByAdminId: string; verifiedAt: string }[]
  verificationState: { verified: boolean; latestDecision: string | null; verifiedRecordIds: string[] }
  events: { id: string; eventType: string; actorKind: string; actorId: string; rationale: string | null; createdAt: string }[]
}

const CREDENTIAL_TYPES = ['DEGREE', 'CERTIFICATION', 'LICENCE', 'EMPLOYMENT', 'PUBLICATION', 'REFERENCE', 'OTHER']
const VERIFICATION_METHODS = ['DOCUMENT_EXAMINATION', 'ISSUING_BODY_REFERENCE', 'PUBLISHED_REGISTRY']

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'VERIFIED' || status === 'ACTIVE'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'REJECTED' || status === 'SUPERSEDED'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : status === 'NEEDS_MORE_EVIDENCE'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : 'border-gold/40 bg-gold/10 text-gold'
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{status.replaceAll('_', ' ').toLowerCase()}</span>
}

export function Ci6VerificationWorkbench() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<WorkbenchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [infoText, setInfoText] = useState('')
  const [form, setForm] = useState({
    credentialType: 'DEGREE',
    issuingInstitution: '',
    qualificationScope: '',
    verificationMethod: 'DOCUMENT_EXAMINATION',
    referenceDetail: '',
    reason: '',
    expiresAt: '',
    evidenceIds: [] as string[],
  })

  const loadQueue = useCallback(async () => {
    setLoading(true)
    const q = await api.get<{ queue: QueueItem[] }>('/api/admin/ci6/applications').catch(() => ({ queue: [] }))
    setQueue(q.queue)
    setLoading(false)
  }, [])

  const loadDetail = useCallback(async (profileId: string) => {
    const d = await api.get<WorkbenchDetail>(`/api/admin/ci6/applications/${profileId}`).catch(() => null)
    setDetail(d)
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (selected) void loadDetail(selected)
    else setDetail(null)
  }, [selected, loadDetail])

  async function recordVerification() {
    if (!detail) return
    setBusy(true)
    try {
      await api.post(`/api/admin/ci6/applications/${detail.profile.id}/verification`, {
        credentialType: form.credentialType,
        issuingInstitution: form.issuingInstitution.trim(),
        qualificationScope: form.qualificationScope.trim(),
        verificationMethod: form.verificationMethod,
        evidenceIds: form.verificationMethod === 'DOCUMENT_EXAMINATION' ? form.evidenceIds : undefined,
        referenceDetail: form.verificationMethod === 'DOCUMENT_EXAMINATION' ? undefined : form.referenceDetail.trim() || undefined,
        decision: 'VERIFIED',
        reason: form.reason.trim(),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      })
      toast({ title: 'Verification recorded', description: 'Append-only record stored. Lifecycle decisions remain in the Reviewers tab.' })
      setForm((f) => ({ ...f, reason: '', referenceDetail: '', evidenceIds: [] }))
      await loadDetail(detail.profile.id)
      await loadQueue()
    } catch (err) {
      toast({ title: 'Verification refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function recordAdverse(decision: 'REJECTED' | 'NEEDS_MORE_EVIDENCE' | 'SUPERSEDED') {
    if (!detail) return
    setBusy(true)
    try {
      await api.post(`/api/admin/ci6/applications/${detail.profile.id}/verification`, {
        credentialType: form.credentialType,
        issuingInstitution: form.issuingInstitution.trim() || 'unspecified',
        qualificationScope: form.qualificationScope.trim() || 'unspecified',
        verificationMethod: form.verificationMethod,
        decision,
        reason: form.reason.trim(),
      })
      toast({ title: `Recorded: ${decision.toLowerCase().replaceAll('_', ' ')}` })
      await loadDetail(detail.profile.id)
      await loadQueue()
    } catch (err) {
      toast({ title: 'Refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function sendInfoRequest() {
    if (!detail) return
    if (infoText.trim().length < 20) {
      toast({ title: 'Be specific', description: 'Information requests must be at least 20 characters.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await api.post(`/api/admin/ci6/applications/${detail.profile.id}/info-request`, { requestText: infoText.trim() })
      toast({ title: 'Information request sent' })
      setInfoText('')
      await loadDetail(detail.profile.id)
    } catch (err) {
      toast({ title: 'Refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" data-testid="ci6-verification-loading" aria-label="Loading verification queue">
        <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="ci6-verification-workbench">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Independent, human, append-only verification. Verification records never change reviewer status by themselves.</p>
        <Button variant="outline" size="sm" className="min-h-[44px] shrink-0 border-border bg-elevated" onClick={() => void loadQueue()} aria-label="Refresh queue">
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {queue.length === 0 ? (
        <EmptyState icon={FileCheck} title="No open applications" description="Applications appear here when real experts apply through #/expert-apply." />
      ) : (
        <div className="space-y-2">
          {queue.map((q) => (
            <button
              key={q.profileId}
              type="button"
              onClick={() => setSelected(q.profileId === selected ? null : q.profileId)}
              aria-expanded={q.profileId === selected}
              className="w-full rounded-xl border border-border bg-elevated/60 p-4 text-left hover:border-gold/40"
              data-testid="ci6-queue-row"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{q.reviewerCode}</span>
                <span className="rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] text-muted-foreground">{q.status.replaceAll('_', ' ').toLowerCase()}</span>
                <span className="text-xs text-muted-foreground">{q.account?.email ?? 'account unlinked'}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {q.evidenceCount} evidence · {q.verification.recordCount} records {q.verification.verified ? '· verified' : ''}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{q.qualificationCategory ?? 'no qualification stated'} {q.institutionAffiliation ? `· ${q.institutionAffiliation}` : ''}</div>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <div className="space-y-4 rounded-xl border border-gold/30 bg-gold/5 p-4" data-testid="ci6-workbench-detail">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-gold" aria-hidden />
            <span className="font-display text-lg">{detail.profile.reviewerCode}</span>
            <StatusBadge status={detail.profile.status} />
            {detail.verificationState.verified && <StatusBadge status="VERIFIED" />}
            <span className="text-xs text-muted-foreground">{detail.account?.email}</span>
          </div>

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2" data-testid="ci6-detail-fields">
            <div><dt className="text-xs text-muted-foreground">Qualification</dt><dd className="min-w-0 break-words">{detail.profile.qualificationCategory ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Affiliation</dt><dd className="min-w-0 break-words">{detail.profile.institutionAffiliation ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Issuing body</dt><dd className="min-w-0 break-words">{detail.profile.issuingBody ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Specialties</dt><dd className="min-w-0 break-words">{detail.profile.specialties.join(', ') || '—'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Conflict-of-interest declaration</dt><dd className="min-w-0 break-words">{detail.profile.conflictOfInterest}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Consent</dt><dd>{detail.profile.applicationConsentAt ? `recorded ${new Date(detail.profile.applicationConsentAt).toLocaleString()}` : 'not recorded'}</dd></div>
          </dl>

          <div>
            <p className="text-sm font-medium">Credential evidence (restricted store)</p>
            <ul className="mt-2 space-y-2" data-testid="ci6-admin-evidence-list">
              {detail.evidence.length === 0 && <li className="text-xs text-muted-foreground">No evidence uploaded.</li>}
              {detail.evidence.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-page/40 px-3 py-2" data-testid="ci6-admin-evidence-row">
                  <span className="min-w-0 text-xs">
                    <span className="font-medium">{e.kind.replaceAll('_', ' ')}</span>
                    <span className="ml-2 text-muted-foreground">{e.fileName} · {(e.byteSize / 1024).toFixed(0)} KiB · sha256 {e.sha256.slice(0, 12)}… · {e.retentionState.toLowerCase()}</span>
                  </span>
                  {e.retentionState === 'ACTIVE' && (
                    <a href={`/api/admin/ci6/evidence/${e.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded border border-border bg-elevated px-3 text-xs text-gold hover:bg-gold/10">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      Examine
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-border bg-elevated/80 p-3" data-testid="ci6-verification-form">
            <p className="text-sm font-medium">Record a verification examination</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ci6-ctype" className="text-xs text-muted-foreground">Credential type</label>
                <select id="ci6-ctype" aria-label="Credential type" value={form.credentialType} onChange={(e) => setForm((f) => ({ ...f, credentialType: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm">
                  {CREDENTIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ci6-cmethod" className="text-xs text-muted-foreground">Verification method</label>
                <select id="ci6-cmethod" aria-label="Verification method" value={form.verificationMethod} onChange={(e) => setForm((f) => ({ ...f, verificationMethod: e.target.value, evidenceIds: [] }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm">
                  {VERIFICATION_METHODS.map((m) => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ci6-cinst" className="text-xs text-muted-foreground">Issuing institution</label>
                <input id="ci6-cinst" aria-label="Issuing institution" value={form.issuingInstitution} onChange={(e) => setForm((f) => ({ ...f, issuingInstitution: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="ci6-cscope" className="text-xs text-muted-foreground">Scope the credential covers</label>
                <input id="ci6-cscope" aria-label="Qualification scope" value={form.qualificationScope} onChange={(e) => setForm((f) => ({ ...f, qualificationScope: e.target.value }))} placeholder="e.g. mathematics, hi:TRANSLATION" className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
              </div>
              {form.verificationMethod === 'DOCUMENT_EXAMINATION' ? (
                <div className="sm:col-span-2">
                  <span className="text-xs text-muted-foreground">Documents examined (possession is not proof of authenticity — record what you actually examined)</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detail.evidence.filter((e) => e.retentionState === 'ACTIVE').length === 0 && <span className="text-xs text-muted-foreground">No ACTIVE evidence to examine.</span>}
                    {detail.evidence.filter((e) => e.retentionState === 'ACTIVE').map((e) => {
                      const on = form.evidenceIds.includes(e.id)
                      return (
                        <button key={e.id} type="button" aria-pressed={on} onClick={() => setForm((f) => ({ ...f, evidenceIds: on ? f.evidenceIds.filter((x) => x !== e.id) : [...f.evidenceIds, e.id] }))} className={`min-h-[44px] rounded-full border px-3 text-xs ${on ? 'border-gold/40 bg-gold/10 text-gold' : 'border-border bg-elevated text-muted-foreground'}`}>
                          {e.kind.replaceAll('_', ' ')} · {e.fileName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <label htmlFor="ci6-cref" className="text-xs text-muted-foreground">Reference detail (registry entry / issuing-body contact) — required</label>
                  <input id="ci6-cref" aria-label="Reference detail" value={form.referenceDetail} onChange={(e) => setForm((f) => ({ ...f, referenceDetail: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
                </div>
              )}
              <div>
                <label htmlFor="ci6-cexp" className="text-xs text-muted-foreground">Expiry / renewal date (where applicable)</label>
                <input id="ci6-cexp" aria-label="Expiry date" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ci6-creason" className="text-xs text-muted-foreground">Documented reason (required for every decision, min 20 chars)</label>
                <Textarea id="ci6-creason" aria-label="Verification reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="min-h-[64px] border-border bg-elevated" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void recordVerification()} disabled={busy} data-testid="ci6-record-verified">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Record VERIFIED
              </Button>
              <Button variant="outline" className="min-h-[44px] border-amber-500/40 bg-transparent text-amber-600 dark:text-amber-400" onClick={() => void recordAdverse('NEEDS_MORE_EVIDENCE')} disabled={busy}>Needs more evidence</Button>
              <Button variant="outline" className="min-h-[44px] border-destructive/40 bg-transparent text-destructive" onClick={() => void recordAdverse('REJECTED')} disabled={busy}>Record REJECTED</Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Lifecycle decisions (approve/activate/suspend) remain in the Reviewers tab — a verification record never changes status by itself.</p>
          </div>

          <div className="rounded border border-border bg-elevated/80 p-3" data-testid="ci6-admin-info-request">
            <p className="text-sm font-medium">Request additional information</p>
            <Textarea aria-label="Information request text" value={infoText} onChange={(e) => setInfoText(e.target.value)} className="mt-2 min-h-[56px] border-border bg-elevated" placeholder="What the applicant should provide or clarify" />
            <Button size="sm" className="mt-2 min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void sendInfoRequest()} disabled={busy}>
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
              Send request
            </Button>
            <ul className="mt-3 space-y-2">
              {detail.infoRequests.map((r) => (
                <li key={r.id} className="rounded border border-border bg-page/40 px-3 py-2 text-xs">
                  <p>{r.requestText}</p>
                  <p className="mt-1 text-muted-foreground">{r.status === 'ANSWERED' ? `answered: ${r.responseText}` : 'awaiting applicant response'}</p>
                </li>
              ))}
            </ul>
          </div>

          <div data-testid="ci6-verification-records">
            <p className="text-sm font-medium">Verification records (append-only)</p>
            {detail.verificationRecords.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No verification recorded yet.</p>}
            <ul className="mt-2 space-y-2">
              {detail.verificationRecords.map((r) => (
                <li key={r.id} className="rounded border border-border bg-page/40 p-3 text-xs" data-testid="ci6-verification-record">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.decision} />
                    <span className="font-medium">{r.credentialType}</span>
                    <span className="text-muted-foreground">{r.issuingInstitution} · {r.verificationMethod.replaceAll('_', ' ')}</span>
                    {r.expiresAt && <span className="text-muted-foreground">expires {new Date(r.expiresAt).toLocaleDateString()}</span>}
                  </div>
                  <p className="mt-1 text-muted-foreground">scope: {r.qualificationScope} · examined {r.evidenceIds.length} document(s){r.referenceDetail ? ` · ref: ${r.referenceDetail}` : ''}</p>
                  <p className="mt-1">{r.reason}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-border bg-elevated/80 p-3">
            <p className="text-sm font-medium">Application history (append-only)</p>
            <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {detail.events.slice(-20).reverse().map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] text-muted-foreground">{e.eventType}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{e.rationale ?? ''}</span>
                  <span className="shrink-0 text-muted-foreground/70">{new Date(e.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
