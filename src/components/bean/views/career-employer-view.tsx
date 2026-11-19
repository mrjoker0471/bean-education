'use client'

// ─── Phase 7 — Employer dashboard (#/career/employer) ────────────────────────
// For members of APPROVED EMPLOYER organizations: manage listings (draft →
// review → published lifecycle with admin moderation), review applicants of
// own opportunities (snapshot-based, consent-gated contact), and run
// consent-gated candidate discovery (rate-limited, paginated, no AI scoring).

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useAppStore } from '@/lib/store'
import type {
  DiscoverableCandidateClientDTO,
  EmployerApplicantsResponse,
  EmployerOpportunitiesResponse,
  MyOrganizationsResponse,
  PublicOpportunityClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { ArrowLeft, Building2, Inbox, Loader2, Search, Send, Users } from 'lucide-react'

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
  const [createOpen, setCreateOpen] = useState(false)
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Listings go live only after a BEAN moderator approves them.</p>
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
          New opportunity
        </Button>
      </div>
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
                    {o.opportunityType.toLowerCase()}{o.location ? ` · ${o.location}` : ''}{o.applicationDeadline ? ` · apply by ${new Date(o.applicationDeadline).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_BADGE[o.status] ?? 'border-border text-muted-foreground'}>{o.status.replace('_', ' ').toLowerCase()}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {o.status === 'DRAFT' || o.status === 'REJECTED' || o.status === 'PAUSED' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gold/40 text-gold hover:bg-gold/10"
                    onClick={async () => {
                      try {
                        await api.updateEmployerOpportunity(o.id, { status: 'PENDING_REVIEW' })
                        toast({ title: 'Submitted for moderation' })
                        load()
                      } catch (e) {
                        toast({ title: 'Could not submit', description: e instanceof Error ? e.message : '', variant: 'destructive' })
                      }
                    }}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> Submit for review
                  </Button>
                ) : null}
                {o.status === 'PUBLISHED' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border text-muted-foreground hover:bg-elevated"
                    onClick={async () => {
                      try {
                        await api.updateEmployerOpportunity(o.id, { status: 'CLOSED' })
                        toast({ title: 'Listing closed' })
                        load()
                      } catch (e) {
                        toast({ title: 'Could not close', description: e instanceof Error ? e.message : '', variant: 'destructive' })
                      }
                    }}
                  >
                    Close listing
                  </Button>
                ) : null}
                {o.status === 'PUBLISHED' || o.status === 'PAUSED' || o.status === 'CLOSED' ? (
                  <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setApplicantsFor(o)}>
                    <Users className="mr-1 h-3.5 w-3.5" aria-hidden /> View applicants
                  </Button>
                ) : null}
                {o.status === 'REJECTED' ? <p className="text-xs text-destructive">A moderator rejected this listing — edit and resubmit.</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateOpportunityDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={() => { setCreateOpen(false); load() }} />
      <ApplicantsDialog opportunity={applicantsFor} onOpenChange={o => !o && setApplicantsFor(null)} onChanged={load} />
    </div>
  )
}

function CreateOpportunityDialog({ open, onOpenChange, orgId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [responsibilities, setResponsibilities] = useState('')
  const [requiredSkills, setRequiredSkills] = useState('')
  const [location, setLocation] = useState('')
  const [workMode, setWorkMode] = useState('')
  const [opportunityType, setOpportunityType] = useState('')
  const [compensationDescription, setCompensation] = useState('')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (submitForReview: boolean) => {
    setError(null)
    if (title.trim().length < 6 || description.trim().length < 80 || !opportunityType) {
      setError('Title (6+ chars), a real description (80+ chars) and a type are required.')
      return
    }
    setBusy(true)
    try {
      const res = await api.createEmployerOpportunity({
        organizationId: orgId,
        title: title.trim(),
        description: description.trim(),
        responsibilities: responsibilities.trim() || undefined,
        requiredSkills: requiredSkills.split(',').map(s => s.trim()).filter(Boolean),
        location: location.trim() || undefined,
        workMode: workMode.trim() || undefined,
        opportunityType,
        compensationDescription: compensationDescription.trim() || undefined,
        applicationDeadline: deadline ? new Date(deadline).toISOString() : undefined,
      })
      if (submitForReview) {
        await api.updateEmployerOpportunity(res.opportunity.id, { status: 'PENDING_REVIEW' })
        toast({ title: 'Submitted for moderation — it goes live once a moderator approves it.' })
      } else {
        toast({ title: 'Draft saved' })
      }
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">New opportunity</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Compensation is informational only — BEAN is free for applicants and charges employers nothing in this phase.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="op-title">Title</Label>
            <Input id="op-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="op-desc">Description (80+ characters)</Label>
            <Textarea id="op-desc" rows={5} value={description} onChange={e => setDescription(e.target.value)} maxLength={6000} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="op-resp">Responsibilities (optional)</Label>
            <Textarea id="op-resp" rows={3} value={responsibilities} onChange={e => setResponsibilities(e.target.value)} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="op-type">Type</Label>
              <Select value={opportunityType} onValueChange={setOpportunityType}>
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
              <Input id="op-skills" value={requiredSkills} onChange={e => setRequiredSkills(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-location">Location</Label>
              <Input id="op-location" value={location} onChange={e => setLocation(e.target.value)} maxLength={120} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-mode">Work mode</Label>
              <Input id="op-mode" value={workMode} onChange={e => setWorkMode(e.target.value)} placeholder="Onsite / Remote / Hybrid" maxLength={30} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-comp">Compensation (informational)</Label>
              <Input id="op-comp" value={compensationDescription} onChange={e => setCompensation(e.target.value)} maxLength={600} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="op-deadline">Application deadline</Label>
              <Input id="op-deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="[color-scheme:dark]" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy || !opportunityType} onClick={() => void submit(false)}>Save draft</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !opportunityType} onClick={() => void submit(true)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save & submit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApplicantsDialog({ opportunity, onOpenChange, onChanged }: { opportunity: PublicOpportunityClientDTO | null; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const [data, setData] = useState<EmployerApplicantsResponse | null>(null)
  const [notes, setNotes] = useState<Record<string, { note: string; visible: string }>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!opportunity) return
    const t = setTimeout(() => {
      setData(null)
      api.employerApplicants(opportunity.id)
        .then(res => {
          setData(res)
          const init: Record<string, { note: string; visible: string }> = {}
          for (const a of res.applications) init[a.id] = { note: a.employerNotes ?? '', visible: a.candidateVisibleStatusNote ?? '' }
          setNotes(init)
        })
        .catch(() => setData(null))
    }, 0)
    return () => clearTimeout(t)
  }, [opportunity])

  const setStatus = async (applicationId: string, status: string) => {
    setBusyId(applicationId)
    try {
      await api.employerApplicationStatus(applicationId, {
        status,
        candidateVisibleStatusNote: notes[applicationId]?.visible || undefined,
        employerNotes: notes[applicationId]?.note || undefined,
      })
      toast({ title: 'Status updated — the candidate sees the change.' })
      if (opportunity) {
        const res = await api.employerApplicants(opportunity.id)
        setData(res)
      }
      onChanged()
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const asList = (v: unknown): { name: string }[] => (Array.isArray(v) ? (v as Record<string, unknown>[]).map(x => ({ name: String(x['skillName'] ?? x['title'] ?? x['credentialName'] ?? '') })).filter(x => x.name) : [])

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
        {!data ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : data.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applications yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.applications.map(a => (
              <li key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{a.applicant.headline || 'Candidate'}</p>
                  <Badge variant="outline" className={APP_STATUS_BADGE[a.status] ?? 'border-border text-muted-foreground'}>{a.status.replace('_', ' ').toLowerCase()}</Badge>
                </div>
                {a.applicant.summary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.applicant.summary}</p> : null}
                {asList(a.applicant.skills).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {asList(a.applicant.skills).map((s, i) => <Badge key={i} variant="outline" className="border-border text-muted-foreground">{s.name}</Badge>)}
                  </div>
                ) : null}
                {a.contact?.email ? (
                  <p className="mt-2 text-xs text-success">Consented contact: {a.contact.email}</p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No contact sharing — reach out only via the candidate-visible note.</p>
                )}
                {a.status !== 'WITHDRAWN' && a.status !== 'SELECTED' && a.status !== 'REJECTED' ? (
                  <div className="mt-3 grid gap-2">
                    <Input
                      aria-label={`Visible note for application ${a.id}`}
                      placeholder="Candidate-visible note (e.g. interview invite)"
                      value={notes[a.id]?.visible ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [a.id]: { note: n[a.id]?.note ?? '', visible: e.target.value } }))}
                      maxLength={600}
                    />
                    <Input
                      aria-label={`Private note for application ${a.id}`}
                      placeholder="Private note (never shown to the candidate)"
                      value={notes[a.id]?.note ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [a.id]: { note: e.target.value, visible: n[a.id]?.visible ?? '' } }))}
                      maxLength={2000}
                    />
                    <div className="flex flex-wrap gap-2">
                      {['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'].map(s => (
                        <Button key={s} size="sm" variant="outline" className={s === 'REJECTED' ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'border-gold/40 text-gold hover:bg-gold/10'} disabled={busyId === a.id} onClick={() => void setStatus(a.id, s)}>
                          {s.replace('_', ' ').toLowerCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Candidate discovery ─────────────────────────────────────────────────────

function CandidatesPanel({ orgId }: { orgId: string }) {
  const [q, setQ] = useState('')
  const [skill, setSkill] = useState('')
  const [data, setData] = useState<{ candidates: DiscoverableCandidateClientDTO[]; total: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const search = useCallback((query: string, skillQuery: string) => {
    setBusy(true)
    api.searchCandidates(orgId, { q: query || undefined, skill: skillQuery || undefined })
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not search candidates.'))
      .finally(() => setBusy(false))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => search('', ''), 0)
    return () => clearTimeout(t)
  }, [search])

  const results = useMemo(() => data?.candidates ?? [], [data])

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Only candidates who chose DISCOVERABLE (and passed the adult-eligibility review) appear here — each search is
        rate-limited and audited. No scoring, no ranking: you read the profiles yourself.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input aria-label="Search candidates" placeholder="Headline, summary…" value={q} onChange={e => setQ(e.target.value)} />
        <Input aria-label="Skill filter" placeholder="Skill…" value={skill} onChange={e => setSkill(e.target.value)} />
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => search(q, skill)}>
          <Search className="mr-2 h-4 w-4" aria-hidden /> Search
        </Button>
      </div>

      <div className="mt-6">
        {failed ? (
          <EmptyState icon={Users} title="Could not search candidates" description={failed} actionLabel="Try again" onAction={() => search(q, skill)} />
        ) : !data ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : results.length === 0 ? (
          <EmptyState icon={Users} title="No discoverable candidates match" description="Candidates appear only when they explicitly opt into discovery." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {results.map(c => (
              <div key={c.candidateRef} className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-display text-sm font-semibold text-foreground">{c.headline || 'Candidate'}</h3>
                {c.summaryPreview ? <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.summaryPreview}</p> : null}
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
        )}
      </div>
    </div>
  )
}
