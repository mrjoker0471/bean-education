'use client'

// ─── Phase 7 — Admin career (#/admin/career) ─────────────────────────────────
// Three deliberately separated admin surfaces:
//   • Opportunity moderation — approve publication / reject (reason 10+ chars)
//     / pause unsafe listings (reason) / close / resume, with a full listing
//     review dialog before deciding. Every decision is audited server-side.
//   • Safety reports — private investigation workflow; a report NEVER
//     auto-suspends anything: pausing a listing is an explicit recorded
//     action with a written reason and an explicit warning.
//   • Adult-eligibility reviews — privacy-minimizing safeguarding decisions
//     (no identity documents anywhere); denial keeps private planning but
//     continues to gate employer discovery.
// Teacher trust records (TrustAction history, #/admin/trust) stay fully
// separate — no teacher data is read or shown here.

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
import {
  humanizeStatus,
  legalAdminEligibilityActions,
  legalAdminModerationActions,
  legalAdminReportActions,
  listingModerationFeedback,
  minReasonLength,
  reasonValidationError,
  type AdminEligibilityAction,
  type AdminModerationAction,
  type AdminReportAction,
} from '@/lib/employer-ui'
import {
  employerIsVerified,
  excerpt,
  opportunityTypeLabel,
  workModeLabel,
} from '@/lib/career-market-ui'
import { Briefcase, Eye, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'border-border bg-elevated text-muted-foreground',
  PENDING_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  PUBLISHED: 'border-success/40 bg-success/10 text-success',
  PAUSED: 'border-gold/60 bg-gold/5 text-gold',
  CLOSED: 'border-border bg-elevated text-muted-foreground',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  OPEN: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/60 bg-gold/5 text-gold',
  RESOLVED: 'border-success/40 bg-success/10 text-success',
  DISMISSED: 'border-border bg-elevated text-muted-foreground',
  APPROVED: 'border-success/40 bg-success/10 text-success',
  DENIED: 'border-destructive/40 bg-destructive/10 text-destructive',
  NOT_ELIGIBLE: 'border-border bg-elevated text-muted-foreground',
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={STATUS_BADGE[status] ?? 'border-border text-muted-foreground'}>{humanizeStatus(status)}</Badge>
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
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Career trust &amp; moderation</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Teacher trust lives separately in its own admin area — these queues cover employer listings, safety reports and
        adult-eligibility reviews only.
      </p>

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
  const [detailFor, setDetailFor] = useState<PublicOpportunityClientDTO | null>(null)
  const [decision, setDecision] = useState<{ op: PublicOpportunityClientDTO; action: AdminModerationAction } | null>(null)

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

  return (
    <div>
      <div className="w-full max-w-xs">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {['PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'REJECTED', 'CLOSED', 'DRAFT', 'ALL'].map(s => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'All statuses' : humanizeStatus(s)}</SelectItem>
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
          {data.map(o => {
            const actions = legalAdminModerationActions(o.status)
            const feedback = listingModerationFeedback(o)
            return (
              <li key={o.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-foreground">{o.title}</h2>
                      <Badge variant="outline" className="border-gold/30 bg-gold/5 text-gold">{opportunityTypeLabel(o.opportunityType)}</Badge>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {o.organization.displayName || o.organization.name}
                      {employerIsVerified(o.organization.verificationStatus) ? (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Verified org</Badge>
                      ) : (
                        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Unverified org</Badge>
                      )}
                      {o.location ? ` · ${o.location}` : ''}
                      {o.publishedAt ? ` · published ${new Date(o.publishedAt).toLocaleDateString()}` : ''}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt(o.description, 180)}</p>
                    {o.status === 'REJECTED' && feedback.reason ? (
                      <p className="mt-1 text-xs text-destructive">Previous rejection reason: {feedback.reason}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setDetailFor(o)}>
                    <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> Review listing
                  </Button>
                  {actions.map(a => (
                    <Button
                      key={a}
                      size="sm"
                      variant="outline"
                      className={
                        a === 'APPROVE' || a === 'RESUME'
                          ? 'border-success/40 text-success hover:bg-success/10'
                          : a === 'REJECT' || a === 'PAUSE'
                            ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
                            : 'border-border text-muted-foreground hover:bg-elevated'
                      }
                      onClick={() => setDecision({ op: o, action: a })}
                    >
                      {moderationActionLabel(a)}
                    </Button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {detailFor ? (
        <ModerationDetailDialog op={detailFor} onDecide={action => { setDetailFor(null); setDecision({ op: detailFor, action }) }} onClose={() => setDetailFor(null)} />
      ) : null}
      {decision ? (
        <ModerationDecisionDialog decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); load(status) }} />
      ) : null}
    </div>
  )
}

function moderationActionLabel(a: AdminModerationAction): string {
  switch (a) {
    case 'APPROVE': return 'Approve publication'
    case 'REJECT': return 'Reject'
    case 'PAUSE': return 'Pause'
    case 'CLOSE': return 'Close'
    case 'RESUME': return 'Resume'
  }
}

function ModerationDetailDialog({ op, onDecide, onClose }: { op: PublicOpportunityClientDTO; onDecide: (a: AdminModerationAction) => void; onClose: () => void }) {
  const actions = legalAdminModerationActions(op.status)
  const feedback = listingModerationFeedback(op)
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{op.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {op.organization.displayName || op.organization.name} · {opportunityTypeLabel(op.opportunityType)}
            {op.workMode ? ` · ${workModeLabel(op.workMode)}` : ''}
            {op.location ? ` · ${op.location}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={op.status} />
            {employerIsVerified(op.organization.verificationStatus) ? (
              <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Employer org verified</Badge>
            ) : (
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Employer org NOT verified</Badge>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{op.description}</p>
          </div>
          {op.responsibilities ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responsibilities</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{op.responsibilities}</p>
            </div>
          ) : null}
          {op.requiredSkills.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Required skills</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {op.requiredSkills.map((s, i) => <Badge key={i} variant="outline" className="border-border text-muted-foreground">{s}</Badge>)}
              </div>
            </div>
          ) : null}
          {op.preferredSkills.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preferred skills</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {op.preferredSkills.map((s, i) => <Badge key={i} variant="outline" className="border-border text-muted-foreground">{s}</Badge>)}
              </div>
            </div>
          ) : null}
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            <p>Compensation: {op.compensationDescription || 'not provided'}</p>
            <p>Application deadline: {op.applicationDeadline ? new Date(op.applicationDeadline).toLocaleString() : 'none set'}</p>
            <p>Eligibility notes: {op.eligibilityDescription || 'none'}</p>
            <p>Published: {op.publishedAt ? new Date(op.publishedAt).toLocaleString() : 'never'}</p>
          </div>
          {op.status === 'REJECTED' && (feedback.reason || feedback.note) ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs text-destructive">Previous decision{feedback.reason ? ` — reason: ${feedback.reason}` : ''}{feedback.note ? ` — note: ${feedback.note}` : ''}</p>
            </div>
          ) : null}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          {actions.map(a => (
            <Button
              key={a}
              size="sm"
              variant="outline"
              className={a === 'APPROVE' || a === 'RESUME' ? 'border-success/40 text-success hover:bg-success/10' : a === 'REJECT' || a === 'PAUSE' ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'border-border text-muted-foreground hover:bg-elevated'}
              onClick={() => onDecide(a)}
            >
              {moderationActionLabel(a)}
            </Button>
          ))}
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModerationDecisionDialog({ decision, onClose, onDone }: {
  decision: { op: PublicOpportunityClientDTO; action: AdminModerationAction }
  onClose: () => void
  onDone: () => void
}) {
  const { op, action } = decision
  const [chosen, setChosen] = useState<AdminModerationAction>(action)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  const legal = legalAdminModerationActions(op.status)
  const required = minReasonLength('moderation', chosen)
  const validation = reasonValidationError(required, reason)
  const invalid = validation !== null

  const submit = async () => {
    setAttempted(true)
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await api.adminOpportunityModeration(op.id, { action: chosen, reason: reason.trim() || undefined })
      toast({ title: 'Moderation decision recorded' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The decision could not be recorded — try again.')
    } finally {
      setBusy(false)
    }
  }

  const destructive = chosen === 'REJECT' || chosen === 'PAUSE'

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Moderation decision — {op.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Rejections and pauses require a written reason (10+ characters). Everything is recorded in the career audit
            history; the employer sees the outcome on their listing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="mod-action">Decision (only legal transitions are offered)</Label>
            <Select value={chosen} onValueChange={v => setChosen(v as AdminModerationAction)}>
              <SelectTrigger id="mod-action" aria-label="Decision"><SelectValue /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {(legal.includes(chosen) ? legal : [...legal, chosen]).map(a => (
                  <SelectItem key={a} value={a}>{moderationActionLabel(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Current status: {humanizeStatus(op.status)}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mod-reason">{required > 0 ? `Reason (required, ${required}+ characters)` : 'Reason / note (optional)'}</Label>
            <Textarea
              id="mod-reason"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={1000}
              aria-invalid={attempted && invalid}
              aria-describedby="mod-reason-help"
            />
            <p id="mod-reason-help" className={attempted && invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} role={attempted && invalid ? 'alert' : undefined}>
              {validation ?? `Stored in the audit history — ${reason.trim().length} character(s).`}
            </p>
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
            disabled={busy || invalid}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Safety reports ──────────────────────────────────────────────────────────

function ReportsPanel() {
  const [status, setStatus] = useState('OPEN')
  const [data, setData] = useState<AdminCareerReportRow[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [detailFor, setDetailFor] = useState<AdminCareerReportRow | null>(null)
  const [action, setAction] = useState<{ report: AdminCareerReportRow; kind: AdminReportAction } | null>(null)

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

  return (
    <div>
      <p className="mb-4 rounded-xl border border-gold/30 bg-gold/5 p-4 text-xs text-muted-foreground">
        Nothing is auto-suspended: a report never pauses a listing on its own — pausing is always an explicit, reasoned,
        audited admin action below. Report descriptions and resolution notes stay admin-private.
      </p>
      <div className="w-full max-w-xs">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ALL'].map(s => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'All statuses' : humanizeStatus(s)}</SelectItem>
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
          {data.map(r => {
            const actions = legalAdminReportActions(r.status, r.targetType)
            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-foreground">{r.subject}</h2>
                      <Badge variant="outline" className="border-gold/30 bg-gold/5 text-gold">{humanizeStatus(r.category)}</Badge>
                      <Badge variant="outline" className="border-border text-muted-foreground">{humanizeStatus(r.targetType)}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Target: {r.targetId.slice(0, 12)}… · filed {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt(r.description, 180)}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setDetailFor(r)}>
                    <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> Open report
                  </Button>
                  {actions.map(a => (
                    <Button
                      key={a}
                      size="sm"
                      variant="outline"
                      className={
                        a === 'RESOLVE'
                          ? 'border-success/40 text-success hover:bg-success/10'
                          : a === 'DISMISS' || a === 'PAUSE_OPPORTUNITY'
                            ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
                            : 'border-gold/40 text-gold hover:bg-gold/10'
                      }
                      onClick={() => setAction({ report: r, kind: a })}
                    >
                      {reportActionLabel(a)}
                    </Button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {detailFor ? (
        <ReportDetailDialog report={detailFor} onDecide={kind => { setDetailFor(null); setAction({ report: detailFor, kind }) }} onClose={() => setDetailFor(null)} />
      ) : null}
      {action ? (
        <ReportActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); load(status) }}
        />
      ) : null}
    </div>
  )
}

function reportActionLabel(a: AdminReportAction): string {
  switch (a) {
    case 'ACKNOWLEDGE': return 'Start review'
    case 'INVESTIGATE': return 'Mark investigating'
    case 'RESOLVE': return 'Resolve'
    case 'DISMISS': return 'Dismiss'
    case 'PAUSE_OPPORTUNITY': return 'Pause listing (with reason)'
  }
}

function ReportDetailDialog({ report, onDecide, onClose }: { report: AdminCareerReportRow; onDecide: (a: AdminReportAction) => void; onClose: () => void }) {
  const actions = legalAdminReportActions(report.status, report.targetType)
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{report.subject}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {humanizeStatus(report.category)} · targets a {humanizeStatus(report.targetType).replace('opportunity', 'listing')} · filed {new Date(report.createdAt).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={report.status} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Report description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{report.description}</p>
          </div>
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            <p>Target id: {report.targetId}</p>
            <p>Assigned admin: {report.assignedAdminId ? 'yes (this queue keeps it private)' : 'not yet assigned'}</p>
            {report.resolutionNote ? <p>Resolution note (admin-only): {report.resolutionNote}</p> : null}
            {report.resolvedAt ? <p>Resolved at: {new Date(report.resolvedAt).toLocaleString()}</p> : null}
          </div>
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          {actions.map(a => (
            <Button
              key={a}
              size="sm"
              variant="outline"
              className={a === 'RESOLVE' ? 'border-success/40 text-success hover:bg-success/10' : a === 'DISMISS' || a === 'PAUSE_OPPORTUNITY' ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'border-gold/40 text-gold hover:bg-gold/10'}
              onClick={() => onDecide(a)}
            >
              {reportActionLabel(a)}
            </Button>
          ))}
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReportActionDialog({ action, onClose, onDone }: {
  action: { report: AdminCareerReportRow; kind: AdminReportAction }
  onClose: () => void
  onDone: () => void
}) {
  const { report, kind } = action
  const [chosen, setChosen] = useState<AdminReportAction>(kind)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  const legal = legalAdminReportActions(report.status, report.targetType)
  const required = minReasonLength('report', chosen)
  const validation = reasonValidationError(required, note)
  const invalid = validation !== null
  const pausesListing = chosen === 'PAUSE_OPPORTUNITY'

  const submit = async () => {
    setAttempted(true)
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.adminCareerReportAction(report.id, { action: chosen, note: note.trim() || undefined })
      toast({ title: res.opportunityPaused ? 'Listing paused — recorded decision' : 'Report action recorded' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not be recorded — try again.')
    } finally {
      setBusy(false)
    }
  }

  const destructive = chosen === 'DISMISS' || pausesListing

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Record a human decision</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Notes stay admin-private. Resolving, dismissing and pausing a listing all require a written reason
            (10+ characters) — everything is audited.
          </DialogDescription>
        </DialogHeader>
        {pausesListing ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
            Pausing hides the LINKED LISTING from every candidate until a moderator resumes it. Only pause when the
            report itself justifies it.
          </p>
        ) : null}
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="report-action">Action (only legal transitions are offered)</Label>
            <Select value={chosen} onValueChange={v => setChosen(v as AdminReportAction)}>
              <SelectTrigger id="report-action" aria-label="Action"><SelectValue /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {(legal.includes(chosen) ? legal : [...legal, chosen]).map(a => (
                  <SelectItem key={a} value={a}>{reportActionLabel(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Current report status: {humanizeStatus(report.status)}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="report-note">{required > 0 ? `Note (required, ${required}+ characters)` : 'Note (optional)'}</Label>
            <Textarea
              id="report-note"
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={2000}
              aria-invalid={attempted && invalid}
              aria-describedby="report-note-help"
            />
            <p id="report-note-help" className={attempted && invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} role={attempted && invalid ? 'alert' : undefined}>
              {validation ?? `Admin-private investigation note — ${note.trim().length} character(s).`}
            </p>
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
            disabled={busy || invalid}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Adult eligibility ───────────────────────────────────────────────────────

function EligibilityPanel() {
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [data, setData] = useState<AdminEligibilityRow[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [decision, setDecision] = useState<{ review: AdminEligibilityRow; kind: AdminEligibilityAction } | null>(null)

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
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'All statuses' : humanizeStatus(s)}</SelectItem>
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
          {data.map(r => {
            const actions = legalAdminEligibilityActions(r.status)
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.student.displayName || 'Student'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    requested {r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : '—'}
                    {r.reviewedAt ? ` · reviewed ${new Date(r.reviewedAt).toLocaleDateString()}` : ''}
                    {r.decisionReason ? ` · reason: ${r.decisionReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {actions.map(a => (
                    <Button
                      key={a}
                      size="sm"
                      variant="outline"
                      className={a === 'APPROVE' ? 'border-success/40 text-success hover:bg-success/10' : 'border-destructive/40 text-destructive hover:bg-destructive/10'}
                      onClick={() => setDecision({ review: r, kind: a })}
                    >
                      {a === 'APPROVE' ? 'Approve' : 'Deny'}
                    </Button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {decision ? (
        <EligibilityDecisionDialog decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); load(status) }} />
      ) : null}
    </div>
  )
}

function EligibilityDecisionDialog({ decision, onClose, onDone }: {
  decision: { review: AdminEligibilityRow; kind: AdminEligibilityAction }
  onClose: () => void
  onDone: () => void
}) {
  const { review, kind } = decision
  const [chosen, setChosen] = useState<AdminEligibilityAction>(kind)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  const legal = legalAdminEligibilityActions(review.status)
  const required = minReasonLength('eligibility', chosen)
  const validation = reasonValidationError(required, reason)
  const invalid = validation !== null

  const submit = async () => {
    setAttempted(true)
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await api.adminEligibilityDecision(review.id, { decision: chosen, reason: reason.trim() || undefined })
      toast({ title: 'Eligibility decision recorded' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The decision could not be recorded — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Eligibility decision — {review.student.displayName || 'Student'}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Adult-eligibility decisions gate employer discovery: approval unlocks DISCOVERABLE profiles and
            applications; denial keeps discovery and applications blocked while private planning stays available.
            The decision is audited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="elig-decision">Decision</Label>
            <Select value={chosen} onValueChange={v => setChosen(v as AdminEligibilityAction)}>
              <SelectTrigger id="elig-decision" aria-label="Decision"><SelectValue /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {(legal.includes(chosen) ? legal : [...legal, chosen]).map(a => (
                  <SelectItem key={a} value={a}>{a === 'APPROVE' ? 'Approve' : 'Deny'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Current status: {humanizeStatus(review.status)}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="elig-reason">{required > 0 ? `Reason (required, ${required}+ characters)` : 'Reason / note (optional)'}</Label>
            <Textarea
              id="elig-reason"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={1000}
              aria-invalid={attempted && invalid}
              aria-describedby="elig-reason-help"
            />
            <p id="elig-reason-help" className={attempted && invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} role={attempted && invalid ? 'alert' : undefined}>
              {validation ?? `Stored with the decision — ${reason.trim().length} character(s).`}
            </p>
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            className={chosen === 'DENY' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
            disabled={busy || invalid}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
