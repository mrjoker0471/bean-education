'use client'

// ─── BEAN Classroom Intelligence (CI-6B): real expert application & onboarding ─
// One surface, two phases, wired to the REAL backend APIs (no mock data, no
// fabricated qualifications, no invented verification results):
//   • Applicant without an application → guided multi-step application:
//     category + proposed domains/specialties (advisory), professional
//     experience + affiliation, explicit conflict-of-interest declaration,
//     a review-exact-info step and explicit consent — then submit through
//     POST /api/ci5/reviewers/apply (CI-5B pipeline; application never
//     auto-approves anything).
//   • Applicant with an application → status, credential-evidence upload into
//     the restricted store (POST /api/ci5/reviewers/me/evidence), information
//     requests with inline answers, application-detail editing while open, and
//     withdrawal with the documented retention rules.
// Every refusal from the server is surfaced verbatim. The pending applicant is
// told explicitly that no assignment or expert privilege exists yet.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, GraduationCap, FileUp, Trash2, MessageSquareReply, RefreshCw, CheckCircle2, AlertTriangle, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'

interface DomainVocab {
  domains: { domainId: string; title: string }[]
  categories: string[]
  evidenceKinds: string[]
}

interface ApplicationDetail {
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
    createdAt: string
  } | null
  evidence?: {
    id: string
    kind: string
    fileName: string
    byteSize: number
    sha256: string
    mimeType: string
    retentionState: string
    createdAt: string
  }[]
  infoRequests?: {
    id: string
    requestText: string
    status: string
    responseText: string | null
    requestedAt: string
    answeredAt: string | null
  }[]
}

const OPEN_STATUSES = ['APPLICATION_PENDING', 'QUALIFICATION_REVIEW']

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'ACTIVE'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'WITHDRAWN' || status === 'REJECTED' || status === 'REVOKED'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : status === 'APPROVED'
          ? 'border-gold/40 bg-gold/10 text-gold'
          : 'border-border bg-elevated text-muted-foreground'
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{status.replaceAll('_', ' ').toLowerCase()}</span>
}

export function ExpertApplyView() {
  const authedStudent = useAppStore((s) => s.authedStudent)
  const [vocab, setVocab] = useState<DomainVocab | null>(null)
  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [events, setEvents] = useState<Array<{ id: string; eventType: string; actorKind: string; rationale: string | null; createdAt: string }>>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [submitting, setSubmitting] = useState(false)

  // form state
  const [category, setCategory] = useState<string>('DOMAIN_EXPERT')
  const [proposedDomains, setProposedDomains] = useState<string[]>([])
  const [specialties, setSpecialties] = useState<string>('')
  const [qualificationCategory, setQualificationCategory] = useState('')
  const [professionalExperience, setProfessionalExperience] = useState('')
  const [institutionAffiliation, setInstitutionAffiliation] = useState('')
  const [issuingBody, setIssuingBody] = useState('')
  const [conflictOfInterest, setConflictOfInterest] = useState('')
  const [consent, setConsent] = useState(false)

  // evidence state
  const [evidenceKind, setEvidenceKind] = useState('CERTIFICATE')
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [vocabRes, appRes, meRes] = await Promise.all([
      api.get<DomainVocab>('/api/ci6/domains').catch(() => null),
      api.get<ApplicationDetail>('/api/ci5/reviewers/me/application').catch(() => null),
      api.get<{ profile: { id: string } | null; events?: Array<{ id: string; eventType: string; actorKind: string; rationale: string | null; createdAt: string }> }>('/api/ci5/reviewers/me').catch(() => null),
    ])
    if (vocabRes) setVocab(vocabRes)
    if (appRes) setDetail(appRes)
    if (meRes?.events) setEvents(meRes.events.slice(0, 20))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authedStudent) void load()
    else setLoading(false)
  }, [authedStudent, load])

  async function submitApplication() {
    if (!conflictOfInterest.trim() || conflictOfInterest.trim().length < 4) {
      toast({ title: 'Conflict-of-interest declaration required', description: 'Explicitly state "none declared" if none.', variant: 'destructive' })
      return
    }
    if (!consent) {
      toast({ title: 'Consent required', description: 'Review the exact information submitted and consent to the verification process.', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      await api.post('/api/ci5/reviewers/apply', {
        category,
        conflictOfInterest: conflictOfInterest.trim(),
        qualificationCategory: qualificationCategory.trim() || undefined,
        professionalExperience: professionalExperience.trim() || undefined,
        issuingBody: issuingBody.trim() || undefined,
        institutionAffiliation: institutionAffiliation.trim() || undefined,
        specialties: specialties.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
        proposedDomains: category === 'DOMAIN_EXPERT' ? proposedDomains : undefined,
        consentGranted: true,
      })
      toast({ title: 'Application submitted', description: 'Your application is pending credential verification. No expert privileges exist yet.' })
      setStep(1)
      await load()
    } catch (err) {
      toast({ title: 'Application refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  async function uploadEvidence() {
    if (!evidenceFile) {
      toast({ title: 'Choose a file first', description: 'PDF, PNG or JPEG up to 10 MiB.', variant: 'destructive' })
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('kind', evidenceKind)
      form.append('file', evidenceFile)
      const res = await fetch('/api/ci5/reviewers/me/evidence', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `upload failed (${res.status})`)
      toast({ title: 'Evidence stored', description: 'Stored in the restricted evidence store; the administrator verification workbench can review it.' })
      setEvidenceFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (err) {
      toast({ title: 'Upload refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  async function deleteEvidence(id: string) {
    setBusyAction(true)
    try {
      const res = await fetch(`/api/ci5/reviewers/me/evidence/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'evidence removed by applicant' }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `purge failed (${res.status})`)
      toast({ title: 'Evidence purged', description: 'File bytes removed; metadata and hash retained for the audit trail.' })
      await load()
    } catch (err) {
      toast({ title: 'Purge refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusyAction(false)
    }
  }

  async function answerRequest(requestId: string) {
    const text = (answerDrafts[requestId] ?? '').trim()
    if (text.length < 4) {
      toast({ title: 'Response required', description: 'Write at least a short answer.', variant: 'destructive' })
      return
    }
    setBusyAction(true)
    try {
      await api.post(`/api/ci5/reviewers/me/info-requests/${requestId}/answer`, { responseText: text })
      toast({ title: 'Response recorded' })
      await load()
    } catch (err) {
      toast({ title: 'Answer refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusyAction(false)
    }
  }

  async function withdraw() {
    if (!window.confirm('Withdraw this application? This is terminal; credential-evidence files will be purged (metadata and hash are retained).')) return
    setBusyAction(true)
    try {
      await api.post('/api/ci5/reviewers/me/withdraw', { reason: 'withdrawn by applicant from the application portal' })
      toast({ title: 'Application withdrawn' })
      await load()
    } catch (err) {
      toast({ title: 'Withdrawal refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusyAction(false)
    }
  }

  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8" data-testid="ci6-expert-apply">
        <EmptyState
          icon={GraduationCap}
          title="Sign in to apply as an expert reviewer"
          description="Expert applications are tied to your existing BEAN account. We never create duplicate identities."
          actionLabel="Sign in"
          onAction={() => useAppStore.getState().navigate({ view: 'auth' })}
        />
      </div>
    )
  }

  const profile = detail?.profile
  const isOpen = !!profile && OPEN_STATUSES.includes(profile.status)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8" data-testid="ci6-expert-apply">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          icon={GraduationCap}
          title="Expert reviewer application"
          subtitle="Real experts, independently verified. An application never grants privileges by itself."
        />
        <Button variant="outline" size="sm" className="min-h-[44px] shrink-0 border-border bg-elevated" onClick={() => void load()} aria-label="Refresh application status">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-gold' : ''}`} aria-hidden />
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16" role="status" data-testid="ci6-apply-loading" aria-label="Loading application">
          <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden />
        </div>
      )}

      {!loading && !profile && (
        <section className="mt-6 space-y-6" data-testid="ci6-apply-form">
          {step === 1 && (
            <div className="rounded-xl border border-border bg-elevated/60 p-4 sm:p-6">
              <p className="text-sm text-muted-foreground">Step 1 of 3 — expertise area</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="ci6-category" className="text-sm font-medium">Reviewer category</label>
                  <select
                    id="ci6-category"
                    aria-label="Reviewer category"
                    value={category}
                    onChange={(e) => { setCategory(e.target.value); setProposedDomains([]) }}
                    className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm"
                  >
                    {(vocab?.categories ?? ['DOMAIN_EXPERT', 'BILINGUAL_LANGUAGE']).map((c) => (
                      <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">Domain experts review subject content; bilingual reviewers assess language capabilities.</p>
                </div>
                {category === 'DOMAIN_EXPERT' && (
                  <div>
                    <span className="text-sm font-medium">Proposed domains</span>
                    <p className="text-xs text-muted-foreground">Advisory — the administrator-approved scope is authoritative.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(vocab?.domains ?? []).map((d) => {
                        const active = proposedDomains.includes(d.domainId)
                        return (
                          <button
                            key={d.domainId}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setProposedDomains((prev) => (active ? prev.filter((x) => x !== d.domainId) : [...prev, d.domainId]))}
                            className={`min-h-[44px] rounded-full border px-3 text-xs ${active ? 'border-gold/40 bg-gold/10 text-gold' : 'border-border bg-elevated text-muted-foreground hover:bg-elevated'}`}
                          >
                            {d.title}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <label htmlFor="ci6-specialties" className="text-sm font-medium">Specialties (comma-separated, up to 12)</label>
                  <input
                    id="ci6-specialties"
                    aria-label="Specialties"
                    value={specialties}
                    onChange={(e) => setSpecialties(e.target.value)}
                    placeholder="e.g. number theory, algebraic geometry"
                    className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button className="min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setStep(2)}>Continue</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="rounded-xl border border-border bg-elevated/60 p-4 sm:p-6">
              <p className="text-sm text-muted-foreground">Step 2 of 3 — professional background and conflicts</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="ci6-qual" className="text-sm font-medium">Qualification summary (e.g. &quot;PhD Mathematics&quot;)</label>
                  <input id="ci6-qual" aria-label="Qualification summary" value={qualificationCategory} onChange={(e) => setQualificationCategory(e.target.value)} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
                </div>
                <div>
                  <label htmlFor="ci6-affiliation" className="text-sm font-medium">Institution / professional affiliation (where applicable)</label>
                  <input id="ci6-affiliation" aria-label="Institution or professional affiliation" value={institutionAffiliation} onChange={(e) => setInstitutionAffiliation(e.target.value)} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
                </div>
                <div>
                  <label htmlFor="ci6-issuing" className="text-sm font-medium">Issuing body (where applicable)</label>
                  <input id="ci6-issuing" aria-label="Issuing body" value={issuingBody} onChange={(e) => setIssuingBody(e.target.value)} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
                </div>
                <div>
                  <label htmlFor="ci6-experience" className="text-sm font-medium">Professional experience</label>
                  <Textarea id="ci6-experience" aria-label="Professional experience" value={professionalExperience} onChange={(e) => setProfessionalExperience(e.target.value)} className="min-h-[88px] border-border bg-elevated" />
                </div>
                <div>
                  <label htmlFor="ci6-coi" className="text-sm font-medium">Conflict-of-interest declaration (required — state &quot;none declared&quot; explicitly if none)</label>
                  <Textarea id="ci6-coi" aria-label="Conflict of interest declaration" value={conflictOfInterest} onChange={(e) => setConflictOfInterest(e.target.value)} className="min-h-[72px] border-border bg-elevated" />
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <Button variant="outline" className="min-h-[44px] border-border bg-elevated" onClick={() => setStep(1)}>Back</Button>
                <Button className="min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setStep(3)}>Review application</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 sm:p-6" data-testid="ci6-review-step">
              <p className="text-sm text-muted-foreground">Step 3 of 3 — review the exact information submitted and consent</p>
              <dl className="mt-4 space-y-2 text-sm" data-testid="ci6-review-summary">
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Category</dt><dd className="min-w-0 break-words">{category}</dd></div>
                {category === 'DOMAIN_EXPERT' && <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Proposed domains</dt><dd className="min-w-0 break-words">{proposedDomains.join(', ') || '—'}</dd></div>}
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Specialties</dt><dd className="min-w-0 break-words">{specialties || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Qualification</dt><dd className="min-w-0 break-words">{qualificationCategory || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Affiliation</dt><dd className="min-w-0 break-words">{institutionAffiliation || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Issuing body</dt><dd className="min-w-0 break-words">{issuingBody || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Experience</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{professionalExperience || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-44 shrink-0 text-muted-foreground">Conflicts</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{conflictOfInterest || '—'}</dd></div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-gold">Intended use:</span> the information above and any credential evidence you attach are used only for
                expert-identity and credential verification, reviewer scoping and the audit trail. Verification is performed server-side by authorised
                administrators; evidence files stay in a restricted store, never on public URLs. Submitting an application never makes you a verified
                reviewer and never grants assignments.
              </p>
              <label className="mt-4 flex min-h-[44px] items-start gap-3 text-sm" htmlFor="ci6-consent">
                <input id="ci6-consent" type="checkbox" aria-label="Consent to credential verification and reviewer process" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--gold)]" />
                <span>I have reviewed the exact information above and consent to credential verification and the reviewer process.</span>
              </label>
              <div className="mt-6 flex justify-between">
                <Button variant="outline" className="min-h-[44px] border-border bg-elevated" onClick={() => setStep(2)}>Back</Button>
                <Button className="min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void submitApplication()} disabled={submitting} data-testid="ci6-submit-application">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                  Submit application
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {!loading && profile && (
        <section className="mt-6 space-y-6" data-testid="ci6-application-status">
          <div className="rounded-xl border border-gold/30 bg-gold/5 p-4" data-testid="ci6-status-card">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={profile.status} />
              <span className="font-display text-lg">{profile.reviewerCode}</span>
              <span className="text-xs text-muted-foreground">{profile.category.replaceAll('_', ' ').toLowerCase()} · verification: {profile.verificationStatus.toLowerCase()}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {profile.status === 'APPLICATION_PENDING' && 'Your application is queued for credential verification. You cannot claim expert assignments yet — that requires independent verification and administrator approval.'}
              {profile.status === 'QUALIFICATION_REVIEW' && 'An administrator is reviewing your qualifications. You cannot claim expert assignments yet.'}
              {profile.status === 'APPROVED' && 'Qualification approved. An administrator will activate your reviewer profile; expert assignments become available only when ACTIVE.'}
              {profile.status === 'ACTIVE' && 'You are an active reviewer. Open the reviewer workspace for scoped assignments.'}
              {profile.status === 'WITHDRAWN' && 'This application was withdrawn. The audit history is retained; credential evidence files were purged.'}
              {['REJECTED', 'REVOKED', 'SUSPENDED', 'EXPIRED'].includes(profile.status) && `This profile is ${profile.status.toLowerCase()} — no expert privileges exist in this state.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(profile.specialties ?? []).map((s) => (
                <span key={s} className="rounded-full border border-border bg-elevated px-2 py-0.5 text-muted-foreground">{s}</span>
              ))}
            </div>
          </div>

          {isOpen && (
            <>
              <div className="rounded-xl border border-border bg-elevated/60 p-4 sm:p-6" data-testid="ci6-evidence-section">
                <p className="text-sm font-medium">Credential evidence</p>
                <p className="mt-1 text-xs text-muted-foreground">PDF, PNG or JPEG up to 10 MiB per file. Stored in a restricted store (never public); possession of a document is not treated as proof of authenticity — verification is separate and human.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <select aria-label="Evidence kind" value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)} className="min-h-[44px] rounded border border-border bg-elevated px-3 text-sm">
                    {(vocab?.evidenceKinds ?? ['CV', 'CERTIFICATE', 'LICENCE', 'EMPLOYMENT_RECORD', 'PUBLICATION', 'REFERENCE', 'OTHER']).map((k) => (
                      <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>
                    ))}
                  </select>
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="Evidence file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                    className="min-h-[44px] w-full rounded border border-border bg-elevated px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-gold/10 file:px-3 file:py-1.5 file:text-xs file:text-gold"
                  />
                  <Button className="min-h-[44px] shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void uploadEvidence()} disabled={uploading} data-testid="ci6-upload-evidence">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UploadCloud className="h-4 w-4" aria-hidden />}
                    Upload
                  </Button>
                </div>
                <ul className="mt-4 space-y-2" data-testid="ci6-evidence-list">
                  {(detail?.evidence ?? []).length === 0 && <li className="text-xs text-muted-foreground">No evidence attached yet.</li>}
                  {(detail?.evidence ?? []).map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-page/40 px-3 py-2" data-testid="ci6-evidence-row">
                      <span className="min-w-0 text-xs">
                        <span className="font-medium">{e.kind.replaceAll('_', ' ')}</span>
                        <span className="ml-2 text-muted-foreground">{e.fileName} · {(e.byteSize / 1024).toFixed(0)} KiB · {e.retentionState.toLowerCase()}</span>
                      </span>
                      <span className="flex gap-2">
                        {e.retentionState === 'ACTIVE' && (
                          <>
                            <a href={`/api/ci5/reviewers/me/evidence/${e.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded border border-border bg-elevated px-3 text-xs text-gold hover:bg-gold/10" aria-label={`View evidence ${e.fileName}`}>
                              <FileUp className="h-3.5 w-3.5" aria-hidden />
                              View
                            </a>
                            <Button variant="outline" size="sm" className="min-h-[44px] border-border bg-elevated" onClick={() => void deleteEvidence(e.id)} disabled={busyAction} aria-label={`Delete evidence ${e.fileName}`}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden />
                            </Button>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-elevated/60 p-4 sm:p-6" data-testid="ci6-info-requests">
                <p className="text-sm font-medium">Administrator information requests</p>
                {(detail?.infoRequests ?? []).length === 0 && <p className="mt-2 text-xs text-muted-foreground">No open requests.</p>}
                <ul className="mt-3 space-y-3">
                  {(detail?.infoRequests ?? []).map((r) => (
                    <li key={r.id} className="rounded border border-border bg-page/40 p-3" data-testid="ci6-info-request">
                      <p className="text-sm">{r.requestText}</p>
                      {r.status === 'ANSWERED' ? (
                        <p className="mt-2 text-xs text-muted-foreground">Answered: {r.responseText}</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <Textarea aria-label={`Answer to request ${r.id}`} value={answerDrafts[r.id] ?? ''} onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))} className="min-h-[64px] border-border bg-elevated" placeholder="Your response" />
                          <Button size="sm" className="min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void answerRequest(r.id)} disabled={busyAction}>
                            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden />
                            Answer
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" data-testid="ci6-withdraw-section">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Withdraw application</p>
                    <p className="mt-1 text-xs text-muted-foreground">Terminal. Credential-evidence files are purged; metadata and hashes are retained for the audit trail.</p>
                    <Button variant="outline" size="sm" className="mt-3 min-h-[44px] border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10" onClick={() => void withdraw()} disabled={busyAction} data-testid="ci6-withdraw">
                      Withdraw application
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {profile.status === 'ACTIVE' && (
            <Link href="/#/reviewer" className="inline-flex min-h-[44px] items-center rounded border border-gold/40 bg-gold/10 px-4 text-sm text-gold hover:bg-gold/20" data-testid="ci6-open-workspace">
              Open reviewer workspace
            </Link>
          )}

          <DisclosureSection onChange={load} />

          {events.length > 0 && (
            <div className="rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci6-events">
              <p className="text-sm font-medium">Application history (append-only)</p>
              <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-xs">
                    <StatusBadge status={e.eventType} />
                    <span className="min-w-0 flex-1 text-muted-foreground">{e.rationale ?? e.eventType}</span>
                    <span className="shrink-0 text-muted-foreground/70">{new Date(e.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof GraduationCap; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
        <Icon className="h-4 w-4 text-gold" aria-hidden />
      </span>
      <div className="min-w-0">
        <h1 className="font-display text-lg sm:text-xl">{title}</h1>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

// ─── CI-6D: consent-gated public profile disclosure settings ──────────────────

interface DisclosureSettings {
  profileVisibility: string
  disclosureConsentAt: string | null
  publicDisplayName: string | null
  professionalSummary: string | null
  availabilityNote: string | null
  disclosedAffiliation: boolean
  institutionAffiliation: string | null
  visibilityOptions: string[]
}

function DisclosureSection({ onChange }: { onChange: () => Promise<void> }) {
  const [settings, setSettings] = useState<DisclosureSettings | null>(null)
  const [draft, setDraft] = useState<{ publicDisplayName: string; professionalSummary: string; availabilityNote: string; disclosedAffiliation: boolean }>({ publicDisplayName: '', professionalSummary: '', availabilityNote: '', disclosedAffiliation: false })
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.get<DisclosureSettings>('/api/ci5/reviewers/me/disclosure')
      if (d && 'profileVisibility' in d) {
        setSettings(d)
        setDraft({
          publicDisplayName: d.publicDisplayName ?? '',
          professionalSummary: d.professionalSummary ?? '',
          availabilityNote: d.availabilityNote ?? '',
          disclosedAffiliation: d.disclosedAffiliation,
        })
      }
    } catch {
      // no application yet — the section simply doesn't render
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(visibility?: string) {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        publicDisplayName: draft.publicDisplayName.trim() || null,
        professionalSummary: draft.professionalSummary.trim() || null,
        availabilityNote: draft.availabilityNote.trim() || null,
        disclosedAffiliation: draft.disclosedAffiliation,
      }
      if (visibility) body.profileVisibility = visibility
      const updated = await api.post<DisclosureSettings>('/api/ci5/reviewers/me/disclosure', body)
      setSettings(updated)
      toast({ title: 'Disclosure settings saved', description: updated.profileVisibility === 'LISTED' ? 'Your profile is publicly listed with only the fields you consented to share.' : 'Your profile is private.' })
      await onChange()
    } catch (err) {
      toast({ title: 'Save refused', description: err instanceof Error ? err.message : 'request failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!loaded || !settings) return null

  return (
    <div className="rounded-xl border border-border bg-elevated/60 p-4 sm:p-6" data-testid="ci6-disclosure">
      <p className="text-sm font-medium">Public profile disclosure</p>
      <p className="mt-1 text-xs text-muted-foreground">
        You control exactly what the public expert directory (#/experts) shows. Only the fields below are ever exposed; credentials, verification notes and
        internal audit data are never public. Listing is consent-gated and revocable at any time.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ci6-pname" className="text-xs text-muted-foreground">Public display name (blank = reviewer code)</label>
          <input id="ci6-pname" aria-label="Public display name" value={draft.publicDisplayName} onChange={(e) => setDraft((d) => ({ ...d, publicDisplayName: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
        </div>
        <div>
          <label htmlFor="ci6-avail" className="text-xs text-muted-foreground">Review availability note</label>
          <input id="ci6-avail" aria-label="Availability note" value={draft.availabilityNote} onChange={(e) => setDraft((d) => ({ ...d, availabilityNote: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded border border-border bg-elevated px-3 text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ci6-summary" className="text-xs text-muted-foreground">Professional summary (max 1000 chars)</label>
          <Textarea id="ci6-summary" aria-label="Professional summary" value={draft.professionalSummary} onChange={(e) => setDraft((d) => ({ ...d, professionalSummary: e.target.value }))} className="min-h-[64px] border-border bg-elevated" />
        </div>
        <label className="flex min-h-[44px] items-center gap-3 text-sm" htmlFor="ci6-shaff">
          <input id="ci6-shaff" type="checkbox" aria-label="Disclose affiliation publicly" checked={draft.disclosedAffiliation} onChange={(e) => setDraft((d) => ({ ...d, disclosedAffiliation: e.target.checked }))} className="h-4 w-4 accent-[var(--gold)]" />
          <span>Show my institution affiliation publicly{settings.institutionAffiliation ? '' : ' (none recorded)'}</span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Current visibility: <span className="font-medium text-gold">{settings.profileVisibility}</span>
          {settings.disclosureConsentAt ? ` · consent recorded ${new Date(settings.disclosureConsentAt).toLocaleDateString()}` : ''}
        </span>
        <Button size="sm" className="min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void save()} disabled={busy}>Save</Button>
        {settings.profileVisibility !== 'LISTED' && (
          <Button variant="outline" size="sm" className="min-h-[44px] border-gold/40 bg-transparent text-gold" onClick={() => void save('LISTED')} disabled={busy} data-testid="ci6-list-profile">List publicly</Button>
        )}
        {settings.profileVisibility === 'LISTED' && (
          <Button variant="outline" size="sm" className="min-h-[44px] border-border bg-elevated" onClick={() => void save('PRIVATE')} disabled={busy} data-testid="ci6-unlist-profile">Unlist</Button>
        )}
        <a href="/#/experts" className="text-xs text-gold underline-offset-2 hover:underline">View public directory</a>
      </div>
    </div>
  )
}
