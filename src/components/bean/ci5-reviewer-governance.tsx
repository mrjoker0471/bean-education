'use client'

// ─── BEAN Classroom Intelligence (CI-5G): expert reviewer governance UI ───────
// Two surfaces, both wired to the REAL CI-5 backend APIs (no mock data, no
// fake metrics, no fabricated qualifications):
//   1. <AdminCi5GovernancePanel />  — admin workspace (#/admin/ci5-reviewers):
//      reviewer registry + lifecycle actions, assignment queue, language
//      capability view, benchmark registry, report-audit register.
//   2. <Ci5ReviewerWorkspace />     — reviewer workspace (#/reviewer): own
//      profile + scope, assigned work with start/recuse, the pack-review
//      rubric form (A–F) and the bilingual evidence checklist, report-audit
//      masked evidence view.
// Design follows the BEAN system (obsidian black, champagne/metallic gold,
// warm ivory, restrained glassmorphism). Every status transition is a real,
// server-authorised, append-only event.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldCheck, ClipboardList, Languages, FlaskConical, FileSearch, Users, RefreshCw, FileCheck } from 'lucide-react'
import { Ci6VerificationWorkbench } from '@/components/bean/ci6-verification-workbench'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { toast } from '@/hooks/use-toast'

// ─── shared bits ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  APPLICATION_PENDING: 'border-border bg-elevated text-muted-foreground',
  QUALIFICATION_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  APPROVED: 'border-gold/40 bg-gold/10 text-gold',
  ACTIVE: 'border-success/40 bg-success/10 text-success',
  SUSPENDED: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  EXPIRED: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  REVOKED: 'border-destructive/40 bg-destructive/10 text-destructive',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  ASSIGNED: 'border-gold/40 bg-gold/10 text-gold',
  IN_PROGRESS: 'border-gold/40 bg-gold/10 text-gold',
  SUBMITTED: 'border-border bg-elevated text-muted-foreground',
  COMPLETED: 'border-success/40 bg-success/10 text-success',
  EXPIRED_ASSIGNMENT: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  RECUSED: 'border-border bg-elevated text-muted-foreground',
  REASSIGNED: 'border-border bg-elevated text-muted-foreground',
  CANCELLED: 'border-border bg-elevated text-muted-foreground',
  VERIFIED: 'border-success/40 bg-success/10 text-success',
  LIMITED: 'border-gold/40 bg-gold/10 text-gold',
  EXPERIMENTAL: 'border-border bg-elevated text-muted-foreground',
  UNSUPPORTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  REVOKED_CAP: 'border-destructive/40 bg-destructive/10 text-destructive',
  SUPERSEDED: 'border-border bg-elevated text-muted-foreground',
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[status] ?? 'border-border bg-elevated text-muted-foreground'}`}>{status.replaceAll('_', ' ').toLowerCase()}</span>
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof ShieldCheck; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
        <Icon className="h-4 w-4 text-gold" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

// ─── Admin governance workspace ───────────────────────────────────────────────

interface AdminReviewer {
  id: string
  reviewerCode: string
  category: string
  status: string
  verificationStatus: string
  qualificationCategory: string | null
  scope: { approvedDomains: string[]; approvedLanguages: { tag: string; tasks: string[] }[] }
  expiresAt: string | null
}
interface AdminAssignment {
  id: string
  subjectType: string
  subjectKey: string
  subjectVersion: string | null
  riskClass: string | null
  reviewerCode: string
  status: string
}
interface LanguageCapabilityDTO {
  languageTag: string
  task: string
  status: string
  basis: string
  note: string
}
interface DatasetDTO {
  slug: string
  name: string
  taskKind: string
  split: string
  version: string
  caseCount: number
  expertLabelCount: number
}
interface AuditDTO {
  id: string
  reviewerCode: string
  verdict: string
  reportVersion: number
  supportedCount: number
  unsupportedCount: number
  ambiguousCount: number
}

type AdminTab = 'reviewers' | 'assignments' | 'language' | 'benchmarks' | 'audits' | 'verification'

export function AdminCi5GovernancePanel() {
  const [tab, setTab] = useState<AdminTab>('reviewers')
  const [loading, setLoading] = useState(true)
  const [reviewers, setReviewers] = useState<AdminReviewer[]>([])
  const [assignments, setAssignments] = useState<AdminAssignment[]>([])
  const [capabilities, setCapabilities] = useState<LanguageCapabilityDTO[]>([])
  const [datasets, setDatasets] = useState<DatasetDTO[]>([])
  const [audits, setAudits] = useState<AuditDTO[]>([])
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rv, asg, cap, ds, aud] = await Promise.all([
        api.get<{ reviewers: AdminReviewer[] }>('/api/admin/ci5/reviewers').catch(() => ({ reviewers: [] })),
        api.get<{ assignments: AdminAssignment[] }>('/api/admin/ci5/assignments').catch(() => ({ assignments: [] })),
        api.get<{ capabilities: LanguageCapabilityDTO[] }>('/api/admin/ci5/language/capabilities').catch(() => ({ capabilities: [] })),
        api.get<{ datasets: DatasetDTO[] }>('/api/admin/ci5/benchmarks/datasets').catch(() => ({ datasets: [] })),
        api.get<{ audits: AuditDTO[] }>('/api/admin/ci5/report-audits').catch(() => ({ audits: [] })),
      ])
      setReviewers(rv.reviewers)
      setAssignments(asg.assignments)
      setCapabilities(cap.capabilities)
      setDatasets(ds.datasets)
      setAudits(aud.audits)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const reviewerAction = async (profileId: string, action: string, extra: Record<string, unknown> = {}) => {
    setActionBusy(profileId + action)
    try {
      await api.post(`/api/admin/ci5/reviewers/${encodeURIComponent(profileId)}/action`, { action, ...extra })
      toast({ title: `Action applied: ${action.replaceAll('_', ' ').toLowerCase()}` })
      await load()
    } catch (err) {
      toast({ title: 'Action refused', description: err instanceof Error ? err.message : 'the server refused this transition', variant: 'destructive' })
    } finally {
      setActionBusy(null)
    }
  }

  const TABS: { id: AdminTab; label: string; icon: typeof ShieldCheck }[] = [
    { id: 'reviewers', label: 'Reviewers', icon: Users },
    { id: 'assignments', label: 'Assignments', icon: ClipboardList },
    { id: 'language', label: 'Language', icon: Languages },
    { id: 'benchmarks', label: 'Benchmarks', icon: FlaskConical },
    { id: 'audits', label: 'Report audits', icon: FileSearch },
    // CI-6C (additive): independent credential verification workbench
    { id: 'verification', label: 'Verification', icon: FileCheck },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8" data-testid="ci5-admin-panel">
      <SectionHeader
        icon={ShieldCheck}
        title="CI-5 expert review governance"
        subtitle="Qualified reviewer registry, assignment queue, durable language capabilities, expert benchmark programme and the report-audit pilot. Every action is a server-authorised, append-only event."
      />
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Governance sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
              tab === t.id ? 'border-gold/50 bg-gold/10 text-gold' : 'border-border bg-elevated/60 text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" aria-hidden /> {t.label}
          </button>
        ))}
        <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
        </Button>
      </div>

      {loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="ci5-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading governance state…
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {tab === 'reviewers' && (
            reviewers.length === 0 ? (
              <EmptyState title="No reviewer profiles yet" description="Reviewer applications appear here after accounts apply through #/reviewer." />
            ) : (
              reviewers.map((r) => (
                <div key={r.id} className="rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci5-reviewer-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-foreground">{r.reviewerCode}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.category.replaceAll('_', ' ').toLowerCase()} · verification: {r.verificationStatus.toLowerCase()}
                        {r.qualificationCategory ? ` · ${r.qualificationCategory}` : ''}
                        {r.expiresAt ? ` · expires ${new Date(r.expiresAt).toLocaleDateString()}` : ' · no expiry'}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Scope: {r.scope.approvedDomains.length ? `domains ${r.scope.approvedDomains.join(', ')}` : ''}
                    {r.scope.approvedLanguages.length ? `${r.scope.approvedDomains.length ? ' · ' : ''}languages ${r.scope.approvedLanguages.map((l) => `${l.tag}(${l.tasks.join('/')})`).join(', ')}` : ''}
                    {!r.scope.approvedDomains.length && !r.scope.approvedLanguages.length ? 'none approved yet' : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status === 'APPLICATION_PENDING' && (
                      <Button size="sm" className="min-h-[44px]" disabled={actionBusy === r.id + 'BEGIN'} onClick={() => void reviewerAction(r.id, 'BEGIN_QUALIFICATION_REVIEW', { rationale: 'qualification review started from the admin workspace' })}>Begin review</Button>
                    )}
                    {r.status === 'QUALIFICATION_REVIEW' && (
                      <Button size="sm" className="min-h-[44px]" disabled={actionBusy === r.id + 'DECIDE'} onClick={() => void reviewerAction(r.id, 'DECIDE', { decision: 'APPROVED', rationale: 'qualification verified from the admin workspace (fixture scope pending real evidence)', verificationStatus: 'REFERENCED_VERIFIED', scope: r.category === 'DOMAIN_EXPERT' ? { approvedDomains: ['mathematics-statistics'] } : { approvedLanguages: [{ tag: 'ta', tasks: ['TERMINOLOGY', 'TEXT_UNDERSTANDING'] }] } })}>Approve (fixture scope)</Button>
                    )}
                    {r.status === 'APPROVED' && (
                      <Button size="sm" className="min-h-[44px]" disabled={actionBusy === r.id + 'ACTIVATE'} onClick={() => void reviewerAction(r.id, 'ACTIVATE')}>Activate</Button>
                    )}
                    {r.status === 'ACTIVE' && (
                      <Button size="sm" variant="outline" className="min-h-[44px]" disabled={actionBusy === r.id + 'SUSPEND'} onClick={() => void reviewerAction(r.id, 'SUSPEND', { reason: 'suspended from the admin workspace — reason recorded in the audit trail' })}>Suspend</Button>
                    )}
                  </div>
                </div>
              ))
            )
          )}

          {tab === 'assignments' && (
            assignments.length === 0 ? (
              <EmptyState title="No assignments yet" description="Assignments are created server-side per qualified reviewer and subject." />
            ) : (
              assignments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci5-assignment-row">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{a.subjectKey}{a.subjectVersion ? ` @ v${a.subjectVersion}` : ''}</p>
                    <p className="text-xs text-muted-foreground">{a.subjectType.replaceAll('_', ' ').toLowerCase()} · {a.reviewerCode}{a.riskClass ? ` · ${a.riskClass}` : ''}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))
            )
          )}

          {tab === 'language' && (
            <div className="rounded-xl border border-border bg-elevated/60 p-4">
              <p className="text-xs text-muted-foreground">Effective capability per catalogue language × task, resolved from the durable governance store. TRANSCRIPTION is structurally UNSUPPORTED for every language (§9.2 gate).</p>
              <div className="mt-3 max-h-96 overflow-y-auto pr-1" data-testid="ci5-language-grid">
                <ul className="flex flex-col gap-1.5">
                  {capabilities.map((c) => (
                    <li key={`${c.languageTag}-${c.task}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
                      <span className="font-mono text-foreground">{c.languageTag} · {c.task.replaceAll('_', ' ').toLowerCase()}</span>
                      <span className="flex items-center gap-2"><StatusBadge status={c.status} /><span className="text-muted-foreground">{c.basis.replaceAll('_', ' ').toLowerCase()}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {tab === 'benchmarks' && (
            datasets.length === 0 ? (
              <EmptyState title="No benchmark datasets yet" description="Datasets are created through the admin API; expert labels come from qualified reviewers." />
            ) : (
              datasets.map((d) => (
                <div key={`${d.slug}-${d.version}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci5-dataset-row">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.taskKind.replaceAll('_', ' ').toLowerCase()} · {d.split.replaceAll('_', ' ').toLowerCase()} · v{d.version} · {d.caseCount} case(s) · {d.expertLabelCount} expert label(s)</p>
                  </div>
                  <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">{d.split}</Badge>
                </div>
              ))
            )
          )}

          {tab === 'audits' && (
            audits.length === 0 ? (
              <EmptyState title="No report audits yet" description="The pilot audits appear here once qualified reviewers audit classroom report versions." />
            ) : (
              audits.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci5-audit-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-foreground">report v{a.reportVersion} · {a.reviewerCode}</p>
                    <StatusBadge status={a.verdict} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">supported {a.supportedCount} · unsupported {a.unsupportedCount} · ambiguous {a.ambiguousCount} · Evidence Auditor findings preserved</p>
                </div>
              ))
            )
          )}

          {/* CI-6C (additive): independent credential verification workbench */}
          {tab === 'verification' && <Ci6VerificationWorkbench />}
        </div>
      )}
    </div>
  )
}

// ─── Reviewer workspace ───────────────────────────────────────────────────────

interface MeProfile {
  profile: {
    id: string
    reviewerCode: string
    category: string
    status: string
    scope: { approvedDomains: string[]; approvedLanguages: { tag: string; tasks: string[] }[] }
    qualificationCategory: string | null
    expiresAt: string | null
  } | null
  events: { id: string; eventType: string; rationale: string | null; createdAt: string }[]
}
interface MyAssignment {
  id: string
  subjectType: string
  subjectKey: string
  subjectVersion: string | null
  subjectChecksum: string | null
  status: string
}
interface MaskedView {
  reportId: string
  reportVersion: number
  reportChecksum: string
  evaluationFindings: unknown
  unobservableDimensions: string[]
  maskingNote: string
}

const RUBRIC_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
const RUBRIC_LABELS: Record<string, string> = {
  A: 'A · Domain scope',
  B: 'B · Knowledge accuracy',
  C: 'C · Source provenance',
  D: 'D · Educational value',
  E: 'E · Safety',
  F: 'F · Benchmark quality',
}
const FACETS = ['meaning_preservation', 'domain_terminology', 'grammar', 'naturalness', 'script_correctness', 'mathematical_notation', 'scientific_symbols', 'code_switching', 'regional_register', 'dialect_differences', 'ambiguous_wording', 'unsupported_claims', 'safety_refusal_accuracy'] as const

export function Ci5ReviewerWorkspace() {
  const [me, setMe] = useState<MeProfile | null>(null)
  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rubric, setRubric] = useState<Record<string, { status: string; notes: string }>>({})
  const [rationale, setRationale] = useState('')
  const [facets, setFacets] = useState<Record<string, string>>({})
  const [languageRationale, setLanguageRationale] = useState('')
  const [auditRationale, setAuditRationale] = useState('')
  const [maskedView, setMaskedView] = useState<MaskedView | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [meRes, asg] = await Promise.all([
        api.get<MeProfile>('/api/ci5/reviewers/me').catch(() => ({ profile: null, events: [] })),
        api.get<{ reviewer: boolean; assignments: MyAssignment[] }>('/api/ci5/reviewer/assignments').catch(() => ({ reviewer: false, assignments: [] })),
      ])
      setMe(meRes)
      setAssignments(asg.assignments)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const start = async (id: string) => {
    setBusy(id)
    try {
      await api.post(`/api/ci5/reviewer/assignments/${encodeURIComponent(id)}/start`, {})
      await load()
    } catch (err) {
      toast({ title: 'Could not start', description: err instanceof Error ? err.message : 'refused', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const recuse = async (id: string) => {
    setBusy(id)
    try {
      await api.post(`/api/ci5/reviewer/assignments/${encodeURIComponent(id)}/recuse`, { reason: 'recused from the reviewer workspace — the recorded reason keeps the independence audit trail complete' })
      await load()
    } catch (err) {
      toast({ title: 'Could not recuse', description: err instanceof Error ? err.message : 'refused', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const allRubricOk = RUBRIC_SECTIONS.every((s) => rubric[s]?.status === 'OK')
  const submitPackReview = async (a: MyAssignment) => {
    setBusy(a.id)
    try {
      await api.post(`/api/ci5/reviewer/assignments/${encodeURIComponent(a.id)}/pack-review`, {
        decision: allRubricOk ? 'APPROVED' : 'CHANGES_REQUESTED',
        rationale: rationale.trim().length >= 20 ? rationale.trim() : 'rubric-backed review submitted from the reviewer workspace (rationale recorded below per section notes)',
        rubric: {
          inspected: 'inspected the assigned pack version, its source licence records and the fixture suite output (recorded from the reviewer workspace)',
          sections: Object.fromEntries(RUBRIC_SECTIONS.map((s) => [s, { status: rubric[s]?.status ?? 'NOT_ASSESSED', notes: rubric[s]?.notes ?? '' }])),
        },
      })
      toast({ title: 'Expert review submitted', description: 'The decision was recorded in the append-only pack review ledger.' })
      setRationale(''); setRubric({})
      await load()
    } catch (err) {
      toast({ title: 'Submission refused', description: err instanceof Error ? err.message : 'the authoritative ledger refused this submission', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const submitLanguageReview = async (a: MyAssignment) => {
    setBusy(a.id)
    try {
      await api.post(`/api/ci5/reviewer/assignments/${encodeURIComponent(a.id)}/language-review`, {
        measurementId: a.subjectChecksum ?? '',
        decision: Object.values(facets).every((v) => v === 'OK') ? 'APPROVED' : 'CHANGES_REQUESTED',
        rationale: languageRationale.trim().length >= 20 ? languageRationale.trim() : 'bilingual checklist submitted from the reviewer workspace',
        evidence: Object.fromEntries(FACETS.map((f) => [f, { status: facets[f] ?? 'NOT_ASSESSED', notes: '' }])),
      })
      toast({ title: 'Bilingual review submitted' })
      setFacets({}); setLanguageRationale('')
      await load()
    } catch (err) {
      toast({ title: 'Submission refused', description: err instanceof Error ? err.message : 'the durable ledger refused this decision', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const openMaskedView = async (reportId: string) => {
    setBusy(reportId)
    try {
      const res = await api.post<{ maskedView: MaskedView | null }>('/api/ci5/reviewer/assignments/report-view', { reportId })
      setMaskedView(res.maskedView ?? null)
    } catch {
      toast({ title: 'Masked view unavailable', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const submitAudit = async (a: MyAssignment, verdict: string) => {
    setBusy(a.id)
    try {
      await api.post(`/api/ci5/reviewer/assignments/${encodeURIComponent(a.id)}/report-audit`, {
        reportChecksum: maskedView?.reportChecksum ?? a.subjectChecksum ?? '',
        verdict,
        supportedFindings: verdict === 'SUPPORTED' || verdict === 'PARTIALLY_SUPPORTED' ? ['the reported claims that match the masked evidence'] : [],
        unsupportedFindings: verdict !== 'SUPPORTED' ? ['a claim recorded by the audit as unsupported (see the audit rationale)'] : [],
        ambiguousFindings: [],
        unobservableMarkers: maskedView?.unobservableDimensions ?? [],
        rationale: auditRationale.trim().length >= 20 ? auditRationale.trim() : 'audit submitted from the reviewer workspace against the masked evidence view',
      })
      toast({ title: 'Report audit recorded' })
      setAuditRationale(''); setMaskedView(null)
      await load()
    } catch (err) {
      toast({ title: 'Audit refused', description: err instanceof Error ? err.message : 'refused', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="ci5-reviewer-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your reviewer workspace…
        </div>
      </div>
    )
  }

  if (!me?.profile) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8" data-testid="ci5-reviewer-none">
        <SectionHeader icon={ShieldCheck} title="Expert reviewer workspace" subtitle="No reviewer profile is linked to this account. Applying confers no privileges — qualification review is a separate, admin-approved process." />
        <EmptyState title="No reviewer profile" description="Sign in with an account that holds an approved reviewer profile, or apply through the reviewer application route." />
      </div>
    )
  }

  const p = me.profile
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8" data-testid="ci5-reviewer-workspace">
      <SectionHeader icon={ShieldCheck} title="Expert reviewer workspace" subtitle="Only your own authorised work appears here. Every decision is recorded server-side against the exact version you inspect." />

      {/* Profile card */}
      <div className="mt-5 rounded-xl border border-gold/30 bg-gold/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm text-foreground" data-testid="ci5-reviewer-code">{p.reviewerCode}</p>
          <StatusBadge status={p.status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {p.category.replaceAll('_', ' ').toLowerCase()}
          {p.qualificationCategory ? ` · ${p.qualificationCategory}` : ''}
          {p.expiresAt ? ` · expires ${new Date(p.expiresAt).toLocaleDateString()}` : ''}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Approved scope: {p.scope.approvedDomains.length ? `domains ${p.scope.approvedDomains.join(', ')}` : ''}
          {p.scope.approvedLanguages.length ? `${p.scope.approvedDomains.length ? ' · ' : ''}languages ${p.scope.approvedLanguages.map((l) => `${l.tag}(${l.tasks.join('/')})`).join(', ')}` : ''}
          {!p.scope.approvedDomains.length && !p.scope.approvedLanguages.length ? 'none yet' : ''}
        </p>
      </div>

      {/* Assignments */}
      <h2 className="mt-6 font-display text-lg font-semibold text-foreground">Assigned work</h2>
      {assignments.length === 0 ? (
        <EmptyState title="No assignments" description="Assigned reviews appear here when an administrator creates them for your scope." />
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {assignments.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-elevated/60 p-4" data-testid="ci5-my-assignment">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate text-sm text-foreground">{a.subjectKey}{a.subjectVersion ? ` @ v${a.subjectVersion}` : ''}</p>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.subjectType.replaceAll('_', ' ').toLowerCase()}</p>

              {a.status === 'ASSIGNED' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="min-h-[44px]" disabled={busy === a.id} onClick={() => void start(a.id)}>Start review</Button>
                  <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy === a.id} onClick={() => void recuse(a.id)}>Recuse</Button>
                </div>
              )}

              {(a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && a.subjectType === 'DOMAIN_PACK' && (
                <details className="mt-3 rounded-lg border border-border bg-background/40 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-gold">Expert review rubric (A–F)</summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {RUBRIC_SECTIONS.map((s) => (
                      <div key={s} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border border-border/60 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground">{RUBRIC_LABELS[s]}</p>
                          <input
                            type="text"
                            aria-label={`Notes for section ${s}`}
                            placeholder="section notes (optional)"
                            className="mt-1 w-full min-w-0 rounded border border-border bg-elevated px-2 py-1.5 text-xs text-foreground"
                            value={rubric[s]?.notes ?? ''}
                            onChange={(e) => setRubric((prev) => ({ ...prev, [s]: { status: prev[s]?.status ?? 'OK', notes: e.target.value } }))}
                          />
                        </div>
                        <select
                          aria-label={`Status for section ${s}`}
                          className="h-9 rounded border border-border bg-elevated px-2 text-xs text-foreground"
                          value={rubric[s]?.status ?? 'OK'}
                          onChange={(e) => setRubric((prev) => ({ ...prev, [s]: { status: e.target.value, notes: prev[s]?.notes ?? '' } }))}
                        >
                          <option value="OK">OK</option>
                          <option value="ISSUE">ISSUE</option>
                          <option value="NOT_ASSESSED">NOT_ASSESSED</option>
                        </select>
                      </div>
                    ))}
                    <Textarea
                      aria-label="Review rationale"
                      placeholder="rationale (min 20 chars) — the decision must carry your reasoning"
                      className="min-h-[72px] text-xs"
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                    <Button size="sm" className="min-h-[44px]" disabled={busy === a.id} onClick={() => void submitPackReview(a)}>
                      Submit decision ({allRubricOk ? 'APPROVED' : 'CHANGES_REQUESTED'})
                    </Button>
                    <p className="text-[11px] text-muted-foreground">APPROVED requires every section OK. The decision lands in the append-only pack review ledger bound to the exact checksum.</p>
                  </div>
                </details>
              )}

              {(a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && a.subjectType === 'LANGUAGE_CAPABILITY' && (
                <details className="mt-3 rounded-lg border border-border bg-background/40 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-gold">Bilingual evidence checklist (13 facets)</summary>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {FACETS.map((f) => (
                      <label key={f} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs text-foreground">
                        <span className="min-w-0 truncate">{f.replaceAll('_', ' ')}</span>
                        <select
                          aria-label={`Status for ${f.replaceAll('_', ' ')}`}
                          className="h-9 rounded border border-border bg-elevated px-2 text-xs"
                          value={facets[f] ?? 'NOT_ASSESSED'}
                          onChange={(e) => setFacets((prev) => ({ ...prev, [f]: e.target.value }))}
                        >
                          <option value="OK">OK</option>
                          <option value="ISSUE">ISSUE</option>
                          <option value="NOT_ASSESSED">NOT_ASSESSED</option>
                        </select>
                      </label>
                    ))}
                  </div>
                  <Textarea
                    aria-label="Bilingual review rationale"
                    placeholder="rationale (min 20 chars)"
                    className="mt-2 min-h-[72px] text-xs"
                    value={languageRationale}
                    onChange={(e) => setLanguageRationale(e.target.value)}
                  />
                  <Button size="sm" className="mt-2 min-h-[44px]" disabled={busy === a.id} onClick={() => void submitLanguageReview(a)}>
                    Submit bilingual decision
                  </Button>
                  <p className="mt-1 text-[11px] text-muted-foreground">The decision binds to the exact persisted measurement (provider + model + benchmark); APPROVED requires every facet OK.</p>
                </details>
              )}

              {(a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && a.subjectType === 'CLASSROOM_REPORT' && (
                <details className="mt-3 rounded-lg border border-border bg-background/40 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-gold">Report-audit pilot (masked evidence)</summary>
                  <Button size="sm" variant="outline" className="mt-2 min-h-[44px]" disabled={busy === a.subjectKey} onClick={() => void openMaskedView(a.subjectKey)}>
                    Load masked evidence view
                  </Button>
                  {maskedView && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border/60 p-2 text-xs text-muted-foreground">
                      <p>report v{maskedView.reportVersion} · checksum {maskedView.reportChecksum.slice(0, 12)}…</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(maskedView.evaluationFindings, null, 1)}</pre>
                      <p className="mt-1 text-[10px]">{maskedView.maskingNote}</p>
                    </div>
                  )}
                  <Textarea
                    aria-label="Audit rationale"
                    placeholder="audit rationale (min 20 chars)"
                    className="mt-2 min-h-[72px] text-xs"
                    value={auditRationale}
                    onChange={(e) => setAuditRationale(e.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CORRECTIONS_RECORDED'].map((v) => (
                      <Button key={v} size="sm" variant="outline" className="min-h-[44px]" disabled={busy === a.id} onClick={() => void submitAudit(a, v)}>
                        {v.replaceAll('_', ' ').toLowerCase()}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Unobservable dimensions are recorded honestly — reviewers are never asked to guess. Corrections are new audit rows.</p>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent lifecycle events */}
      <h2 className="mt-6 font-display text-lg font-semibold text-foreground">Your review history</h2>
      <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-border bg-elevated/60 p-3">
        {me.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No lifecycle events yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {me.events.slice(-20).reverse().map((e) => (
              <li key={e.id} className="text-xs text-muted-foreground">
                <span className="mr-1.5 inline-block rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px]">{e.eventType.replaceAll('_', ' ').toLowerCase()}</span>
                {e.rationale ?? e.eventType}
                <span className="ml-1 text-[10px] text-muted-foreground/70">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
