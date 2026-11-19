'use client'

// ─── Phase 7 — Admin career (#/admin/career) ─────────────────────────────────
// Opportunity moderation queue (approve publication / reject with required
// reason / pause unsafe listings), career safety reports (private
// investigation notes; a report NEVER auto-suspends — pausing a listing is an
// explicit recorded action), and adult-eligibility reviews (privacy-minimizing
// safeguarding: no identity documents are collected anywhere).

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { AdminCareerReportRow, AdminEligibilityRow, PublicOpportunityClientDTO } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { Briefcase, ClipboardCheck, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'border-border bg-elevated text-muted-foreground',
  PENDING_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  PUBLISHED: 'border-success/40 bg-success/10 text-success',
  PAUSED: 'border-gold/40 bg-gold/10 text-gold',
  CLOSED: 'border-border bg-elevated text-muted-foreground',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  OPEN: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  RESOLVED: 'border-success/40 bg-success/10 text-success',
  DISMISSED: 'border-border bg-elevated text-muted-foreground',
  APPROVED: 'border-success/40 bg-success/10 text-success',
  DENIED: 'border-destructive/40 bg-destructive/10 text-destructive',
  NOT_ELIGIBLE: 'border-border bg-elevated text-muted-foreground',
}

export function AdminCareerView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const isAdmin = authedStudent?.role === 'ADMIN'
  const [tab, setTab] = useState<'opportunities' | 'reports' | 'eligibility'>('opportunities')

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={ShieldCheck} title="Administrators only" description="Career moderation is restricted to BEAN administrators (server-enforced)." actionLabel="Go home" onAction={() => navigate({ view: 'home' })} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Admin</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Career trust & moderation</h1>

      <Tabs value={tab} onValueChange={v => setTab(v as 'opportunities' | 'reports' | 'eligibility')} className="mt-6">
        <TabsList className="bg-elevated">
          <TabsTrigger value="opportunities">Opportunity moderation</TabsTrigger>
          <TabsTrigger value="reports">Safety reports</TabsTrigger>
          <TabsTrigger value="eligibility">Adult eligibility</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-6">
        {tab === 'opportunities' && <ModerationPanel />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'eligibility' && <EligibilityPanel />}
      </div>
    </div>
  )
}

// ─── Opportunity moderation ──────────────────────────────────────────────────

function ModerationPanel() {
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [data, setData] = useState<PublicOpportunityClientDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [decision, setDecision] = useState<{ op: PublicOpportunityClientDTO; action: 'APPROVE' | 'REJECT' | 'PAUSE' | 'CLOSE' } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback((filter: string) => {
    setData(null)
    api.adminCareerOpportunities(filter)
      .then(res => { setData(res.opportunities); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load the moderation queue.'))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(status), 0)
    return () => clearTimeout(t)
  }, [status, load])

  const decide = async () => {
    if (!decision) return
    setBusy(true)
    try {
      await api.adminOpportunityModeration(decision.op.id, { action: decision.action, reason: reason.trim() || undefined })
      toast({ title: 'Moderation decision recorded' })
      setDecision(null); setReason('')
      load(status)
    } catch (e) {
      toast({ title: 'Could not record decision', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="w-full max-w-xs">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {['PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'REJECTED', 'CLOSED', 'DRAFT', 'ALL'].map(s => (
              <SelectItem key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {failed ? (
        <div className="mt-6"><EmptyState icon={Briefcase} title="Could not load queue" description={failed} actionLabel="Try again" onAction={() => load(status)} /></div>
      ) : !data ? (
        <div className="mt-6 flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.length === 0 ? (
        <div className="mt-6"><EmptyState icon={Briefcase} title="Nothing in this queue" description="No listings match this filter." /></div>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.map(o => (
            <li key={o.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-foreground">{o.title}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.organization.displayName || o.organization.name} · {o.opportunityType.toLowerCase()}{o.location ? ` · ${o.location}` : ''}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{o.description}</p>
                </div>
                <Badge variant="outline" className={STATUS_BADGE[o.status] ?? 'border-border text-muted-foreground'}>{o.status.replace('_', ' ').toLowerCase()}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {o.status === 'PENDING_REVIEW' ? (
                  <>
                    <Button size="sm" className="bg-success/90 text-white hover:bg-success" onClick={() => setDecision({ op: o, action: 'APPROVE' })}>Approve publication</Button>
                    <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDecision({ op: o, action: 'REJECT' })}>Reject</Button>
                  </>
                ) : null}
                {o.status === 'PUBLISHED' ? (
                  <>
                    <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setDecision({ op: o, action: 'PAUSE' })}>Pause</Button>
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setDecision({ op: o, action: 'CLOSE' })}>Close</Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!decision} onOpenChange={o => !o && !busy && setDecision(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Moderation decision</DialogTitle>
            <DialogDescription className="text-muted-foreground">Rejections and pauses require a written reason (10+ characters) — recorded in the career audit history.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="mod-reason">Reason / note</Label>
            <Textarea id="mod-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              className={decision?.action === 'REJECT' || decision?.action === 'PAUSE' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              disabled={busy || ((decision?.action === 'REJECT' || decision?.action === 'PAUSE') && reason.trim().length < 10)}
              onClick={decide}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Safety reports ──────────────────────────────────────────────────────────

function ReportsPanel() {
  const [status, setStatus] = useState('OPEN')
  const [data, setData] = useState<AdminCareerReportRow[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [action, setAction] = useState<{ report: AdminCareerReportRow; kind: 'ACKNOWLEDGE' | 'RESOLVE' | 'DISMISS' | 'PAUSE_OPPORTUNITY' } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback((filter: string) => {
    setData(null)
    api.adminCareerReports(filter)
      .then(res => { setData(res.reports); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load safety reports.'))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(status), 0)
    return () => clearTimeout(t)
  }, [status, load])

  const run = async () => {
    if (!action) return
    setBusy(true)
    try {
      const res = await api.adminCareerReportAction(action.report.id, { action: action.kind, note: note.trim() || undefined })
      toast({ title: res.opportunityPaused ? 'Listing paused — recorded decision' : 'Report action recorded' })
      setAction(null); setNote('')
      load(status)
    } catch (e) {
      toast({ title: 'Could not record action', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="w-full max-w-xs">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ALL'].map(s => (
              <SelectItem key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {failed ? (
        <div className="mt-6"><EmptyState icon={ShieldAlert} title="Could not load reports" description={failed} actionLabel="Try again" onAction={() => load(status)} /></div>
      ) : !data ? (
        <div className="mt-6 flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.length === 0 ? (
        <div className="mt-6"><EmptyState icon={ShieldAlert} title="No reports" description="Nothing matches this filter." /></div>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.map(r => (
            <li key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-foreground">{r.subject}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.category.replace(/_/g, ' ').toLowerCase()} · {r.targetType.toLowerCase()} · filed {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{r.description}</p>
                  {r.resolutionNote ? <p className="mt-1 text-xs text-muted-foreground">Resolution note: {r.resolutionNote}</p> : null}
                </div>
                <Badge variant="outline" className={STATUS_BADGE[r.status] ?? 'border-border text-muted-foreground'}>{r.status.replace('_', ' ').toLowerCase()}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status === 'OPEN' ? (
                  <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setAction({ report: r, kind: 'ACKNOWLEDGE' })}>
                    <ClipboardCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> Start review
                  </Button>
                ) : null}
                {r.targetType === 'OPPORTUNITY' && ['OPEN', 'UNDER_REVIEW'].includes(r.status) ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setAction({ report: r, kind: 'PAUSE_OPPORTUNITY' })}>
                    Pause listing (with reason)
                  </Button>
                ) : null}
                {r.status === 'UNDER_REVIEW' ? (
                  <>
                    <Button size="sm" className="bg-success/90 text-white hover:bg-success" onClick={() => setAction({ report: r, kind: 'RESOLVE' })}>Resolve</Button>
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setAction({ report: r, kind: 'DISMISS' })}>Dismiss</Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!action} onOpenChange={o => !o && !busy && setAction(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Record a human decision</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Nothing is auto-suspended: pausing a listing or resolving a report is always an explicit, reasoned, audited
              action. Notes stay admin-private.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="report-note">Note (required to resolve/dismiss/pause)</Label>
            <Textarea id="report-note" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
            <Button
              className={action?.kind === 'PAUSE_OPPORTUNITY' || action?.kind === 'DISMISS' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              disabled={busy || (['RESOLVE', 'DISMISS', 'PAUSE_OPPORTUNITY'].includes(action?.kind ?? '') && note.trim().length < 10)}
              onClick={run}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Adult eligibility ───────────────────────────────────────────────────────

function EligibilityPanel() {
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [data, setData] = useState<AdminEligibilityRow[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [decision, setDecision] = useState<{ review: AdminEligibilityRow; kind: 'APPROVE' | 'DENY' } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback((filter: string) => {
    setData(null)
    api.adminEligibility(filter)
      .then(res => { setData(res.reviews); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load eligibility reviews.'))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(status), 0)
    return () => clearTimeout(t)
  }, [status, load])

  const decide = async () => {
    if (!decision) return
    setBusy(true)
    try {
      await api.adminEligibilityDecision(decision.review.id, { decision: decision.kind, reason: reason.trim() || undefined })
      toast({ title: 'Eligibility decision recorded' })
      setDecision(null); setReason('')
      load(status)
    } catch (e) {
      toast({ title: 'Could not record decision', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-4 rounded-xl border border-gold/30 bg-gold/5 p-4 text-xs text-muted-foreground">
        Safeguarding: discovery and applications stay server-blocked until a review is APPROVED. This review is
        privacy-minimizing — no identity documents or numbers are collected or stored anywhere in BEAN. Denial keeps
        private career planning fully available.
      </p>
      <div className="w-full max-w-xs">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {['PENDING_REVIEW', 'APPROVED', 'DENIED', 'NOT_ELIGIBLE', 'ALL'].map(s => (
              <SelectItem key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {failed ? (
        <div className="mt-6"><EmptyState icon={ShieldCheck} title="Could not load reviews" description={failed} actionLabel="Try again" onAction={() => load(status)} /></div>
      ) : !data ? (
        <div className="mt-6 flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.length === 0 ? (
        <div className="mt-6"><EmptyState icon={ShieldCheck} title="No reviews here" description="Nothing matches this filter." /></div>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="text-sm font-medium text-foreground">{r.student.displayName || 'Student'}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  requested {r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : '—'}
                  {r.decisionReason ? ` · reason: ${r.decisionReason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STATUS_BADGE[r.status] ?? 'border-border text-muted-foreground'}>{r.status.replace('_', ' ').toLowerCase()}</Badge>
                {r.status === 'PENDING_REVIEW' ? (
                  <>
                    <Button size="sm" className="bg-success/90 text-white hover:bg-success" onClick={() => setDecision({ review: r, kind: 'APPROVE' })}>Approve</Button>
                    <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDecision({ review: r, kind: 'DENY' })}>Deny</Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!decision} onOpenChange={o => !o && !busy && setDecision(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Eligibility decision</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Denials require a written reason (10+ characters). The decision is audited; denial continues to block
              discovery and applications while private planning stays available.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="elig-reason">Reason / note</Label>
            <Textarea id="elig-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              className={decision?.kind === 'DENY' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              disabled={busy || (decision?.kind === 'DENY' && reason.trim().length < 10)}
              onClick={decide}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
