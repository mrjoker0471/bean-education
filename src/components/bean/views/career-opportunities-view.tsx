'use client'

// ─── Phase 7 — Opportunity browse + detail/apply (#/career/opportunities[/:id])
// Public marketplace of admin-moderated PUBLISHED opportunities from verified
// employer organizations. Browsing needs no sign-in; every filter is backed by
// the real GET /api/career/opportunities params (q/type/workMode/location/
// skill/employer/deadlineBefore + page/pageSize) and applies on submit — not
// per keystroke.
//
// The apply dialog assembles the snapshot EXPLICITLY in two steps: the student
// first selects exactly which profile fields, skills, projects and credentials
// to include (contact sharing is a separate explicit consent), then reviews the
// exact payload the server will persist before submitting. Confirmation is
// shown only after the server responds 2xx. The server re-validates
// eligibility, the deadline and duplicates at submission time.

import { useCallback, useEffect, useState } from 'react'
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
import {
  ACTIVE_WORK_MODES,
  APPLICATION_STATUS_BADGE_CLASS,
  EMPTY_FILTERS,
  DEADLINE_WINDOW_OPTIONS,
  OPPORTUNITIES_PAGE_SIZE,
  activeFilterChips,
  applicationSelectionError,
  browseParams,
  buildApplicationSnapshot,
  clampPage,
  consentSummarySections,
  deadlineChipClass,
  deadlineChipLabel,
  deadlineChipState,
  employerIsVerified,
  excerpt,
  hasActiveFilters,
  opportunityTypeLabel,
  previewSnapshotPayload,
  serializeOpportunityFilters,
  snapshotDisplayRows,
  totalPages,
  workModeLabel,
} from '@/lib/career-market-ui'
import type { DeadlineWindow, OpportunityFilterState } from '@/lib/career-market-ui'
import type {
  CareerCredentialClientDTO,
  CareerProfileResponse,
  CareerProjectClientDTO,
  CareerSkillClientDTO,
  OpportunitiesBrowseResponse,
  PublicOpportunityClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { ArrowLeft, Briefcase, Building2, ChevronLeft, ChevronRight, Loader2, MapPin, Search, ShieldAlert, X } from 'lucide-react'

const TYPE_OPTIONS = [
  { value: 'ALL', label: 'All types' },
  { value: 'JOB', label: 'Jobs' },
  { value: 'INTERNSHIP', label: 'Internships' },
  { value: 'APPRENTICESHIP', label: 'Apprenticeships' },
  { value: 'PROJECT', label: 'Projects' },
]

export function OpportunityBrowseView() {
  const navigate = useAppStore(s => s.navigate)
  const authChecked = useAppStore(s => s.authChecked)

  // Draft inputs (free editing) vs applied filters (actually sent to the API).
  const [qDraft, setQDraft] = useState('')
  const [typeDraft, setTypeDraft] = useState('ALL')
  const [modeDraft, setModeDraft] = useState('ALL')
  const [locationDraft, setLocationDraft] = useState('')
  const [skillDraft, setSkillDraft] = useState('')
  const [employerDraft, setEmployerDraft] = useState('')
  const [deadlineDraft, setDeadlineDraft] = useState<DeadlineWindow>('ANY')
  const [applied, setApplied] = useState<OpportunityFilterState>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<OpportunitiesBrowseResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback((filters: OpportunityFilterState, pageNum: number) => {
    setData(null)
    api.browseOpportunities(browseParams(filters, pageNum, OPPORTUNITIES_PAGE_SIZE))
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load opportunities.'))
  }, [])

  useEffect(() => {
    if (!authChecked) return
    const t = setTimeout(() => load(applied, page), 0)
    return () => clearTimeout(t)
  }, [authChecked, applied, page, load])

  const applyFilters = () => {
    const next: OpportunityFilterState = {
      q: qDraft.trim(),
      type: typeDraft,
      workMode: modeDraft,
      location: locationDraft.trim(),
      skill: skillDraft.trim(),
      employer: employerDraft.trim(),
      deadline: deadlineDraft,
    }
    if (serializeOpportunityFilters(next) === serializeOpportunityFilters(applied)) {
      setPage(1)
      return
    }
    setApplied(next)
    setPage(1)
  }

  const clearFilters = () => {
    setQDraft(''); setTypeDraft('ALL'); setModeDraft('ALL'); setLocationDraft('')
    setSkillDraft(''); setEmployerDraft(''); setDeadlineDraft('ANY')
    setApplied(EMPTY_FILTERS)
    setPage(1)
  }

  const removeFilter = (key: keyof OpportunityFilterState) => {
    const next: OpportunityFilterState = { ...applied, [key]: key === 'deadline' ? 'ANY' : key === 'type' || key === 'workMode' ? 'ALL' : '' }
    setApplied(next)
    setPage(1)
    if (key === 'q') setQDraft('')
    if (key === 'type') setTypeDraft('ALL')
    if (key === 'workMode') setModeDraft('ALL')
    if (key === 'location') setLocationDraft('')
    if (key === 'skill') setSkillDraft('')
    if (key === 'employer') setEmployerDraft('')
    if (key === 'deadline') setDeadlineDraft('ANY')
  }

  const chips = activeFilterChips(applied)
  const pages = data ? totalPages(data.total, data.pageSize) : 1

  const retry = () => load(applied, page)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Jobs & internships</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every listing comes from a BEAN-verified employer organization and was reviewed by a moderator before publication.
        BEAN never charges for applications, and employers only see what you explicitly share.
      </p>

      {/* Filter bar — applies on submit (button or Enter), never per keystroke */}
      <form className="mt-6" onSubmit={e => { e.preventDefault(); applyFilters() }}>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Search opportunities" className="pl-9" placeholder="Search roles, companies, skills…" value={qDraft} onChange={e => setQDraft(e.target.value)} maxLength={100} />
          </div>
          <Select value={typeDraft} onValueChange={setTypeDraft}>
            <SelectTrigger aria-label="Opportunity type"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-mode" className="text-xs text-muted-foreground">Work mode</Label>
            <Select value={modeDraft} onValueChange={setModeDraft}>
              <SelectTrigger id="filter-mode" aria-label="Work mode"><SelectValue placeholder="All modes" /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                <SelectItem value="ALL">All modes</SelectItem>
                {ACTIVE_WORK_MODES.map(m => <SelectItem key={m} value={m}>{workModeLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-location" className="text-xs text-muted-foreground">Location</Label>
            <Input id="filter-location" placeholder="e.g. Kolkata" value={locationDraft} onChange={e => setLocationDraft(e.target.value)} maxLength={60} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-skill" className="text-xs text-muted-foreground">Skill</Label>
            <Input id="filter-skill" placeholder="e.g. Tally" value={skillDraft} onChange={e => setSkillDraft(e.target.value)} maxLength={60} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-employer" className="text-xs text-muted-foreground">Employer</Label>
            <Input id="filter-employer" placeholder="Organization name" value={employerDraft} onChange={e => setEmployerDraft(e.target.value)} maxLength={60} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-deadline" className="text-xs text-muted-foreground">Application deadline</Label>
            <Select value={deadlineDraft} onValueChange={v => setDeadlineDraft(v as DeadlineWindow)}>
              <SelectTrigger id="filter-deadline" aria-label="Application deadline"><SelectValue placeholder="Any deadline" /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {DEADLINE_WINDOW_OPTIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" className="flex-1 bg-gold text-primary-foreground hover:bg-gold-hover">Apply filters</Button>
            <Button type="button" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={clearFilters}>Clear</Button>
          </div>
        </div>
      </form>

      {/* Applied-filter chips */}
      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Filters applied">
          <span className="text-xs text-muted-foreground">Filters applied:</span>
          {chips.map(c => (
            <button
              key={c.key}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold transition-colors hover:bg-gold/20"
              onClick={() => removeFilter(c.key)}
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label} <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={clearFilters}>Clear all</button>
        </div>
      ) : null}

      <div className="mt-6">
        {failed ? (
          <EmptyState icon={Briefcase} title="Could not load opportunities" description={failed} actionLabel="Try again" onAction={retry} />
        ) : !data ? (
          <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading opportunities"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : data.opportunities.length === 0 ? (
          hasActiveFilters(applied) ? (
            <EmptyState
              icon={Briefcase}
              title="No opportunities match your filters"
              description="Try widening the search — different keywords, another work mode, or a longer deadline window."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState icon={Briefcase} title="No open opportunities right now" description="Verified employers publish new listings regularly — check back soon." />
          )
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.opportunities.map(o => {
                const chipState = deadlineChipState(o.applicationDeadline)
                const chipLabel = deadlineChipLabel(o.applicationDeadline)
                const skills = (o.requiredSkills.length > 0 ? o.requiredSkills : o.preferredSkills).slice(0, 4)
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
                    onClick={() => navigate({ view: 'career-opportunity', opportunityId: o.id })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-display text-base font-semibold text-foreground">{o.title}</h2>
                      <Badge variant="outline" className="shrink-0 border-gold/40 text-gold">{opportunityTypeLabel(o.opportunityType)}</Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-gold" aria-hidden />
                        {o.organization.displayName || o.organization.name}
                      </span>
                      {employerIsVerified(o.organization.verificationStatus) ? (
                        <Badge variant="outline" className="border-success/40 bg-success/10 px-1.5 py-0 text-[10px] text-success" title="Identity reviewed by BEAN">Verified</Badge>
                      ) : null}
                    </p>
                    {o.workMode || o.location ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {o.workMode ? <span className="rounded-full border border-border px-2 py-0.5">{workModeLabel(o.workMode)}</span> : null}
                        {o.location ? <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"><MapPin className="h-3 w-3" aria-hidden />{o.location}</span> : null}
                      </div>
                    ) : null}
                    {chipLabel ? (
                      <div className="mt-2">
                        <Badge variant="outline" className={`${deadlineChipClass(chipState)} text-[11px]`}>{chipLabel}</Badge>
                      </div>
                    ) : null}
                    {skills.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {skills.map(s => <Badge key={s} variant="outline" className="border-border px-1.5 text-[11px] text-muted-foreground">{s}</Badge>)}
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">{excerpt(o.description)}</p>
                    {o.publishedAt ? <p className="mt-2 text-[11px] text-muted-foreground">Posted {new Date(o.publishedAt).toLocaleDateString()}</p> : null}
                  </button>
                )
              })}
            </div>

            {/* Pagination — from the server's real page/total/pageSize */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Page {data.page} of {pages} · {data.total} listing{data.total === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-muted-foreground hover:bg-elevated"
                  disabled={data.page <= 1}
                  onClick={() => setPage(p => clampPage(p - 1, pages))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-muted-foreground hover:bg-elevated"
                  disabled={data.page >= pages}
                  onClick={() => setPage(p => clampPage(p + 1, pages))}
                >
                  Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Detail + two-step consent/apply ─────────────────────────────────────────

type ApplyStep = 'SELECT' | 'REVIEW' | 'DONE'

interface ApplySelection {
  skills: Set<string>
  projects: Set<string>
  credentials: Set<string>
  includeHeadline: boolean
  includeSummary: boolean
  shareContact: boolean
}

const INITIAL_SELECTION: ApplySelection = {
  skills: new Set(),
  projects: new Set(),
  credentials: new Set(),
  includeHeadline: true,
  includeSummary: true,
  shareContact: false,
}

export function OpportunityDetailView({ opportunityId }: { opportunityId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [data, setData] = useState<PublicOpportunityClientDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [profile, setProfile] = useState<CareerProfileResponse | null>(null)
  const [eligibility, setEligibility] = useState<string | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [step, setStep] = useState<ApplyStep>('SELECT')
  const [portfolio, setPortfolio] = useState<{ skills: CareerSkillClientDTO[]; projects: CareerProjectClientDTO[]; credentials: CareerCredentialClientDTO[] } | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioFailed, setPortfolioFailed] = useState(false)
  const [selected, setSelected] = useState<ApplySelection>(INITIAL_SELECTION)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [submittedOnce, setSubmittedOnce] = useState(false)

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

  // Eligibility gate — fetched once for the signed-in student so the detail
  // page can explain the honest apply rules before the dialog ever opens.
  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(() => {
      api.careerProfile()
        .then(p => { setEligibility(p.eligibility.status) })
        .catch(() => undefined)
    }, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent])

  // Portfolio data for the dialog — SHARED projects and ISSUED + portfolio-
  // shared credentials only, exactly matching the explicit-consent model.
  const loadPortfolio = useCallback(() => {
    setPortfolioLoading(true)
    Promise.all([api.careerProfile(), api.careerSkills(), api.careerProjects(), api.careerCredentials()])
      .then(([p, s, pr, c]) => {
        setProfile(p)
        setPortfolio({
          skills: s.skills,
          projects: pr.projects.filter(x => x.visibility === 'SHARED'),
          credentials: c.credentials.filter(x => x.status === 'ISSUED' && x.portfolioShared),
        })
        setPortfolioFailed(false)
      })
      .catch(() => setPortfolioFailed(true))
      .finally(() => setPortfolioLoading(false))
  }, [])

  useEffect(() => {
    if (!applyOpen) return
    const t = setTimeout(loadPortfolio, 0)
    return () => clearTimeout(t)
  }, [applyOpen, loadPortfolio])

  const openApply = () => {
    if (submittedOnce) {
      setSelected(INITIAL_SELECTION)
      setNote('')
      setSubmittedOnce(false)
    }
    setStep('SELECT')
    setApplyError(null)
    setSubmittedAt(null)
    setApplyOpen(true)
  }

  const handleApplyOpenChange = (open: boolean) => {
    if (open) { setApplyOpen(true); return }
    if (busy) return
    setApplyOpen(false)
    if (step === 'DONE') {
      setSelected(INITIAL_SELECTION)
      setNote('')
      setSubmittedOnce(false)
    }
  }

  const toggleSet = (group: 'skills' | 'projects' | 'credentials', id: string) => (v: boolean) => {
    setSelected(sel => {
      const next = new Set(sel[group])
      if (v) next.add(id)
      else next.delete(id)
      return { ...sel, [group]: next }
    })
  }

  const availableSkills = portfolio?.skills ?? []
  const availableProjects = portfolio?.projects ?? []
  const availableCredentials = portfolio?.credentials ?? []
  const chosenSkills = availableSkills.filter(s => selected.skills.has(s.id))
    .map(s => ({ skillName: s.skillName, verificationLabel: s.verificationLabel, proficiency: s.proficiency }))
  const chosenProjects = availableProjects.filter(p => selected.projects.has(p.id))
    .map(p => ({ title: p.title, description: p.description, projectUrl: p.projectUrl, category: p.category }))
  const chosenCredentials = availableCredentials.filter(c => selected.credentials.has(c.id))
    .map(c => ({ credentialName: c.credentialName, issuer: c.issuer.displayName || c.issuer.name, issuedDate: c.issuedDate }))
  const snapshotInput = {
    includeHeadline: selected.includeHeadline,
    includeSummary: selected.includeSummary,
    note,
    profile: profile ? { headline: profile.profile.headline, summary: profile.profile.summary } : null,
    skills: chosenSkills,
    projects: chosenProjects,
    credentials: chosenCredentials,
  }
  const snapshot = buildApplicationSnapshot(snapshotInput)
  const previewPayload = previewSnapshotPayload(snapshot, selected.shareContact, authedStudent?.email ?? null)
  const previewRows = snapshotDisplayRows(previewPayload)
  const selectionError = applicationSelectionError({
    includeHeadline: selected.includeHeadline,
    includeSummary: selected.includeSummary,
    note,
    selectedSkillCount: selected.skills.size,
    selectedProjectCount: selected.projects.size,
    selectedCredentialCount: selected.credentials.size,
  })
  const reviewSections = consentSummarySections({ ...snapshotInput, shareContact: selected.shareContact, contactEmail: authedStudent?.email ?? null })

  const submitApplication = async () => {
    setBusy(true)
    setApplyError(null)
    try {
      const res = await api.applyToOpportunity(opportunityId, { snapshot, contactSharingConsent: selected.shareContact })
      setSubmittedAt(res.application.submittedAt)
      setSubmittedOnce(true)
      setStep('DONE')
      toast({ title: 'Application submitted — the employer sees only your reviewed snapshot.' })
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Could not submit your application. Please try again.')
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

  const chipState = deadlineChipState(data.applicationDeadline)
  const chipLabel = deadlineChipLabel(data.applicationDeadline)
  const verified = employerIsVerified(data.organization.verificationStatus)
  const deadlinePassed = chipState === 'CLOSED'
  const eligibilityApproved = eligibility === 'APPROVED'
  const eligibilityPending = eligibility === 'PENDING_REVIEW'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career-opportunities' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> All opportunities
      </Button>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{data.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-gold" aria-hidden />
                {data.organization.displayName || data.organization.name}
              </span>
              {verified ? <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Identity reviewed by BEAN</Badge> : null}
            </p>
          </div>
          <Badge variant="outline" className="border-gold/40 text-gold">{opportunityTypeLabel(data.opportunityType)}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
          {data.workMode ? <span className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground">{workModeLabel(data.workMode)}</span> : null}
          {data.location ? <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-muted-foreground"><MapPin className="h-3 w-3" aria-hidden />{data.location}</span> : null}
          {chipLabel ? <Badge variant="outline" className={deadlineChipClass(chipState)}>{chipLabel}</Badge> : null}
          {data.publishedAt ? <span className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground">Posted {new Date(data.publishedAt).toLocaleDateString()}</span> : null}
        </div>

        <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {data.compensationDescription ? <p><span className="text-gold">Compensation (informational):</span> {data.compensationDescription}</p> : null}
          {data.applicationDeadline ? <p><span className="text-gold">Apply by:</span> {new Date(data.applicationDeadline).toLocaleDateString()}</p> : null}
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
              <p className="mb-3 text-sm text-muted-foreground">Applications are open to signed-in students with an approved adult-eligibility review.</p>
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>Sign in to apply</Button>
            </div>
          ) : deadlinePassed ? (
            <p className="text-sm text-muted-foreground">The application deadline has passed.</p>
          ) : (
            <div>
              <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
                {eligibility === null
                  ? 'Checking your adult-eligibility status…'
                  : eligibilityApproved
                    ? 'You can apply — your adult-eligibility review is approved.'
                    : eligibilityPending
                      ? 'Applications require an approved adult-eligibility review — yours is pending with BEAN administrators.'
                      : 'Applications require an approved adult-eligibility review. Request one from your career profile.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="bg-gold text-primary-foreground hover:bg-gold-hover"
                  disabled={!eligibilityApproved}
                  onClick={openApply}
                >
                  Apply with a selected snapshot
                </Button>
                {!eligibilityApproved ? (
                  <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'career-profile' })}>
                    Go to career profile
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Apply dialog — step 1: explicit selection, step 2: snapshot review */}
      <Dialog open={applyOpen} onOpenChange={handleApplyOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
          {step !== 'DONE' ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-foreground">
                  {step === 'SELECT' ? 'Choose exactly what to share' : 'Review your application snapshot'}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {step === 'SELECT'
                    ? 'The employer receives only your selection, frozen at submission. Nothing else from your account — no Riishe data, no learning history — is ever included.'
                    : 'This is an immutable snapshot — later profile changes will not change this application. Confirm the payload below before submitting.'}
                </DialogDescription>
              </DialogHeader>

              {portfolioFailed ? (
                <div className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">Could not load your career data — your selections are kept. Please try again.</p>
                  <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={portfolioLoading} onClick={loadPortfolio}>
                    {portfolioLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Retry
                  </Button>
                </div>
              ) : null}

              {step === 'SELECT' ? (
                <div className="grid gap-4">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={selected.includeHeadline} onCheckedChange={v => setSelected(s => ({ ...s, includeHeadline: v === true }))} aria-label="Include headline" />
                    Headline {profile?.profile.headline ? <span className="text-xs text-muted-foreground">({profile.profile.headline})</span> : null}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={selected.includeSummary} onCheckedChange={v => setSelected(s => ({ ...s, includeSummary: v === true }))} aria-label="Include summary" />
                    Summary
                  </label>

                  {availableSkills.length > 0 ? (
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Skills</p>
                      <div className="flex flex-wrap gap-2">
                        {availableSkills.map(s => (
                          <label key={s.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
                            <Checkbox
                              checked={selected.skills.has(s.id)}
                              onCheckedChange={v => toggleSet('skills', s.id)(v === true)}
                              aria-label={`Include ${s.skillName}`}
                            />
                            {s.skillName}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {availableProjects.length > 0 ? (
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Shared projects</p>
                      <div className="space-y-2">
                        {availableProjects.map(p => (
                          <label key={p.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
                            <Checkbox
                              checked={selected.projects.has(p.id)}
                              onCheckedChange={v => toggleSet('projects', p.id)(v === true)}
                              aria-label={`Include ${p.title}`}
                            />
                            <span className="font-medium text-foreground">{p.title}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {availableCredentials.length > 0 ? (
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Shared credentials</p>
                      <div className="space-y-2">
                        {availableCredentials.map(c => (
                          <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
                            <Checkbox
                              checked={selected.credentials.has(c.id)}
                              onCheckedChange={v => toggleSet('credentials', c.id)(v === true)}
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
                      aria-label="Share my account email"
                    />
                    <span>
                      Share my account email with this employer. Off by default — without this, the employer has no way to
                      contact you outside BEAN. Your profile holds no other contact fields, so nothing else is ever shared.
                    </span>
                  </label>

                  <div className="grid gap-2">
                    <Label htmlFor="apply-note">Note to the employer (optional)</Label>
                    <Textarea id="apply-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={600} />
                  </div>

                  {selectionError ? <p className="text-xs text-muted-foreground">{selectionError}</p> : null}
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-3 rounded-lg border border-border bg-elevated p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Exactly what will be shared</p>
                    {reviewSections.map(section => (
                      <div key={section.key}>
                        <p className="text-sm font-medium text-foreground">{section.label}</p>
                        <ul className="mt-1 space-y-0.5">
                          {section.items.map((item, i) => (
                            <li key={`${section.key}-${i}`} className="text-xs text-muted-foreground">{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {reviewSections.length === 0 ? <p className="text-xs text-muted-foreground">Nothing selected.</p> : null}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gold">Snapshot preview — the payload the server will store</p>
                    <div className="grid gap-2 rounded-lg border border-border p-4">
                      {previewRows.map(row => (
                        <div key={row.key}>
                          <p className="text-xs font-medium text-foreground">{row.label}</p>
                          {row.kind === 'text' || row.kind === 'email' ? <p className="text-xs text-muted-foreground">{row.text || '—'}</p> : null}
                          {row.kind === 'list' ? (
                            <ul className="mt-0.5 space-y-0.5">
                              {row.items.map((item, i) => <li key={i} className="text-xs text-muted-foreground">{item}</li>)}
                            </ul>
                          ) : null}
                          {row.kind === 'raw' ? <pre className="mt-0.5 overflow-x-auto text-[11px] text-muted-foreground">{row.text}</pre> : null}
                        </div>
                      ))}
                      {previewRows.length === 0 ? <p className="text-xs text-muted-foreground">Empty payload.</p> : null}
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                      This is an immutable snapshot — later profile changes will not change this application.
                    </p>
                  </div>

                  {applyError ? (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                      <p className="text-sm text-destructive">{applyError}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Your selections and note are preserved — review and submit again.</p>
                    </div>
                  ) : null}
                </div>
              )}

              <DialogFooter>
                {step === 'SELECT' ? (
                  <>
                    <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setApplyOpen(false)}>Cancel</Button>
                    <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!!selectionError} onClick={() => setStep('REVIEW')}>
                      Review snapshot
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => { setApplyError(null); setStep('SELECT') }}>
                      Back
                    </Button>
                    <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => void submitApplication()}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Submit application
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-foreground">Application submitted</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  The employer received your reviewed snapshot exactly as shown — frozen at submission.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="rounded-lg border border-border bg-elevated p-4">
                  <p className="text-sm text-muted-foreground">
                    <span className="text-gold">Employer:</span> {data.organization.displayName || data.organization.name}
                    {verified ? <Badge variant="outline" className="ml-2 border-success/40 bg-success/10 text-success">Identity reviewed by BEAN</Badge> : null}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground"><span className="text-gold">Opportunity:</span> {data.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground"><span className="text-gold">Submitted:</span> {submittedAt ? new Date(submittedAt).toLocaleDateString() : 'just now'}</p>
                  <div className="mt-2">
                    <Badge variant="outline" className={APPLICATION_STATUS_BADGE_CLASS['SUBMITTED']}>submitted</Badge>
                  </div>
                </div>
                <div className="grid gap-2 rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gold">Information shared</p>
                  {reviewSections.map(section => (
                    <div key={section.key}>
                      <p className="text-sm font-medium text-foreground">{section.label}</p>
                      <ul className="mt-1 space-y-0.5">
                        {section.items.map((item, i) => <li key={`${section.key}-${i}`} className="text-xs text-muted-foreground">{item}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setApplyOpen(false)}>Close</Button>
                <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'career-applications' })}>
                  Track applications
                </Button>
              </DialogFooter>
            </>
          )}
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
