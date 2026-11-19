'use client'

// ─── Phase 7 — Opportunity browse + detail/apply (#/career/opportunities[/:id])
// Lists admin-moderated PUBLISHED opportunities from verified employer
// organizations. The apply dialog assembles the snapshot EXPLICITLY: the
// student selects exactly which profile fields, skills, projects and
// credentials to include, and contact sharing is a separate explicit consent.
// The server re-validates eligibility and the deadline at submission time.
//
// Browse contract (server /api/career/opportunities GET): q, type, workMode,
// page, pageSize — location is NOT a supported server filter, so no location
// control is rendered (a client-only filter would mislead). The shared api
// client does not forward workMode, so this view issues its own same-origin
// fetch with identical semantics to keep the work-mode filter real.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  CareerCredentialClientDTO,
  CareerProfileResponse,
  CareerProjectClientDTO,
  CareerSkillClientDTO,
  OpportunitiesBrowseResponse,
  PublicOpportunityClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { ArrowLeft, BadgeCheck, Briefcase, Building2, ChevronLeft, ChevronRight, Loader2, MapPin, Search, ShieldAlert } from 'lucide-react'

const TYPE_OPTIONS = [
  { value: 'ALL', label: 'All types' },
  { value: 'JOB', label: 'Jobs' },
  { value: 'INTERNSHIP', label: 'Internships' },
  { value: 'APPRENTICESHIP', label: 'Apprenticeships' },
  { value: 'PROJECT', label: 'Projects' },
]

const OPPORTUNITY_BROWSE_PAGE_SIZE = 12 // matches the server default (max 48)

/** Same-origin fetch identical to the shared api client's jsonFetch — kept
 * local because src/lib/api.ts is outside this task's file ownership and its
 * browseOpportunities wrapper does not forward the server-supported workMode
 * filter. Relative path only; no absolute URLs. */
async function fetchOpportunities(params: { q?: string; type?: string; workMode?: string; page?: number }): Promise<OpportunitiesBrowseResponse> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.type) qs.set('type', params.type)
  if (params.workMode) qs.set('workMode', params.workMode)
  if (params.page && params.page > 1) qs.set('page', String(params.page))
  const query = qs.toString()
  const res = await fetch(`/api/career/opportunities${query ? `?${query}` : ''}`, { headers: { 'content-type': 'application/json' } })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch { /* keep default message */ }
    throw new Error(message)
  }
  return (await res.json()) as OpportunitiesBrowseResponse
}

/** Honest date rendering — the deadline is shown in the viewer's locale with a
 * short month so it can never be misread (e.g. 03/04 ambiguity). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function OpportunityBrowseView() {
  const navigate = useAppStore(s => s.navigate)
  const authChecked = useAppStore(s => s.authChecked)
  const [q, setQ] = useState('')
  const [type, setType] = useState('ALL')
  const [workMode, setWorkMode] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<OpportunitiesBrowseResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const seq = useRef(0)

  const load = useCallback(async (filters: { q: string; type: string; workMode: string; page: number }) => {
    const id = ++seq.current
    setLoading(true)
    try {
      const res = await fetchOpportunities({
        q: filters.q || undefined,
        type: filters.type && filters.type !== 'ALL' ? filters.type : undefined,
        workMode: filters.workMode || undefined,
        page: filters.page,
      })
      if (seq.current !== id) return // a newer request superseded this one
      setData(res)
      setFailed(null)
    } catch (e) {
      if (seq.current !== id) return
      setFailed(e instanceof Error ? e.message : 'Could not load opportunities.')
    } finally {
      if (seq.current === id) setLoading(false)
    }
  }, [])

  const filterKey = `${q}\u0000${type}\u0000${workMode}`
  const lastFilterKey = useRef(filterKey)

  useEffect(() => {
    if (!authChecked) return
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey
      if (page !== 1) {
        setPage(1) // re-runs this effect with page 1
        return
      }
    }
    const t = setTimeout(() => void load({ q, type, workMode, page }), 300)
    return () => clearTimeout(t)
  }, [authChecked, q, type, workMode, page, filterKey, load])

  const retry = () => void load({ q, type, workMode, page })

  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? OPPORTUNITY_BROWSE_PAGE_SIZE
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const hasPrev = page > 1
  const hasNext = page * pageSize < total

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Jobs &amp; internships</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every listing comes from a BEAN-verified employer organization and was reviewed by a moderator before publication.
        BEAN never charges for applications, and employers only see what you explicitly share.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_220px]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search opportunities" className="pl-9" placeholder="Search roles, companies, skills…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label="Opportunity type"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Filter by work mode"
            className="pl-9"
            placeholder="Work mode, e.g. Remote"
            value={workMode}
            onChange={e => setWorkMode(e.target.value)}
            maxLength={30}
          />
        </div>
      </div>

      <div className="mt-6" aria-busy={loading} aria-live="polite">
        {failed ? (
          <EmptyState icon={Briefcase} title="Could not load opportunities" description={failed} actionLabel="Try again" onAction={retry} />
        ) : !data ? (
          <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading opportunities"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : data.opportunities.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={q || type !== 'ALL' || workMode ? 'No opportunities match your filters' : 'No opportunities right now'}
            description={q || type !== 'ALL' || workMode ? 'Try clearing a filter or broadening your search.' : 'Verified employers publish new listings regularly — check back soon.'}
          />
        ) : (
          <div className={loading ? 'relative opacity-60 transition-opacity' : 'relative'}>
            {loading ? (
              <div className="absolute inset-0 z-10 flex items-start justify-center pt-8" role="status" aria-label="Updating results">
                <Loader2 className="h-5 w-5 animate-spin text-gold" />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.opportunities.map(o => {
                const closed = o.status !== 'PUBLISHED' || (o.applicationDeadline ? new Date(o.applicationDeadline).getTime() <= Date.now() : false)
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
                    onClick={() => navigate({ view: 'career-opportunity', opportunityId: o.id })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-display text-base font-semibold text-foreground">{o.title}</h2>
                      <Badge variant="outline" className="border-gold/40 text-gold">{o.opportunityType.toLowerCase()}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5 text-gold" aria-hidden />
                        {o.organization.displayName || o.organization.name}
                      </p>
                      {/* Server-confirmed verification state only — the badge is
                          rendered from organization.verificationStatus, never client-side. */}
                      {o.organization.verificationStatus === 'APPROVED' ? (
                        <Badge variant="outline" className="border-success/40 text-success">
                          <BadgeCheck className="mr-1 h-3 w-3" aria-hidden /> Verified employer
                        </Badge>
                      ) : null}
                    </div>
                    {o.location || o.workMode ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                        {[o.location, o.workMode ? o.workMode.toLowerCase() : null].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {o.requiredSkills.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {o.requiredSkills.slice(0, 4).map(s => (
                          <Badge key={s} variant="outline" className="border-border text-muted-foreground">{s}</Badge>
                        ))}
                        {o.requiredSkills.length > 4 ? (
                          <Badge variant="outline" className="border-border text-muted-foreground">+{o.requiredSkills.length - 4} more</Badge>
                        ) : null}
                      </div>
                    ) : null}
                    {o.compensationDescription ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">Compensation: {o.compensationDescription}</p>
                    ) : null}
                    <div className="mt-auto pt-3">
                      {closed ? (
                        <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">Closed — no longer accepting applications</Badge>
                      ) : o.applicationDeadline ? (
                        <p className="text-xs text-muted-foreground">Apply by {formatDate(o.applicationDeadline)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Open until closed</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {data && total > 0 && !failed ? (
        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Opportunity list pagination">
          <p className="text-xs text-muted-foreground">
            {loading ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin text-gold" aria-hidden /> : null}
            Showing {from}–{to} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              disabled={!hasPrev || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              disabled={!hasNext || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}

// ─── Detail + apply ──────────────────────────────────────────────────────────

export function OpportunityDetailView({ opportunityId }: { opportunityId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [data, setData] = useState<PublicOpportunityClientDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [profile, setProfile] = useState<CareerProfileResponse | null>(null)
  const [skills, setSkills] = useState<CareerSkillClientDTO[]>([])
  const [projects, setProjects] = useState<CareerProjectClientDTO[]>([])
  const [credentials, setCredentials] = useState<CareerCredentialClientDTO[]>([])
  const [applied, setApplied] = useState<{ status: string; submittedAt: string } | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [selected, setSelected] = useState<{ skills: Set<string>; projects: Set<string>; credentials: Set<string>; includeHeadline: boolean; includeSummary: boolean; shareContact: boolean }>({
    skills: new Set(), projects: new Set(), credentials: new Set(), includeHeadline: true, includeSummary: true, shareContact: false,
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setData(null)
    api.opportunityDetail(opportunityId)
      .then(res => { setData(res.opportunity); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load the opportunity.'))
  }, [opportunityId])

  useEffect(() => {
    if (!authChecked) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, load])

  // "Already applied": only the student's own applications list can answer
  // this — match the opportunity id against it.
  useEffect(() => {
    if (!authedStudent || !data) return
    const t = setTimeout(() => {
      api.myApplications()
        .then(res => {
          const mine = res.applications.find(a => a.opportunity.id === opportunityId)
          setApplied(mine ? { status: mine.status, submittedAt: mine.submittedAt } : null)
        })
        .catch(() => undefined) // detection is best-effort; the server still blocks duplicates
    }, 0)
    return () => clearTimeout(t)
  }, [authedStudent, data, opportunityId])

  useEffect(() => {
    if (!applyOpen || !authedStudent) return
    const t = setTimeout(() => {
      Promise.all([api.careerProfile(), api.careerSkills(), api.careerProjects(), api.careerCredentials()])
        .then(([p, s, pr, c]) => { setProfile(p); setSkills(s.skills); setProjects(pr.projects.filter(x => x.visibility === 'SHARED')); setCredentials(c.credentials.filter(x => x.status === 'ISSUED' && x.portfolioShared)) })
        .catch(() => undefined)
    }, 0)
    return () => clearTimeout(t)
  }, [applyOpen, authedStudent])

  const submitApplication = async () => {
    if (!profile) return
    setBusy(true)
    try {
      const snapshot: Record<string, unknown> = {}
      if (selected.includeHeadline) snapshot['headline'] = profile.profile.headline
      if (selected.includeSummary) snapshot['summary'] = profile.profile.summary
      if (note.trim()) snapshot['note'] = note.trim()
      snapshot['skills'] = skills.filter(s => selected.skills.has(s.id)).map(s => ({ skillName: s.skillName, verificationLabel: s.verificationLabel, proficiency: s.proficiency }))
      snapshot['projects'] = projects.filter(p => selected.projects.has(p.id)).map(p => ({ title: p.title, description: p.description, projectUrl: p.projectUrl, category: p.category }))
      snapshot['credentials'] = credentials.filter(c => selected.credentials.has(c.id)).map(c => ({ credentialName: c.credentialName, issuer: c.issuer.displayName || c.issuer.name, issuedDate: c.issuedDate }))
      await api.applyToOpportunity(opportunityId, { snapshot, contactSharingConsent: selected.shareContact })
      toast({ title: 'Application submitted — track it under My applications.' })
      setApplyOpen(false)
      navigate({ view: 'career-applications' })
    } catch (e) {
      toast({ title: 'Could not apply', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }

  if (failed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={Briefcase} title="Could not open this opportunity" description={failed} actionLabel="Back to listings" onAction={() => navigate({ view: 'career-opportunities' })} />
      </div>
    )
  }
  if (!data) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }

  const deadlinePassed = data.applicationDeadline ? new Date(data.applicationDeadline).getTime() <= Date.now() : false
  const notPublished = data.status !== 'PUBLISHED'
  const applicationsClosed = deadlinePassed || notPublished

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career-opportunities' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> All opportunities
      </Button>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{data.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-gold" aria-hidden />
                {data.organization.displayName || data.organization.name}
              </span>
              {data.organization.verificationStatus === 'APPROVED' ? (
                <Badge variant="outline" className="border-success/40 text-success">
                  <BadgeCheck className="mr-1 h-3 w-3" aria-hidden /> Verified employer
                </Badge>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-gold/40 text-gold">{data.opportunityType.toLowerCase()}</Badge>
            {notPublished ? <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">Closed</Badge> : null}
          </div>
        </div>

        <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {data.location ? <p><span className="text-gold">Location:</span> {data.location}{data.workMode ? ` · ${data.workMode}` : ''}</p> : null}
          {data.compensationDescription ? <p><span className="text-gold">Compensation (informational):</span> {data.compensationDescription}</p> : null}
          {data.applicationDeadline ? <p><span className="text-gold">Apply by:</span> {formatDate(data.applicationDeadline)}</p> : null}
        </div>

        {data.eligibilityDescription ? (
          <p className="mt-4 rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">Eligibility: {data.eligibilityDescription}</p>
        ) : null}

        <div className="mt-6">
          <h2 className="font-display text-base font-semibold text-foreground">About the role</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{data.description}</p>
        </div>
        {data.responsibilities ? (
          <div className="mt-4">
            <h2 className="font-display text-base font-semibold text-foreground">Responsibilities</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{data.responsibilities}</p>
          </div>
        ) : null}
        {data.requiredSkills.length > 0 ? (
          <div className="mt-4">
            <h2 className="font-display text-base font-semibold text-foreground">Required skills</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.requiredSkills.map(s => <Badge key={s} variant="outline" className="border-border text-muted-foreground">{s}</Badge>)}
            </div>
          </div>
        ) : null}
        {data.preferredSkills.length > 0 ? (
          <div className="mt-4">
            <h2 className="font-display text-base font-semibold text-foreground">Preferred skills</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.preferredSkills.map(s => <Badge key={s} variant="outline" className="border-border text-muted-foreground">{s}</Badge>)}
            </div>
          </div>
        ) : null}

        <div className="mt-6 border-t border-border pt-4">
          {!authedStudent ? (
            <div>
              {/* Guests are routed to the auth view via the app store navigate,
                  the same pattern every restricted surface in the app uses. */}
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>Sign in to apply</Button>
              <p className="mt-2 text-xs text-muted-foreground">You will choose exactly what to share — nothing is sent before you submit.</p>
            </div>
          ) : applied ? (
            <div className="rounded-lg border border-success/40 bg-success/10 p-3">
              <p className="text-sm font-medium text-success">You applied on {formatDate(applied.submittedAt)}.</p>
              <p className="mt-1 text-xs text-muted-foreground">Current status: {applied.status.replace('_', ' ').toLowerCase()}. The employer sees only the snapshot you selected.</p>
              <Button size="sm" variant="outline" className="mt-2 border-success/40 text-success hover:bg-success/10" onClick={() => navigate({ view: 'career-applications' })}>
                Track in My applications
              </Button>
            </div>
          ) : applicationsClosed ? (
            <p className="text-sm text-muted-foreground">
              {notPublished
                ? 'This listing is closed and no longer accepting applications.'
                : 'The application deadline has passed. This listing no longer accepts applications.'}
            </p>
          ) : (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setApplyOpen(true)}>Apply with a selected snapshot</Button>
          )}
        </div>
      </div>

      {/* Apply dialog — explicit snapshot assembly */}
      <Dialog open={applyOpen} onOpenChange={o => !busy && setApplyOpen(o)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Choose exactly what to share</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              The employer receives only your selection, frozen at submission. Nothing else from your account — no Riishe
              data, no learning history — is ever included.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={selected.includeHeadline} onCheckedChange={v => setSelected(s => ({ ...s, includeHeadline: v === true }))} aria-label="Include headline" />
              Headline {profile?.profile.headline ? <span className="text-xs text-muted-foreground">({profile.profile.headline})</span> : null}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={selected.includeSummary} onCheckedChange={v => setSelected(s => ({ ...s, includeSummary: v === true }))} aria-label="Include summary" />
              Summary
            </label>

            {skills.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {skills.map(s => (
                    <label key={s.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selected.skills.has(s.id)}
                        onCheckedChange={v => setSelected(sel => { const n = new Set(sel.skills); if (v === true) n.add(s.id); else n.delete(s.id); return { ...sel, skills: n } })}
                        aria-label={`Include ${s.skillName}`}
                      />
                      {s.skillName}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {projects.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Shared projects</p>
                <div className="space-y-2">
                  {projects.map(p => (
                    <label key={p.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selected.projects.has(p.id)}
                        onCheckedChange={v => setSelected(sel => { const n = new Set(sel.projects); if (v === true) n.add(p.id); else n.delete(p.id); return { ...sel, projects: n } })}
                        aria-label={`Include ${p.title}`}
                      />
                      <span className="font-medium text-foreground">{p.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {credentials.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Shared credentials</p>
                <div className="space-y-2">
                  {credentials.map(c => (
                    <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selected.credentials.has(c.id)}
                        onCheckedChange={v => setSelected(sel => { const n = new Set(sel.credentials); if (v === true) n.add(c.id); else n.delete(c.id); return { ...sel, credentials: n } })}
                        aria-label={`Include ${c.credentialName}`}
                      />
                      <span className="font-medium text-foreground">{c.credentialName}</span> · {c.issuer.displayName || c.issuer.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-muted-foreground">
              <Checkbox
                checked={selected.shareContact}
                onCheckedChange={v => setSelected(s => ({ ...s, shareContact: v === true }))}
                aria-label="Share contact email"
              />
              <span>
                Share my account email with this employer. Off by default — without this, the employer has no way to
                contact you outside BEAN.
              </span>
            </label>

            <div className="grid gap-2">
              <Label htmlFor="apply-note">Note to the employer (optional)</Label>
              <Textarea id="apply-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={600} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submitApplication}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Submit application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
        BEAN never charges for applications and no employer can ask you to pay at any stage. Suspicious listings can be
        reported from My applications — a report never auto-suspends anyone; BEAN investigates first.
      </p>
    </div>
  )
}
