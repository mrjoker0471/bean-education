'use client'

// ─── Phase 7 — Employer workspace (#/career/employer[/:orgId[/:tab]]) ────────
// For members of APPROVED EMPLOYER organizations. The view is URL-driven:
//   #/career/employer            → auto-navigates to the first eligible org
//   #/career/employer/:orgId     → one organization's workspace (listings tab)
//   #/career/employer/:orgId/:tab → listings | candidates
// Everything is scoped to the org in the URL — switching organizations
// navigates (back/forward/refresh work), and every action targets exactly
// that organization. Listings move through the server-legal lifecycle
// (draft → review → published with admin moderation); applicants are shown
// exactly as they shared themselves at application time (contact details only
// with consent); candidate discovery is consent-gated, rate-limited and
// never ranked.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore, type EmployerWorkspaceTab } from '@/lib/store'
import type {
  DiscoverableCandidateClientDTO,
  EmployerApplicationClientDTO,
  EmployerApplicantsResponse,
  EmployerOpportunitiesResponse,
  MyOrganizationsResponse,
  PublicOpportunityClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  CANDIDATE_PAGE_SIZE,
  CANDIDATE_RATE_LIMIT_COPY,
  EMPLOYER_APPS_PAGE_SIZE,
  EMPLOYER_LIST_PAGE_SIZE,
  APPLICATION_STATUSES_ALL,
  applicantContact,
  applicantCredentials,
  applicantProjects,
  applicantSkills,
  applicationActionConfirmation,
  applicationActionNeedsConfirmation,
  applicationActionsLocked,
  applicationLockedReason,
  applicationStatusLabel,
  canSaveNotesOnly,
  clampPage,
  employerApplicationStatusBadgeClass,
  employerListingStatusLabel,
  employerListingStatusBadgeClass,
  employerListingTransitionLabel,
  employerListingTransitionNotice,
  isRateLimitError,
  legalApplicationActions,
  legalEmployerListingTransitions,
  listingModerationFeedback,
  totalPages,
  type EmployerApplicationAction,
  type EmployerListingTransition,
} from '@/lib/employer-ui'
import { opportunityTypeLabel, workModeLabel, employerIsVerified, excerpt } from '@/lib/career-market-ui'
import { ArrowLeft, BadgeCheck, Building2, FileText, Inbox, Loader2, Pencil, Search, Send, Users } from 'lucide-react'

export function CareerEmployerView() {
  const navigate = useAppStore(s => s.navigate)
  const route = useAppStore(s => s.route)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [orgs, setOrgs] = useState<MyOrganizationsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // The URL is the single source of truth for org + tab.
  const routeOrgId = route.view === 'career-employer-org' ? route.orgId : null
  const routeTab: EmployerWorkspaceTab = route.view === 'career-employer-org' && route.tab ? route.tab : 'listings'

  const orgList = useMemo(
    () =>
      (orgs?.organizations ?? []).filter(
        o =>
          o.organization.orgType === 'EMPLOYER' &&
          o.organization.verificationStatus === 'APPROVED' &&
          o.organization.isActive &&
          o.membership.status === 'ACTIVE',
      ),
    [orgs],
  )
  const currentOrg = orgList.find(o => o.organization.id === routeOrgId) ?? null

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(() => {
      api.myOrganizations()
        .then(res => {
          setOrgs({ organizations: res.organizations })
          setFailed(null)
        })
        .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your employer organizations.'))
    }, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent])

  // URL ↔ eligible-org reconciliation. Runs once per route shape change:
  //   • #/career/employer (no org) → navigate to the first eligible org
  //   • org id not eligible (unknown/foreign/suspended org) → fall back to the
  //     first eligible org (same tab); without any eligible org the view shows
  //     the honest empty state.
  const reconciledRef = useRef('')
  useEffect(() => {
    if (!orgs || orgList.length === 0) return
    const key = `${route.view === 'career-employer' ? 'hub' : routeOrgId ?? ''}|${orgList.map(o => o.organization.id).join(',')}`
    if (reconciledRef.current === key) return
    reconciledRef.current = key
    if (route.view === 'career-employer') {
      navigate({ view: 'career-employer-org', orgId: orgList[0].organization.id, tab: 'listings' })
      return
    }
    if (route.view === 'career-employer-org' && routeOrgId && !currentOrg) {
      navigate({ view: 'career-employer-org', orgId: orgList[0].organization.id, tab: routeTab })
    }
  }, [orgs, orgList, route.view, routeOrgId, currentOrg, routeTab, navigate])

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={Building2} title="Sign in required" description="Employer tools need a verified employer organization membership." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }
  if (failed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={Building2} title="Could not load employer tools" description={failed} actionLabel="Try again" onAction={() => { setFailed(null); setOrgs(null) }} />
      </div>
    )
  }
  if (!orgs) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (orgList.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState
          icon={Building2}
          title="No verified employer organization yet"
          description="Register an EMPLOYER organization and pass BEAN's identity review — unverified organizations cannot publish listings or search candidates."
          actionLabel="Go to Institution"
          onAction={() => navigate({ view: 'institution' })}
        />
      </div>
    )
  }
  // Waiting for the URL reconciliation to land (hub redirect / org fallback).
  if (!currentOrg) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }

  const orgName = currentOrg.organization.displayName || currentOrg.organization.name

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Career
      </Button>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Employer</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Employer workspace</h1>
        <div className="w-full max-w-xs">
          <Select
            value={routeOrgId ?? ''}
            onValueChange={v => navigate({ view: 'career-employer-org', orgId: v, tab: routeTab })}
          >
            <SelectTrigger aria-label="Organization"><SelectValue /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {orgList.map(o => (
                <SelectItem key={o.organization.id} value={o.organization.id}>
                  {o.organization.displayName || o.organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Building2 className="h-4 w-4 text-gold" aria-hidden /> {orgName}
        </span>
        {employerIsVerified(currentOrg.organization.verificationStatus) ? (
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
            <BadgeCheck className="mr-1 h-3 w-3" aria-hidden /> Verified by BEAN
          </Badge>
        ) : null}
        <span>· {currentOrg.organization.orgType.replace(/_/g, ' ').toLowerCase()}</span>
      </p>

      <Tabs
        value={routeTab}
        onValueChange={v => navigate({ view: 'career-employer-org', orgId: routeOrgId ?? '', tab: v as EmployerWorkspaceTab })}
        className="mt-6"
      >
        <TabsList className="bg-elevated">
          <TabsTrigger value="listings">Opportunities</TabsTrigger>
          <TabsTrigger value="candidates">Candidate discovery</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-6">
        {routeTab === 'listings' ? (
          <ListingsPanel key={routeOrgId ?? 'org'} orgId={currentOrg.organization.id} orgName={orgName} />
        ) : (
          <CandidatesPanel key={routeOrgId ?? 'org'} orgId={currentOrg.organization.id} orgName={orgName} />
        )}
      </div>
    </div>
  )
}

// ─── Listings + applicants ───────────────────────────────────────────────────

const LISTING_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_REVIEW', label: 'Pending review' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'REJECTED', label: 'Rejected' },
]

function ListingsPanel({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<EmployerOpportunitiesResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [applicantsFor, setApplicantsFor] = useState<PublicOpportunityClientDTO | null>(null)
  const [transitionFor, setTransitionFor] = useState<{ op: PublicOpportunityClientDTO; to: EmployerListingTransition } | null>(null)
  const [editFor, setEditFor] = useState<PublicOpportunityClientDTO | null>(null)

  const load = useCallback((filter: string, pageNum: number) => {
    setData(null)
    api.employerOpportunities(orgId, { status: filter, page: pageNum, pageSize: EMPLOYER_LIST_PAGE_SIZE })
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your listings.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => load(status, page), 0)
    return () => clearTimeout(t)
  }, [load, status, page])

  const changeFilter = (next: string) => { setStatus(next); setPage(1) }
  const pages = data ? totalPages(data.total, data.pageSize || EMPLOYER_LIST_PAGE_SIZE) : 1

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Listings go live only after a BEAN moderator approves them. All actions below apply only to{' '}
        <span className="font-medium text-foreground">{orgName}</span> — nothing here touches another organization.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="w-full max-w-xs">
          <Select value={status} onValueChange={changeFilter}>
            <SelectTrigger aria-label="Filter listings by status"><SelectValue /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {LISTING_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
          New opportunity
        </Button>
      </div>

      {data ? (
        <p className="mb-4 text-xs text-muted-foreground">
          {data.counts.draft} draft · {data.counts.pending} pending review · {data.counts.published} published · {data.counts.closed} paused/closed/rejected — across all {orgName} listings
        </p>
      ) : null}

      {failed ? (
        <EmptyState icon={Inbox} title="Could not load listings" description={failed} actionLabel="Try again" onAction={() => load(status, page)} />
      ) : !data ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.opportunities.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={status === 'ALL' ? 'No listings yet' : `No ${employerListingStatusLabel(status).toLowerCase()} listings`}
          description={status === 'ALL' ? 'Create your first opportunity — it stays a draft until you submit it for review.' : 'Try a different status filter.'}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {data.opportunities.map(o => {
              const transitions = legalEmployerListingTransitions(o.status)
              const feedback = listingModerationFeedback(o)
              return (
                <li key={o.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-semibold text-foreground">{o.title}</h3>
                        <Badge variant="outline" className="border-gold/30 bg-gold/5 text-gold">{opportunityTypeLabel(o.opportunityType)}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[o.workMode ? workModeLabel(o.workMode) : null, o.location].filter(Boolean).join(' · ') || 'No location set'}
                      </p>
                    </div>
                    <Badge variant="outline" className={employerListingStatusBadgeClass(o.status)}>
                      {employerListingStatusLabel(o.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt(o.description, 160)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {o.applicationDeadline
                      ? deadlineText(o.applicationDeadline)
                      : 'No application deadline set'}
                    {o.publishedAt ? ` · published ${new Date(o.publishedAt).toLocaleDateString()}` : ''}
                  </p>

                  {feedback.kind === 'REJECTED' ? (
                    <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3" role="alert">
                      <p className="text-xs font-medium text-destructive">A BEAN moderator rejected this listing</p>
                      {feedback.reason ? <p className="mt-1 text-xs text-destructive">Moderator feedback: {feedback.reason}</p> : null}
                      {feedback.note ? <p className="mt-1 text-xs text-destructive">Note: {feedback.note}</p> : null}
                      {!feedback.reason && !feedback.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          The moderation note is not shown in this list — update the listing and resubmit it for review.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {feedback.kind === 'PAUSED' && (feedback.reason || feedback.note) ? (
                    <div className="mt-3 rounded-lg border border-gold/40 bg-gold/5 p-3">
                      <p className="text-xs text-gold">Paused by a moderator{feedback.reason ? ` — ${feedback.reason}` : ''}{feedback.note ? ` — ${feedback.note}` : ''}</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {transitions.map(to => (
                      <Button
                        key={to}
                        size="sm"
                        variant="outline"
                        className={to === 'CLOSED' ? 'border-border text-muted-foreground hover:bg-elevated' : 'border-gold/40 text-gold hover:bg-gold/10'}
                        onClick={() => setTransitionFor({ op: o, to })}
                      >
                        {to === 'PENDING_REVIEW' ? <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> : null}
                        {employerListingTransitionLabel(to, o.status)}
                      </Button>
                    ))}
                    {(o.status === 'DRAFT' || o.status === 'REJECTED') ? (
                      <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setEditFor(o)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> {o.status === 'REJECTED' ? 'Edit & resubmit' : 'Edit draft'}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setApplicantsFor(o)}>
                      <Users className="mr-1 h-3.5 w-3.5" aria-hidden /> View applicants
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          <Pagination page={page} pages={pages} total={data.total} unit="listings" onPage={setPage} />
        </>
      )}

      <CreateOpportunityDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={() => { setCreateOpen(false); load(status, page) }} />
      {editFor ? (
        <EditOpportunityDialog
          opportunity={editFor}
          onClose={() => setEditFor(null)}
          onSaved={() => { setEditFor(null); load(status, page) }}
        />
      ) : null}
      {transitionFor ? (
        <ListingTransitionDialog
          transition={transitionFor}
          orgName={orgName}
          onClose={() => setTransitionFor(null)}
          onDone={() => { setTransitionFor(null); load(status, page) }}
        />
      ) : null}
      <ApplicantsDialog
        key={applicantsFor?.id ?? 'none'}
        opportunity={applicantsFor}
        onOpenChange={o => { if (!o) setApplicantsFor(null) }}
        onChanged={() => load(status, page)}
      />
    </div>
  )
}

function deadlineText(deadline: string): string {
  const d = new Date(deadline)
  if (Number.isNaN(d.getTime())) return 'Application deadline set'
  const passed = d.getTime() <= Date.now()
  return `${passed ? 'Applications closed' : 'Apply by'} ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
}

function Pagination({ page, pages, total, unit, onPage }: { page: number; pages: number; total: number; unit: string; onPage: (p: number) => void }) {
  const safe = clampPage(page, Math.max(1, pages))
  if (total === 0) return null
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Page {safe} of {Math.max(1, pages)} · {total} {unit}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={safe <= 1} onClick={() => onPage(safe - 1)} aria-label="Previous page">
          Previous
        </Button>
        <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={safe >= Math.max(1, pages)} onClick={() => onPage(safe + 1)} aria-label="Next page">
          Next
        </Button>
      </div>
    </div>
  )
}

function ListingTransitionDialog({ transition, orgName, onClose, onDone }: {
  transition: { op: PublicOpportunityClientDTO; to: EmployerListingTransition }
  orgName: string
  onClose: () => void
  onDone: () => void
}) {
  const { op, to } = transition
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updateEmployerOpportunity(op.id, { status: to })
      toast({
        title:
          to === 'PENDING_REVIEW' ? 'Submitted for moderation'
          : to === 'PAUSED' ? 'Listing paused'
          : 'Listing closed',
        description: `Scoped to ${orgName}.`,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved — try again.')
    } finally {
      setBusy(false)
    }
  }

  const destructive = to === 'CLOSED'
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">
            {employerListingTransitionLabel(to, op.status)} — {op.title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {employerListingTransitionNotice(to, op.status)} Scoped to {orgName}.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create / edit listing ───────────────────────────────────────────────────

interface ListingFormState {
  title: string
  description: string
  responsibilities: string
  requiredSkills: string
  preferredSkills: string
  location: string
  workMode: string
  opportunityType: string
  compensationDescription: string
  applicationDeadline: string
  eligibilityDescription: string
}

const EMPTY_LISTING_FORM: ListingFormState = {
  title: '',
  description: '',
  responsibilities: '',
  requiredSkills: '',
  preferredSkills: '',
  location: '',
  workMode: '',
  opportunityType: '',
  compensationDescription: '',
  applicationDeadline: '',
  eligibilityDescription: '',
}

function formFromBodyFields(form: ListingFormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    responsibilities: form.responsibilities.trim() || undefined,
    requiredSkills: form.requiredSkills.split(',').map(s => s.trim()).filter(Boolean),
    preferredSkills: form.preferredSkills.split(',').map(s => s.trim()).filter(Boolean),
    location: form.location.trim() || undefined,
    workMode: form.workMode.trim() || undefined,
    opportunityType: form.opportunityType,
    compensationDescription: form.compensationDescription.trim() || undefined,
    applicationDeadline: form.applicationDeadline ? new Date(form.applicationDeadline).toISOString() : undefined,
    eligibilityDescription: form.eligibilityDescription.trim() || undefined,
  }
}

/** Inline client validation mirroring the server's opportunityCreateSchema. */
function listingFormError(form: ListingFormState, withDeadline: boolean): string | null {
  if (form.title.trim().length < 6) return 'The title needs at least 6 characters.'
  if (form.description.trim().length < 80) return 'Write a real description — at least 80 characters.'
  if (!form.opportunityType) return 'Choose an opportunity type.'
  if (withDeadline && form.applicationDeadline) {
    const t = new Date(form.applicationDeadline).getTime()
    if (!Number.isNaN(t) && t <= Date.now()) return 'The application deadline must be in the future.'
  }
  return null
}

function CreateOpportunityDialog({ open, onOpenChange, orgId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onCreated: () => void }) {
  const [form, setForm] = useState<ListingFormState>(EMPTY_LISTING_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ListingFormState>) => setForm(f => ({ ...f, ...patch }))

  const submit = async (submitForReview: boolean) => {
    setError(null)
    const invalid = listingFormError(form, true)
    if (invalid) { setError(invalid); return }
    setBusy(true)
    try {
      const res = await api.createEmployerOpportunity({ organizationId: orgId, ...formFromBodyFields(form) })
      if (submitForReview) {
        await api.updateEmployerOpportunity(res.opportunity.id, { status: 'PENDING_REVIEW' })
        toast({ title: 'Submitted for moderation — it goes live once a moderator approves it.' })
      } else {
        toast({ title: 'Draft saved' })
      }
      setForm(EMPTY_LISTING_FORM)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again — your values are still here.')
    } finally {
      setBusy(false)
    }
  }

  const invalid = listingFormError(form, true)

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">New opportunity</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Compensation is informational only — BEAN is free for applicants and charges employers nothing in this phase.
          </DialogDescription>
        </DialogHeader>
        <ListingFields form={form} set={set} withDeadline />
        {invalid ? <p className="text-xs text-muted-foreground" role="status">{invalid}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy || !!invalid} onClick={() => void submit(false)}>Save draft</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !!invalid} onClick={() => void submit(true)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save &amp; submit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditOpportunityDialog({ opportunity, onClose, onSaved }: { opportunity: PublicOpportunityClientDTO; onClose: () => void; onSaved: () => void }) {
  const fromServer = (): ListingFormState => ({
    title: opportunity.title,
    description: opportunity.description,
    responsibilities: opportunity.responsibilities ?? '',
    requiredSkills: opportunity.requiredSkills.join(', '),
    preferredSkills: opportunity.preferredSkills.join(', '),
    location: opportunity.location ?? '',
    workMode: opportunity.workMode ?? '',
    opportunityType: opportunity.opportunityType,
    compensationDescription: opportunity.compensationDescription ?? '',
    applicationDeadline: opportunity.applicationDeadline ? toLocalInput(opportunity.applicationDeadline) : '',
    eligibilityDescription: opportunity.eligibilityDescription ?? '',
  })
  const [form, setForm] = useState<ListingFormState>(fromServer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ListingFormState>) => setForm(f => ({ ...f, ...patch }))

  const save = async (resubmit: boolean) => {
    setError(null)
    const invalid = listingFormError(form, true)
    if (invalid) { setError(invalid); return }
    setBusy(true)
    try {
      await api.updateEmployerOpportunity(opportunity.id, {
        ...formFromBodyFields(form),
        ...(resubmit ? { status: 'PENDING_REVIEW' as const } : {}),
      })
      toast({ title: resubmit ? 'Resubmitted for moderation' : 'Listing updated' })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved — your edits are still here.')
    } finally {
      setBusy(false)
    }
  }

  const invalid = listingFormError(form, true)

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Edit — {opportunity.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {opportunity.status === 'REJECTED'
              ? 'Update the listing and resubmit it for review — a moderator will look at it again before it goes live.'
              : 'The draft stays private until you submit it for review.'}
          </DialogDescription>
        </DialogHeader>
        <ListingFields form={form} set={set} withDeadline />
        {invalid ? <p className="text-xs text-muted-foreground" role="status">{invalid}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy || !!invalid} onClick={() => void save(false)}>Save changes</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !!invalid} onClick={() => void save(true)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save &amp; resubmit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ListingFields({ form, set, withDeadline }: { form: ListingFormState; set: (patch: Partial<ListingFormState>) => void; withDeadline: boolean }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="op-title">Title (6+ characters)</Label>
        <Input id="op-title" value={form.title} onChange={e => set({ title: e.target.value })} maxLength={160} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="op-desc">Description (80+ characters)</Label>
        <Textarea id="op-desc" rows={5} value={form.description} onChange={e => set({ description: e.target.value })} maxLength={6000} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="op-resp">Responsibilities (optional)</Label>
        <Textarea id="op-resp" rows={3} value={form.responsibilities} onChange={e => set({ responsibilities: e.target.value })} maxLength={4000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="op-type">Type</Label>
          <Select value={form.opportunityType} onValueChange={v => set({ opportunityType: v })}>
            <SelectTrigger id="op-type" aria-label="Opportunity type"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="JOB">Job</SelectItem>
              <SelectItem value="INTERNSHIP">Internship</SelectItem>
              <SelectItem value="APPRENTICESHIP">Apprenticeship</SelectItem>
              <SelectItem value="PROJECT">Project</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="op-skills">Required skills (comma-separated)</Label>
          <Input id="op-skills" value={form.requiredSkills} onChange={e => set({ requiredSkills: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="op-pref-skills">Preferred skills (comma-separated)</Label>
          <Input id="op-pref-skills" value={form.preferredSkills} onChange={e => set({ preferredSkills: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="op-location">Location</Label>
          <Input id="op-location" value={form.location} onChange={e => set({ location: e.target.value })} maxLength={120} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="op-mode">Work mode</Label>
          <Input id="op-mode" value={form.workMode} onChange={e => set({ workMode: e.target.value })} placeholder="Onsite / Remote / Hybrid" maxLength={30} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="op-comp">Compensation (informational)</Label>
          <Input id="op-comp" value={form.compensationDescription} onChange={e => set({ compensationDescription: e.target.value })} maxLength={600} />
        </div>
        {withDeadline ? (
          <div className="grid gap-2">
            <Label htmlFor="op-deadline">Application deadline</Label>
            <Input id="op-deadline" type="datetime-local" value={form.applicationDeadline} onChange={e => set({ applicationDeadline: e.target.value })} className="[color-scheme:dark]" />
          </div>
        ) : null}
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="op-elig">Eligibility notes (optional)</Label>
          <Input id="op-elig" value={form.eligibilityDescription} onChange={e => set({ eligibilityDescription: e.target.value })} maxLength={600} />
        </div>
      </div>
    </div>
  )
}

// ─── Applicants ──────────────────────────────────────────────────────────────

const APPLICANT_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All statuses' },
  ...APPLICATION_STATUSES_ALL.map(s => ({ value: s, label: applicationStatusLabel(s) })),
]

function ApplicantsDialog({ opportunity, onOpenChange, onChanged }: { opportunity: PublicOpportunityClientDTO | null; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<EmployerApplicantsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [openApp, setOpenApp] = useState<EmployerApplicationClientDTO | null>(null)

  const load = useCallback((filter: string, pageNum: number) => {
    if (!opportunity) return
    setData(null)
    api.employerApplicants(opportunity.id, { status: filter, page: pageNum, pageSize: EMPLOYER_APPS_PAGE_SIZE })
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load applicants.'))
  }, [opportunity])

  useEffect(() => {
    if (!opportunity) return
    const t = setTimeout(() => load('ALL', 1), 0)
    return () => clearTimeout(t)
  }, [opportunity, load])

  const reload = () => { load(status, page); onChanged() }

  return (
    <Dialog open={!!opportunity} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Applicants — {opportunity?.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Candidates appear exactly as they chose to share themselves at submission. Contact details show only where the
            candidate explicitly consented. Your private notes never reach candidates.
          </DialogDescription>
        </DialogHeader>

        <div className="w-full max-w-xs">
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1) }}>
            <SelectTrigger aria-label="Filter applicants by status"><SelectValue /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {APPLICANT_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {failed ? (
          <EmptyState icon={Users} title="Could not load applicants" description={failed} actionLabel="Try again" onAction={() => load(status, page)} />
        ) : !data ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : data.applications.length === 0 ? (
          <EmptyState
            icon={Users}
            title={status === 'ALL' ? 'No applications yet' : `No ${applicationStatusLabel(status).toLowerCase()} applications`}
            description={status === 'ALL' ? 'Applications arrive here once the listing is live.' : 'Try a different status filter.'}
          />
        ) : (
          <>
            <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {data.applications.map(a => {
                const contact = applicantContact(a)
                return (
                  <li key={a.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{a.applicant.headline || 'Candidate'}</p>
                      <Badge variant="outline" className={employerApplicationStatusBadgeClass(a.status)}>
                        {applicationStatusLabel(a.status)}
                      </Badge>
                    </div>
                    {a.applicant.summary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.applicant.summary}</p> : null}
                    {applicantSkills(a.applicant.skills).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {applicantSkills(a.applicant.skills).slice(0, 6).map((s, i) => (
                          <Badge key={i} variant="outline" className="border-border text-muted-foreground">{s.name}</Badge>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Submitted {new Date(a.submittedAt).toLocaleDateString()} ·{' '}
                      {contact.consented ? <span className="text-success">contact shared with consent</span> : 'no contact sharing'}
                    </p>
                    {a.candidateVisibleStatusNote ? (
                      <p className="mt-1 rounded-md border border-border bg-elevated px-2 py-1.5 text-xs text-muted-foreground">
                        Visible to candidate: {a.candidateVisibleStatusNote}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setOpenApp(a)}>
                        <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> Open application
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <Pagination page={page} pages={totalPages(data.total, data.pageSize || EMPLOYER_APPS_PAGE_SIZE)} total={data.total} unit="applications" onPage={setPage} />
          </>
        )}
      </DialogContent>

      {openApp ? (
        <ApplicantDetailDialog
          application={openApp}
          opportunityTitle={opportunity?.title ?? ''}
          onClose={() => setOpenApp(null)}
          onChanged={reload}
        />
      ) : null}
    </Dialog>
  )
}

function ApplicantDetailDialog({ application, opportunityTitle, onClose, onChanged }: {
  application: EmployerApplicationClientDTO
  opportunityTitle: string
  onClose: () => void
  onChanged: () => void
}) {
  const [visibleNote, setVisibleNote] = useState(application.candidateVisibleStatusNote ?? '')
  const [privateNote, setPrivateNote] = useState(application.employerNotes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<EmployerApplicationAction | null>(null)

  const locked = applicationActionsLocked(application.status)
  const actions = legalApplicationActions(application.status)
  const skills = applicantSkills(application.applicant.skills)
  const projects = applicantProjects(application.applicant.projects)
  const credentials = applicantCredentials(application.applicant.credentials)
  const contact = applicantContact(application)

  const send = async (status: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.employerApplicationStatus(application.id, {
        status,
        candidateVisibleStatusNote: visibleNote.trim() || undefined,
        employerNotes: privateNote.trim() || undefined,
      })
      toast({ title: 'Status updated — the candidate sees the change.' })
      setConfirmAction(null)
      onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The update could not be saved — try again.')
      setConfirmAction(null)
    } finally {
      setBusy(false)
    }
  }

  const runAction = (to: EmployerApplicationAction) => {
    if (applicationActionNeedsConfirmation(to)) { setConfirmAction(to); return }
    void send(to)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{application.applicant.headline || 'Candidate application'}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {opportunityTitle} · submitted {new Date(application.submittedAt).toLocaleDateString()} ·{' '}
            {applicationStatusLabel(application.status)}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-elevated p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shared at application (snapshot)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This is exactly what the candidate chose to share when they applied — never re-derived from their live profile.
          </p>
          {application.applicant.summary ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{application.applicant.summary}</p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No summary was shared.</p>
          )}
          {skills.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Skills</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {skills.map((s, i) => (
                  <Badge key={i} variant="outline" className={s.verification && s.verification !== 'SELF_DECLARED' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'}>
                    {s.name}{s.verification && s.verification !== 'SELF_DECLARED' ? ' (verified)' : ''}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {projects.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Projects</p>
              <ul className="mt-1 space-y-1">
                {projects.map((p, i) => (
                  <li key={i} className="text-sm text-foreground">
                    {p.title}
                    {p.description ? <span className="text-xs text-muted-foreground"> — {excerpt(p.description, 120)}</span> : null}
                    {p.url ? <span className="ml-1 text-xs text-gold">{p.url}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {credentials.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Credentials</p>
              <ul className="mt-1 space-y-1">
                {credentials.map((c, i) => (
                  <li key={i} className="text-sm text-foreground">
                    {c.name}{c.issuer ? <span className="text-xs text-muted-foreground"> — {c.issuer}</span> : null}
                    {c.issuedDate ? <span className="ml-1 text-xs text-muted-foreground">({new Date(c.issuedDate).toLocaleDateString()})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-3">
          {contact.consented && contact.email ? (
            <p className="text-xs text-success">Consented contact: {contact.email}</p>
          ) : (
            <p className="text-xs text-muted-foreground">No contact sharing — reach out only via the candidate-visible note.</p>
          )}
        </div>

        {locked ? (
          <p className="rounded-lg border border-border bg-elevated p-3 text-xs text-muted-foreground" role="status">
            {applicationLockedReason(application.status)}
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`app-visible-${application.id}`}>Candidate-visible status note (600 max)</Label>
              <Textarea
                id={`app-visible-${application.id}`}
                rows={2}
                maxLength={600}
                value={visibleNote}
                onChange={e => setVisibleNote(e.target.value)}
                placeholder="e.g. an interview invite — visible to the candidate with status updates"
              />
              <p className="text-xs text-muted-foreground">Visible to the candidate with status updates ({visibleNote.length}/600).</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`app-private-${application.id}`}>Private employer notes (2000 max)</Label>
              <Textarea
                id={`app-private-${application.id}`}
                rows={3}
                maxLength={2000}
                value={privateNote}
                onChange={e => setPrivateNote(e.target.value)}
                placeholder="Anything your team wants to remember about this application"
              />
              <p className="text-xs text-muted-foreground">Only your organization can see these notes ({privateNote.length}/2000).</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status actions</p>
              <div className="flex flex-wrap gap-2">
                {canSaveNotesOnly(application.status) ? (
                  <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => void send(application.status)}>
                    Save notes only
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Notes are saved together with a status action — choose one below.</p>
                )}
                {actions.map(to => (
                  <Button
                    key={to}
                    size="sm"
                    variant="outline"
                    className={to === 'REJECTED' ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'border-gold/40 text-gold hover:bg-gold/10'}
                    disabled={busy}
                    onClick={() => runAction(to)}
                  >
                    {applicationStatusLabel(to).replace(/^\w/, c => c.toUpperCase())}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>

      {confirmAction ? (
        <Dialog open onOpenChange={o => { if (!o && !busy) setConfirmAction(null) }}>
          <DialogContent className="max-w-md border-border bg-card">
            <DialogHeader>
              <DialogTitle className="font-display text-foreground">Mark {applicationStatusLabel(confirmAction).toLowerCase()}?</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {applicationActionConfirmation(confirmAction)}
                {confirmAction === 'REJECTED' ? ' A candidate-visible note explaining the decision is recommended.' : ''}
              </DialogDescription>
            </DialogHeader>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <DialogFooter>
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                className={confirmAction === 'REJECTED' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
                disabled={busy}
                onClick={() => void send(confirmAction)}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Dialog>
  )
}

// ─── Candidate discovery ─────────────────────────────────────────────────────

function CandidatesPanel({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [q, setQ] = useState('')
  const [roleType, setRoleType] = useState('')
  const [skill, setSkill] = useState('')
  const [location, setLocation] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ candidates: DiscoverableCandidateClientDTO[]; total: number; page: number; pageSize: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const search = useCallback((params: { q: string; roleType: string; skill: string; location: string }, pageNum: number) => {
    setBusy(true)
    setData(null)
    api.searchCandidates(orgId, {
      q: params.q || undefined,
      roleType: params.roleType || undefined,
      skill: params.skill || undefined,
      location: params.location || undefined,
      page: pageNum,
    })
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not search candidates.'))
      .finally(() => setBusy(false))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => search({ q: '', roleType: '', skill: '', location: '' }, 1), 0)
    return () => clearTimeout(t)
  }, [search])

  const rateLimited = isRateLimitError(failed)

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Only candidates who chose DISCOVERABLE (and passed the adult-eligibility review) appear here — each search is
        rate-limited and audited. No scoring, no ranking: you read the profiles yourself. Searches run as{' '}
        <span className="font-medium text-foreground">{orgName}</span>.
      </p>
      <form
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={e => { e.preventDefault(); setPage(1); search({ q, roleType, skill, location }, 1) }}
      >
        <Input aria-label="Search candidates" placeholder="Headline, summary…" value={q} onChange={e => setQ(e.target.value)} maxLength={100} />
        <Input aria-label="Preferred role type" placeholder="Preferred role…" value={roleType} onChange={e => setRoleType(e.target.value)} maxLength={60} />
        <Input aria-label="Skill filter" placeholder="Skill…" value={skill} onChange={e => setSkill(e.target.value)} maxLength={60} />
        <Input aria-label="Location filter" placeholder="Location…" value={location} onChange={e => setLocation(e.target.value)} maxLength={60} />
        <Button type="submit" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Search className="mr-2 h-4 w-4" aria-hidden />} Search
        </Button>
      </form>

      <div className="mt-6">
        {failed ? (
          rateLimited ? (
            <EmptyState icon={Users} title="Search limit reached" description={CANDIDATE_RATE_LIMIT_COPY} />
          ) : (
            <EmptyState icon={Users} title="Could not search candidates" description={failed} actionLabel="Try again" onAction={() => search({ q, roleType, skill, location }, page)} />
          )
        ) : !data ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : data.candidates.length === 0 ? (
          <EmptyState icon={Users} title="No discoverable candidates match" description="Candidates appear only when they explicitly opt into discovery and pass the adult-eligibility review." />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {data.candidates.map(c => (
                <div key={c.candidateRef} className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-display text-sm font-semibold text-foreground">{c.headline || 'Candidate'}</h3>
                  {c.summaryPreview ? <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.summaryPreview}</p> : null}
                  {c.skills.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.skills.slice(0, 6).map((s, i) => (
                        <Badge key={i} variant="outline" className={s.verificationLabel === 'SELF_DECLARED' ? 'border-border text-muted-foreground' : 'border-success/40 text-success'}>
                          {s.skillName}{s.verificationLabel !== 'SELF_DECLARED' ? ' (verified)' : ''}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {c.preferredRoleTypes.length > 0 || c.preferredLocations.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Prefers: {c.preferredRoleTypes.slice(0, 3).join(', ')}{c.preferredRoleTypes.length > 0 && c.preferredLocations.length > 0 ? ' · ' : ''}
                      {c.preferredLocations.slice(0, 3).join(', ')}
                    </p>
                  ) : null}
                  {c.credentials.length > 0 ? (
                    <p className="mt-2 text-xs text-success">{c.credentials.length} shared credential(s) from verified institutions</p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    No contact details are shown — contact happens only through an application the candidate submits.
                  </p>
                </div>
              ))}
            </div>
            <Pagination
              page={page}
              pages={totalPages(data.total, data.pageSize || CANDIDATE_PAGE_SIZE)}
              total={data.total}
              unit="candidates"
              onPage={p => { setPage(p); search({ q, roleType, skill, location }, p) }}
            />
          </>
        )}
      </div>
    </div>
  )
}
