'use client'

// ─── Phase 7 — Employer dashboard (#/career/employer) ────────────────────────
// For members of APPROVED EMPLOYER organizations: manage listings (draft →
// review → published lifecycle with admin moderation), review applicants of
// own opportunities (snapshot-based, consent-gated contact), and run
// consent-gated candidate discovery (rate-limited, paginated, no AI scoring).
//
// Employer-side status transitions are taken VERBATIM from the server route
// (PATCH /api/career/employer/opportunities/[id], transition map):
//   → PENDING_REVIEW: from DRAFT, PAUSED (resume), REJECTED (resubmit)
//   → PAUSED:         from PUBLISHED
//   → CLOSED:         from DRAFT, PENDING_REVIEW, PUBLISHED, PAUSED
//   PUBLISHED / REJECTED are moderation outcomes employers can never set.
// The resume path is PAUSED → PENDING_REVIEW (moderation re-approval), never
// PAUSED → DRAFT.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  DiscoverableCandidateClientDTO,
  EmployerApplicantsResponse,
  EmployerOpportunitiesResponse,
  MyOrganizationsResponse,
  PublicOpportunityClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  Loader2,
  Lock,
  Mail,
  Search,
  Send,
  ShieldAlert,
  Users,
} from 'lucide-react'

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'border-border bg-elevated text-muted-foreground',
  PENDING_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  PUBLISHED: 'border-success/40 bg-success/10 text-success',
  PAUSED: 'border-gold/40 bg-gold/10 text-gold',
  CLOSED: 'border-border bg-elevated text-muted-foreground',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
}

const APP_STATUS_BADGE: Record<string, string> = {
  SUBMITTED: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  SHORTLISTED: 'border-success/40 bg-success/10 text-success',
  INTERVIEW: 'border-success/40 bg-success/10 text-success',
  SELECTED: 'border-success/40 bg-success/10 text-success',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  WITHDRAWN: 'border-border bg-elevated text-muted-foreground',
}

const APP_STATUS_FILTER_OPTIONS = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN']

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function CareerEmployerView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [orgs, setOrgs] = useState<MyOrganizationsResponse | null>(null)
  const [orgId, setOrgId] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  const [tab, setTab] = useState<'listings' | 'candidates'>('listings')

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(() => {
      api.myOrganizations()
        .then(res => {
          const employers = res.organizations.filter(
            o => o.organization.orgType === 'EMPLOYER' && o.organization.verificationStatus === 'APPROVED' && o.membership.status === 'ACTIVE',
          )
          setOrgs({ organizations: employers })
          if (employers.length > 0) setOrgId(employers[0].organization.id)
          setFailed(null)
        })
        .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your employer organizations.'))
    }, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent])

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
        <EmptyState icon={Building2} title="Could not load employer tools" description={failed} actionLabel="Try again" onAction={() => navigate({ view: 'career' })} />
      </div>
    )
  }
  if (!orgs) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (orgs.organizations.length === 0 || !orgId) {
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

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Career
      </Button>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Employer</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Employer workspace</h1>
        <div className="w-full max-w-xs">
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger aria-label="Organization"><SelectValue /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {orgs.organizations.map(o => (
                <SelectItem key={o.organization.id} value={o.organization.id}>{o.organization.displayName || o.organization.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as 'listings' | 'candidates')} className="mt-6">
        <TabsList className="bg-elevated">
          <TabsTrigger value="listings">Opportunities</TabsTrigger>
          <TabsTrigger value="candidates">Candidate discovery</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-6">
        {tab === 'listings' ? <ListingsPanel orgId={orgId} /> : <CandidatesPanel orgId={orgId} />}
      </div>
    </div>
  )
}

// ─── Listings + applicants ───────────────────────────────────────────────────

function ListingsPanel({ orgId }: { orgId: string }) {
  const [data, setData] = useState<EmployerOpportunitiesResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PublicOpportunityClientDTO | null>(null)
  const [applicantsFor, setApplicantsFor] = useState<PublicOpportunityClientDTO | null>(null)

  const load = useCallback(() => {
    setData(null)
    api.employerOpportunities(orgId)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your listings.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  /** One helper for every employer-side transition — the server's 409 messages
   * surface verbatim so the UI never lies about why a move failed. */
  const transition = async (o: PublicOpportunityClientDTO, status: 'PENDING_REVIEW' | 'PAUSED' | 'CLOSED', successTitle: string) => {
    try {
      await api.updateEmployerOpportunity(o.id, { status })
      toast({ title: successTitle })
      load()
    } catch (e) {
      toast({ title: 'Could not update the listing', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    }
  }

  const counts = data?.counts

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Listings go live only after a BEAN moderator approves them.</p>
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setFormOpen(true)}>
          New opportunity
        </Button>
      </div>

      {counts ? (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Listing status counts">
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">Draft: {counts.draft}</Badge>
          <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">In review: {counts.pending}</Badge>
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Live: {counts.published}</Badge>
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">Closed · paused · rejected: {counts.closed}</Badge>
        </div>
      ) : null}

      {failed ? (
        <EmptyState icon={Inbox} title="Could not load listings" description={failed} actionLabel="Try again" onAction={load} />
      ) : !data ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.opportunities.length === 0 ? (
        <EmptyState icon={Inbox} title="No listings yet" description="Create your first opportunity — it stays a draft until you submit it for review." />
      ) : (
        <ul className="space-y-3">
          {data.opportunities.map(o => (
            <li key={o.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-base font-semibold text-foreground">{o.title}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.opportunityType.toLowerCase()}{o.location ? ` · ${o.location}` : ''}{o.applicationDeadline ? ` · apply by ${formatDate(o.applicationDeadline)}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_BADGE[o.status] ?? 'border-border text-muted-foreground'}>{o.status.replace('_', ' ').toLowerCase()}</Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {o.status === 'DRAFT' ? (
                  <>
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setEditing(o)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-gold/40 text-gold hover:bg-gold/10"
                      onClick={() => void transition(o, 'PENDING_REVIEW', 'Submitted for moderation')}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> Submit for review
                    </Button>
                  </>
                ) : null}

                {o.status === 'PENDING_REVIEW' ? (
                  <p className="flex items-center gap-1.5 text-xs text-gold">
                    <Eye className="h-3.5 w-3.5" aria-hidden /> Awaiting moderation — editing is locked until a moderator reviews it.
                  </p>
                ) : null}

                {o.status === 'PUBLISHED' ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-gold/40 text-gold hover:bg-gold/10"
                      onClick={() => void transition(o, 'PAUSED', 'Listing paused — hidden from candidates until re-approved.')}
                    >
                      Pause listing
                    </Button>
                    <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setApplicantsFor(o)}>
                      <Users className="mr-1 h-3.5 w-3.5" aria-hidden /> View applicants
                    </Button>
                  </>
                ) : null}

                {o.status === 'PAUSED' ? (
                  <>
                    {/* Server-verified resume path: PAUSED → PENDING_REVIEW.
                        There is no PAUSED → DRAFT transition on the server. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-gold/40 text-gold hover:bg-gold/10"
                      onClick={() => void transition(o, 'PENDING_REVIEW', 'Resubmitted for moderation — it goes live again once approved.')}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> Resume — resubmit for review
                    </Button>
                    <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setApplicantsFor(o)}>
                      <Users className="mr-1 h-3.5 w-3.5" aria-hidden /> View applicants
                    </Button>
                  </>
                ) : null}

                {o.status === 'CLOSED' ? (
                  <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setApplicantsFor(o)}>
                    <Users className="mr-1 h-3.5 w-3.5" aria-hidden /> View applicants
                  </Button>
                ) : null}

                {o.status !== 'CLOSED' && o.status !== 'REJECTED' ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                        Close listing
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-border bg-card">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="font-display text-foreground">Close “{o.title}”?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                          Closing stops applications immediately and is permanent — a closed listing cannot be reopened
                          from the employer workspace. Consider pausing a live listing instead.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Keep listing</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-primary-foreground hover:bg-destructive/90"
                          onClick={() => void transition(o, 'CLOSED', 'Listing closed — it no longer accepts applications.')}
                        >
                          Close listing
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>

              {o.status === 'REJECTED' ? (
                <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                  <p className="text-sm font-medium text-destructive">A BEAN moderator rejected this listing — candidates never saw it.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Address the feedback you received, edit the listing, and resubmit it for review.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setEditing(o)}>
                      Edit and resubmit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border text-muted-foreground hover:bg-elevated"
                      onClick={() => void transition(o, 'PENDING_REVIEW', 'Submitted for moderation')}
                    >
                      Submit as-is for review
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <OpportunityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        orgId={orgId}
        initial={null}
        onSaved={() => { setFormOpen(false); load() }}
      />
      <OpportunityFormDialog
        open={!!editing}
        onOpenChange={o => { if (!o) setEditing(null) }}
        orgId={orgId}
        initial={editing}
        onSaved={() => { setEditing(null); load() }}
      />
      <ApplicantsDialog opportunity={applicantsFor} onOpenChange={o => !o && setApplicantsFor(null)} onChanged={load} />
    </div>
  )
}

// ─── Shared create/edit opportunity form ─────────────────────────────────────

const OPPORTUNITY_TYPE_OPTIONS = [
  { value: 'JOB', label: 'Job' },
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'APPRENTICESHIP', label: 'Apprenticeship' },
  { value: 'PROJECT', label: 'Project' },
]

const TITLE_MIN = 6
const TITLE_MAX = 160
const DESC_MIN = 80
const DESC_MAX = 6000
const SKILLS_MAX = 30
const SKILL_LABEL_MAX = 60

interface OpportunityFormState {
  title: string
  description: string
  responsibilities: string
  requiredSkills: string
  preferredSkills: string
  location: string
  workMode: string
  opportunityType: string
  compensationDescription: string
  deadline: string
  eligibilityDescription: string
}

const EMPTY_FORM: OpportunityFormState = {
  title: '', description: '', responsibilities: '', requiredSkills: '', preferredSkills: '',
  location: '', workMode: '', opportunityType: '', compensationDescription: '', deadline: '', eligibilityDescription: '',
}

function parseSkillList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** ISO timestamp → value for <input type="datetime-local"> (local time). */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function validateForm(values: OpportunityFormState): Partial<Record<keyof OpportunityFormState, string>> {
  const errors: Partial<Record<keyof OpportunityFormState, string>> = {}
  if (values.title.trim().length < TITLE_MIN) errors['title'] = `The title must be at least ${TITLE_MIN} characters.`
  if (values.description.trim().length < DESC_MIN) errors['description'] = `The description must be at least ${DESC_MIN} characters so candidates get real information.`
  if (!values.opportunityType) errors['opportunityType'] = 'Choose a type.'
  for (const [field, raw] of [['requiredSkills', values.requiredSkills], ['preferredSkills', values.preferredSkills]] as const) {
    const list = parseSkillList(raw)
    if (list.length > SKILLS_MAX) errors[field] = `Up to ${SKILLS_MAX} skills.`
    else if (list.some(s => s.length > SKILL_LABEL_MAX)) errors[field] = `Each skill must be ${SKILL_LABEL_MAX} characters or fewer.`
  }
  if (values.deadline && new Date(values.deadline).getTime() <= Date.now()) {
    errors['deadline'] = 'The application deadline must be in the future.'
  }
  return errors
}

function OpportunityFormDialog({
  open,
  onOpenChange,
  orgId,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  /** When present the dialog edits this listing (DRAFT/REJECTED are editable);
   * when null it creates a new draft. */
  initial: PublicOpportunityClientDTO | null
  onSaved: () => void
}) {
  const isEdit = !!initial
  // Only DRAFT and REJECTED listings accept content edits (server-verified).
  const canEditContent = isEdit && (initial?.status === 'DRAFT' || initial?.status === 'REJECTED')
  const canSubmitForReview = !isEdit || canEditContent

  const [values, setValues] = useState<OpportunityFormState>(EMPTY_FORM)
  const [touched, setTouched] = useState<Partial<Record<keyof OpportunityFormState, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // (Re)initialize when the dialog opens — typed content is preserved while
  // the dialog stays open, even after a failed submission.
  useEffect(() => {
    if (!open) return
    setAttempted(false)
    setTouched({})
    setError(null)
    if (initial) {
      setValues({
        title: initial.title,
        description: initial.description,
        responsibilities: initial.responsibilities ?? '',
        requiredSkills: initial.requiredSkills.join(', '),
        preferredSkills: initial.preferredSkills.join(', '),
        location: initial.location ?? '',
        workMode: initial.workMode ?? '',
        opportunityType: initial.opportunityType,
        compensationDescription: initial.compensationDescription ?? '',
        deadline: initial.applicationDeadline ? toLocalInputValue(initial.applicationDeadline) : '',
        eligibilityDescription: initial.eligibilityDescription ?? '',
      })
    } else {
      setValues(EMPTY_FORM)
    }
  }, [open, initial])

  const set = (field: keyof OpportunityFormState) => (v: string) => setValues(s => ({ ...s, [field]: v }))
  const blur = (field: keyof OpportunityFormState) => () => setTouched(t => ({ ...t, [field]: true }))

  const errors = useMemo(() => validateForm(values), [values])
  const showError = (field: keyof OpportunityFormState) => (touched[field] || attempted) && errors[field] ? errors[field] : null

  const reviewGaps = Object.values(errors) as string[]
  const submitDisabled = busy || !values.opportunityType || reviewGaps.length > 0

  const submit = async (submitForReview: boolean) => {
    setAttempted(true)
    if (reviewGaps.length > 0 || !values.opportunityType) return
    setBusy(true)
    setError(null)
    try {
      // Optional text fields are always sent trimmed ('' clears them — the
      // PATCH route maps null on text fields to "no change"); the deadline is
      // sent as ISO with offset, or null to remove it.
      const fields = {
        title: values.title.trim(),
        description: values.description.trim(),
        responsibilities: values.responsibilities.trim(),
        requiredSkills: parseSkillList(values.requiredSkills),
        preferredSkills: parseSkillList(values.preferredSkills),
        location: values.location.trim(),
        workMode: values.workMode.trim(),
        opportunityType: values.opportunityType,
        compensationDescription: values.compensationDescription.trim(),
        applicationDeadline: values.deadline ? new Date(values.deadline).toISOString() : null,
        eligibilityDescription: values.eligibilityDescription.trim(),
      }
      let saved: PublicOpportunityClientDTO
      if (isEdit && initial) {
        const res = await api.updateEmployerOpportunity(initial.id, fields)
        saved = res.opportunity
      } else {
        const res = await api.createEmployerOpportunity({ organizationId: orgId, ...fields })
        saved = res.opportunity
      }
      if (submitForReview) {
        // Legal employer transitions: DRAFT → PENDING_REVIEW, REJECTED →
        // PENDING_REVIEW (resubmission). The server 409s anything else.
        await api.updateEmployerOpportunity(saved.id, { status: 'PENDING_REVIEW' })
        toast({ title: 'Submitted for moderation — it goes live once a moderator approves it.' })
      } else if (isEdit) {
        toast({ title: 'Changes saved' })
      } else {
        toast({ title: 'Draft saved' })
      }
      onSaved()
    } catch (e) {
      // The typed content is preserved; the server's message is shown honestly.
      const message = e instanceof Error ? e.message : 'Please try again.'
      setError(message)
      toast({ title: 'Could not save the opportunity', description: message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const descriptionLength = values.description.trim().length

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{isEdit ? 'Edit opportunity' : 'New opportunity'}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? canEditContent
                ? 'Update the listing below, then resubmit it for moderation.'
                : 'This listing is awaiting moderation — editing is locked until a moderator reviews it.'
              : 'Compensation is informational only — BEAN is free for applicants and charges employers nothing in this phase.'}
          </DialogDescription>
        </DialogHeader>

        {isEdit && initial?.status === 'PENDING_REVIEW' ? (
          <p className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-gold" role="status">
            Awaiting moderation — editing locked. The form below is read-only until the listing is reviewed.
          </p>
        ) : null}

        {/* Section: Basics */}
        <section className="grid gap-3" aria-label="Basics">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Basics</p>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="op-title">Title</Label>
              <span className="text-xs text-muted-foreground">{values.title.trim().length}/{TITLE_MAX}</span>
            </div>
            <Input
              id="op-title"
              value={values.title}
              onChange={e => set('title')(e.target.value)}
              onBlur={blur('title')}
              maxLength={TITLE_MAX}
              aria-invalid={!!showError('title')}
              disabled={isEdit && !canEditContent}
            />
            {showError('title') ? <p className="text-xs text-destructive" role="alert">{showError('title')}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="op-type">Type</Label>
            <Select value={values.opportunityType} onValueChange={v => set('opportunityType')(v)} disabled={isEdit && !canEditContent}>
              <SelectTrigger id="op-type" aria-label="Opportunity type" className={errors['opportunityType'] ? 'border-destructive' : ''}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {OPPORTUNITY_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {showError('opportunityType') ? <p className="text-xs text-destructive" role="alert">{showError('opportunityType')}</p> : null}
          </div>
        </section>

        {/* Section: Description & responsibilities */}
        <section className="grid gap-3 border-t border-border pt-4" aria-label="Description">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Description &amp; responsibilities</p>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="op-desc">Description</Label>
              <span className={descriptionLength > 0 && descriptionLength < DESC_MIN ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {descriptionLength}/{DESC_MAX} (min {DESC_MIN})
              </span>
            </div>
            <Textarea
              id="op-desc"
              rows={5}
              value={values.description}
              onChange={e => set('description')(e.target.value)}
              onBlur={blur('description')}
              maxLength={DESC_MAX}
              aria-invalid={!!showError('description')}
              disabled={isEdit && !canEditContent}
            />
            {showError('description') ? <p className="text-xs text-destructive" role="alert">{showError('description')}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="op-resp">Responsibilities (optional)</Label>
            <Textarea id="op-resp" rows={3} value={values.responsibilities} onChange={e => set('responsibilities')(e.target.value)} maxLength={4000} disabled={isEdit && !canEditContent} />
          </div>
        </section>

        {/* Section: Skills */}
        <section className="grid gap-3 border-t border-border pt-4" aria-label="Skills">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Skills</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="op-skills">Required skills (comma-separated)</Label>
              <Input
                id="op-skills"
                value={values.requiredSkills}
                onChange={e => set('requiredSkills')(e.target.value)}
                onBlur={blur('requiredSkills')}
                aria-invalid={!!showError('requiredSkills')}
                disabled={isEdit && !canEditContent}
              />
              <span className="text-xs text-muted-foreground">{parseSkillList(values.requiredSkills).length}/{SKILLS_MAX}</span>
              {showError('requiredSkills') ? <p className="text-xs text-destructive" role="alert">{showError('requiredSkills')}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-pref-skills">Preferred skills (comma-separated, optional)</Label>
              <Input
                id="op-pref-skills"
                value={values.preferredSkills}
                onChange={e => set('preferredSkills')(e.target.value)}
                onBlur={blur('preferredSkills')}
                aria-invalid={!!showError('preferredSkills')}
                disabled={isEdit && !canEditContent}
              />
              <span className="text-xs text-muted-foreground">{parseSkillList(values.preferredSkills).length}/{SKILLS_MAX}</span>
              {showError('preferredSkills') ? <p className="text-xs text-destructive" role="alert">{showError('preferredSkills')}</p> : null}
            </div>
          </div>
        </section>

        {/* Section: Eligibility & location / work mode */}
        <section className="grid gap-3 border-t border-border pt-4" aria-label="Eligibility and location">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Eligibility &amp; location</p>
          <div className="grid gap-2">
            <Label htmlFor="op-elig">Eligibility description (optional)</Label>
            <Textarea
              id="op-elig"
              rows={2}
              value={values.eligibilityDescription}
              onChange={e => set('eligibilityDescription')(e.target.value)}
              maxLength={1200}
              placeholder="e.g. final-year students, specific certifications…"
              disabled={isEdit && !canEditContent}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="op-location">Location</Label>
              <Input id="op-location" value={values.location} onChange={e => set('location')(e.target.value)} maxLength={120} disabled={isEdit && !canEditContent} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-mode">Work mode</Label>
              <Input id="op-mode" value={values.workMode} onChange={e => set('workMode')(e.target.value)} placeholder="Onsite / Remote / Hybrid" maxLength={30} disabled={isEdit && !canEditContent} />
            </div>
          </div>
        </section>

        {/* Section: Compensation */}
        <section className="grid gap-3 border-t border-border pt-4" aria-label="Compensation">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Compensation</p>
          <div className="grid gap-2">
            <Label htmlFor="op-comp">Compensation (informational)</Label>
            <Input id="op-comp" value={values.compensationDescription} onChange={e => set('compensationDescription')(e.target.value)} maxLength={600} disabled={isEdit && !canEditContent} />
            <p className="text-xs text-muted-foreground">Informational only — BEAN never handles payments and applications are free for candidates.</p>
          </div>
        </section>

        {/* Section: Deadline */}
        <section className="grid gap-3 border-t border-border pt-4" aria-label="Deadline">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Deadline</p>
          <div className="grid gap-2">
            <Label htmlFor="op-deadline">Application deadline</Label>
            <Input
              id="op-deadline"
              type="datetime-local"
              value={values.deadline}
              onChange={e => set('deadline')(e.target.value)}
              onBlur={blur('deadline')}
              className="[color-scheme:dark]"
              aria-invalid={!!showError('deadline')}
              disabled={isEdit && !canEditContent}
            />
            {showError('deadline') ? <p className="text-xs text-destructive" role="alert">{showError('deadline')}</p> : null}
          </div>
        </section>

        {/* Section: Review & submit */}
        <section className="grid gap-2 rounded-lg border border-border bg-elevated p-3" aria-label="Review and submit">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Review &amp; submit</p>
          {reviewGaps.length === 0 && values.opportunityType ? (
            <p className="text-sm text-success">All requirements met — ready to save{canSubmitForReview ? ' and submit for review' : ''}.</p>
          ) : (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {(!values.opportunityType ? ['Choose an opportunity type.'] : []).concat(reviewGaps).map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          )}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </section>

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          {isEdit ? (
            canEditContent ? (
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={submitDisabled} onClick={() => void submit(false)}>
                Save changes
              </Button>
            ) : null
          ) : (
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={submitDisabled} onClick={() => void submit(false)}>
              Save draft
            </Button>
          )}
          {canSubmitForReview ? (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={submitDisabled} onClick={() => void submit(true)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {isEdit ? 'Save & resubmit for review' : 'Save & submit for review'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApplicantsDialog({ opportunity, onOpenChange, onChanged }: { opportunity: PublicOpportunityClientDTO | null; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const [data, setData] = useState<EmployerApplicantsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, { note: string; visible: string }>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [query, setQuery] = useState('')

  const loadApplicants = useCallback((opportunityId: string) => {
    setData(null)
    setFailed(null)
    api.employerApplicants(opportunityId)
      .then(res => {
        setData(res)
        const init: Record<string, { note: string; visible: string }> = {}
        for (const a of res.applications) init[a.id] = { note: a.employerNotes ?? '', visible: a.candidateVisibleStatusNote ?? '' }
        setNotes(init)
      })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load applicants.'))
  }, [])

  useEffect(() => {
    if (!opportunity) return
    const t = setTimeout(() => loadApplicants(opportunity.id), 0)
    return () => clearTimeout(t)
  }, [opportunity, loadApplicants])

  const setStatus = async (applicationId: string, status: string) => {
    setBusyId(applicationId)
    try {
      await api.employerApplicationStatus(applicationId, {
        status,
        candidateVisibleStatusNote: notes[applicationId]?.visible || undefined,
        employerNotes: notes[applicationId]?.note || undefined,
      })
      toast({ title: 'Status updated — the candidate sees the change.' })
      if (opportunity) loadApplicants(opportunity.id)
      onChanged()
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const asList = (v: unknown): { name: string }[] => (Array.isArray(v) ? (v as Record<string, unknown>[]).map(x => ({ name: String(x['skillName'] ?? x['title'] ?? x['credentialName'] ?? '') })).filter(x => x.name) : [])

  // Status + text filtering run over the COMPLETE server response (the
  // applicants endpoint returns every application for the opportunity), so
  // this is a view of real data, not a partial fetch.
  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.applications.filter(a => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false
      if (!q) return true
      const haystack = [a.applicant.headline ?? '', a.applicant.summary ?? '', ...asList(a.applicant.skills).map(s => s.name)].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [data, statusFilter, query])

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

        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <Input
            aria-label="Search applicants"
            placeholder="Search headline, summary, skills…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="ALL">All statuses</SelectItem>
              {APP_STATUS_FILTER_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!data && !failed ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : failed ? (
          <div className="grid gap-2">
            <p className="text-sm text-destructive" role="alert">{failed}</p>
            {opportunity ? (
              <Button size="sm" variant="outline" className="w-fit border-gold/40 text-gold hover:bg-gold/10" onClick={() => loadApplicants(opportunity.id)}>Try again</Button>
            ) : null}
          </div>
        ) : data && data.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applications yet.</p>
        ) : data && filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applicants match this filter.</p>
        ) : data ? (
          <ul className="space-y-3">
            {filtered.map(a => (
              <li key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{a.applicant.headline || 'Candidate'}</p>
                    <p className="text-xs text-muted-foreground">Applied {formatDate(a.submittedAt)}</p>
                  </div>
                  <Badge variant="outline" className={APP_STATUS_BADGE[a.status] ?? 'border-border text-muted-foreground'}>{a.status.replace('_', ' ').toLowerCase()}</Badge>
                </div>
                {a.applicant.summary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.applicant.summary}</p> : null}
                {asList(a.applicant.skills).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {asList(a.applicant.skills).map((s, i) => <Badge key={i} variant="outline" className="border-border text-muted-foreground">{s.name}</Badge>)}
                  </div>
                ) : null}

                {/* Contact details render ONLY when the submission-time
                    snapshot carries the candidate's explicit consent. */}
                {a.contact?.email ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-2.5 py-2">
                    <Mail className="h-3.5 w-3.5 text-success" aria-hidden />
                    <span className="text-xs font-medium text-success">{a.contact.email}</span>
                    <Badge variant="outline" className="border-success/40 text-success">Shared by candidate</Badge>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No contact shared — reach out only via the candidate-visible note.</p>
                )}

                {a.candidateVisibleStatusNote ? (
                  <p className="mt-2 text-xs text-muted-foreground">Current candidate-visible note: “{a.candidateVisibleStatusNote}”</p>
                ) : null}

                {a.status !== 'WITHDRAWN' && a.status !== 'SELECTED' && a.status !== 'REJECTED' ? (
                  <div className="mt-3 grid gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor={`visible-note-${a.id}`} className="flex items-center gap-1.5 text-xs">
                        <Eye className="h-3.5 w-3.5 text-gold" aria-hidden /> Candidate-visible status note
                      </Label>
                      <Input
                        id={`visible-note-${a.id}`}
                        placeholder="e.g. interview invite — what the candidate reads"
                        value={notes[a.id]?.visible ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [a.id]: { note: n[a.id]?.note ?? '', visible: e.target.value } }))}
                        maxLength={600}
                      />
                      <p className="text-xs text-muted-foreground">Shown to the candidate next to their application status.</p>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor={`private-note-${a.id}`} className="flex items-center gap-1.5 text-xs">
                        <Lock className="h-3.5 w-3.5 text-gold" aria-hidden /> Private employer notes
                        <Badge variant="outline" className="border-border text-muted-foreground">Never shown to candidate</Badge>
                      </Label>
                      <Textarea
                        id={`private-note-${a.id}`}
                        rows={2}
                        placeholder="Your internal evaluation — only your team sees this"
                        value={notes[a.id]?.note ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [a.id]: { note: e.target.value, visible: n[a.id]?.visible ?? '' } }))}
                        maxLength={2000}
                        className="border-border bg-elevated"
                      />
                      <p className="text-xs text-muted-foreground">Private to your organization — stored separately from anything the candidate can read. Both notes are saved when you set a status below.</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'].map(s => (
                        <Button key={s} size="sm" variant="outline" className={s === 'REJECTED' ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'border-gold/40 text-gold hover:bg-gold/10'} disabled={busyId === a.id} onClick={() => void setStatus(a.id, s)}>
                          {busyId === a.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                          {s.replace('_', ' ').toLowerCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {a.status === 'WITHDRAWN' ? 'The candidate withdrew this application — no status changes are possible.' : 'This application is in a final state — no further status changes.'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ─── Candidate discovery ─────────────────────────────────────────────────────

const CANDIDATE_PAGE_SIZE = 10 // server default (max 20) — kept ≤ 20 as designed

function CandidatesPanel({ orgId }: { orgId: string }) {
  const [q, setQ] = useState('')
  const [skill, setSkill] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ candidates: DiscoverableCandidateClientDTO[]; total: number; page: number; pageSize: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const seq = useRef(0)

  const search = useCallback((query: string, skillQuery: string, targetPage: number) => {
    const id = ++seq.current
    setBusy(true)
    api.searchCandidates(orgId, { q: query || undefined, skill: skillQuery || undefined, page: targetPage })
      .then(res => {
        if (seq.current !== id) return
        setData(res)
        setPage(res.page) // stay truthful if the server clamped the page
        setFailed(null)
      })
      .catch(e => {
        if (seq.current !== id) return
        setFailed(e instanceof Error ? e.message : 'Could not search candidates.')
      })
      .finally(() => {
        if (seq.current === id) setBusy(false)
      })
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => search('', '', 1), 0)
    return () => clearTimeout(t)
  }, [search])

  const runSearch = (targetPage: number) => {
    setPage(targetPage)
    search(q, skill, targetPage)
  }

  const results = data?.candidates ?? []
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? CANDIDATE_PAGE_SIZE
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const hasFilters = q.trim() !== '' || skill.trim() !== ''

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Only candidates who chose DISCOVERABLE (and passed the adult-eligibility review) appear here — each search is
        rate-limited and audited. No scoring, no ranking: you read the profiles yourself.
      </p>

      {/* Explicit search (not auto-fire): discovery searches are rate-limited
          per recruiter per day, so results are fetched only on demand. */}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={e => { e.preventDefault(); runSearch(1) }}
      >
        <Input aria-label="Search candidates" placeholder="Headline, summary…" value={q} onChange={e => setQ(e.target.value)} />
        <Input aria-label="Skill filter" placeholder="Skill…" value={skill} onChange={e => setSkill(e.target.value)} />
        <Button type="submit" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Search className="mr-2 h-4 w-4" aria-hidden />} Search
        </Button>
      </form>

      <div className="mt-6" aria-busy={busy} aria-live="polite">
        {failed ? (
          <EmptyState
            icon={ShieldAlert}
            title="Candidate discovery unavailable"
            description={`${failed} Discovery requires a BEAN-verified employer organization and an employer role in it — the server enforces this for every search.`}
            actionLabel="Try again"
            onAction={() => search(q, skill, page)}
          />
        ) : !data ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={Users}
            title={hasFilters ? 'No discoverable candidates match your filters' : 'No candidates are currently discoverable'}
            description={hasFilters
              ? 'Try a different skill or search term — only opted-in candidate profiles can ever appear here.'
              : 'Profiles appear here only when students enable discovery AND pass BEAN\u2019s adult-eligibility review. Nothing is exposed without that explicit consent.'}
          />
        ) : (
          <div className={busy ? 'relative opacity-60 transition-opacity' : 'relative'}>
            {busy ? (
              <div className="absolute inset-0 z-10 flex items-start justify-center pt-8" role="status" aria-label="Searching candidates">
                <Loader2 className="h-5 w-5 animate-spin text-gold" />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {results.map(c => (
                <div key={c.candidateRef} className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-display text-sm font-semibold text-foreground">{c.headline || 'Candidate'}</h3>
                  {c.summaryPreview ? <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.summaryPreview}</p> : null}
                  {c.preferredRoleTypes.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Looking for: {c.preferredRoleTypes.join(', ')}</p>
                  ) : null}
                  {c.preferredLocations.length > 0 || c.workModes.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prefers: {[c.preferredLocations.join(', '), c.workModes.map(w => w.toLowerCase()).join('/')].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  {c.skills.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.skills.slice(0, 6).map((s, i) => (
                        <Badge key={i} variant="outline" className={s.verificationLabel === 'SELF_DECLARED' ? 'border-border text-muted-foreground' : 'border-success/40 text-success'}>
                          {s.skillName}{s.verificationLabel !== 'SELF_DECLARED' ? ' ✓' : ''}
                        </Badge>
                      ))}
                    </div>
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
          </div>
        )}
      </div>

      {data && total > 0 && !failed ? (
        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Candidate results pagination">
          <p className="text-xs text-muted-foreground">
            {busy ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin text-gold" aria-hidden /> : null}
            Showing {from}–{to} of {total} · page {page}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              disabled={page <= 1 || busy}
              onClick={() => runSearch(Math.max(1, page - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              disabled={page * pageSize >= total || busy}
              onClick={() => runSearch(page + 1)}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
