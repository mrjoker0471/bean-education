'use client'

// ─── Phase 7 — My applications (#/career/applications) ───────────────────────
// The student's own application tracker: a server-backed status filter
// (GET /api/career/my-applications?status=…), per-application detail with the
// submission-time snapshot, employer updates, withdrawal (with a final
// confirmation) and the safety-report entry point scoped to the listing.
// employerNotes are never present in these DTOs (server-enforced privacy) and
// never referenced here.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import {
  applicationStatusBadgeClass,
  applicationStatusLabel,
  canWithdrawApplication,
  employerIsVerified,
  snapshotDisplayRows,
} from '@/lib/career-market-ui'
import type { ApplicationDetailResponse, MyApplicationsResponse, OwnApplicationClientDTO } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { Inbox, Loader2, ShieldAlert } from 'lucide-react'

const STATUS_FILTERS = ['ALL', 'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN'] as const

const REPORT_CATEGORIES = ['FRAUDULENT_LISTING', 'MISLEADING_DESCRIPTION', 'ORGANIZATION_CONDUCT', 'HARASSMENT', 'DISCRIMINATION', 'SAFEGUARDING', 'OTHER']

export function CareerApplicationsView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [data, setData] = useState<MyApplicationsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Withdrawal confirmation (consequential — final for the application).
  const [withdrawTarget, setWithdrawTarget] = useState<OwnApplicationClientDTO | null>(null)

  // Per-application detail (owner-scoped GET with the submission snapshot).
  const [detailCard, setDetailCard] = useState<OwnApplicationClientDTO | null>(null)
  const [detailData, setDetailData] = useState<ApplicationDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFailed, setDetailFailed] = useState<string | null>(null)

  // Safety report dialog (existing categories, scoped to the opportunity).
  const [reportTarget, setReportTarget] = useState<{ id: string; title: string } | null>(null)
  const [category, setCategory] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setData(null)
    api.myApplications(statusFilter !== 'ALL' ? statusFilter : undefined)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your applications.'))
  }, [statusFilter])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  const openDetail = (a: OwnApplicationClientDTO) => {
    setDetailCard(a)
    setDetailData(null)
    setDetailFailed(null)
    setDetailLoading(true)
    api.applicationDetail(a.id)
      .then(res => { setDetailData(res); setDetailFailed(null) })
      .catch(e => setDetailFailed(e instanceof Error ? e.message : 'Could not load the application.'))
      .finally(() => setDetailLoading(false))
  }

  const retryDetail = () => {
    if (!detailCard) return
    openDetail(detailCard)
  }

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return
    setBusyId(withdrawTarget.id)
    try {
      await api.withdrawApplication(withdrawTarget.id)
      toast({ title: 'Application withdrawn' })
      setWithdrawTarget(null)
      load()
    } catch (e) {
      // The dialog stays open with the confirmation intact — the student can retry.
      toast({ title: 'Could not withdraw', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const fileReport = async () => {
    if (!reportTarget) return
    setBusy(true)
    try {
      await api.fileCareerReport({
        targetType: 'OPPORTUNITY',
        targetId: reportTarget.id,
        category: category || 'OTHER',
        subject: subject.trim(),
        description: description.trim(),
      })
      toast({ title: 'Report filed privately — BEAN administrators will investigate. Nothing is auto-suspended.' })
      setReportTarget(null); setCategory(''); setSubject(''); setDescription('')
    } catch (e) {
      toast({ title: 'Could not file report', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={Inbox} title="Sign in required" description="Track your applications after signing in." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">My applications</h1>
      <p className="mt-2 text-sm text-muted-foreground">Statuses update as employers review your submission. Employers see only the snapshot you selected — never your live profile.</p>

      {/* Server-backed status filter */}
      <div className="mt-5 grid gap-2 sm:max-w-xs">
        <Label htmlFor="applications-status" className="text-xs text-muted-foreground">Filter by status</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger id="applications-status" aria-label="Filter applications by status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {STATUS_FILTERS.map(s => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'All statuses' : applicationStatusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {failed ? (
        <div className="mt-8"><EmptyState icon={Inbox} title="Could not load applications" description={failed} actionLabel="Try again" onAction={load} /></div>
      ) : !data ? (
        <div className="mt-8 flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading applications"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.applications.length === 0 ? (
        statusFilter !== 'ALL' ? (
          <div className="mt-8">
            <EmptyState
              icon={Inbox}
              title={`No applications with status ${applicationStatusLabel(statusFilter)}`}
              description="Switch the filter to see your other applications."
              actionLabel="Show all statuses"
              onAction={() => setStatusFilter('ALL')}
            />
          </div>
        ) : (
          <div className="mt-8">
            <EmptyState icon={Inbox} title="No applications yet" description="Browse moderated opportunities from verified employers." actionLabel="Browse opportunities" onAction={() => navigate({ view: 'career-opportunities' })} />
          </div>
        )
      ) : (
        <ul className="mt-8 space-y-3">
          {data.applications.map(a => (
            <li key={a.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <button type="button" className="font-display text-base font-semibold text-foreground hover:text-gold" onClick={() => openDetail(a)} aria-label={`View details for ${a.opportunity.title}`}>
                    {a.opportunity.title}
                  </button>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.opportunity.organizationName} · {a.opportunity.opportunityType.toLowerCase()} · applied {new Date(a.submittedAt).toLocaleDateString()}</p>
                </div>
                <Badge variant="outline" className={applicationStatusBadgeClass(a.status)}>{applicationStatusLabel(a.status)}</Badge>
              </div>
              {a.candidateVisibleStatusNote ? (
                <div className="mt-2 rounded-lg border border-border bg-elevated p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-gold">Employer update</p>
                  <p className="mt-1 text-sm text-muted-foreground">{a.candidateVisibleStatusNote}</p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => openDetail(a)}>
                  View details
                </Button>
                {canWithdrawApplication(a.status) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={busyId === a.id}
                    onClick={() => setWithdrawTarget(a)}
                  >
                    {busyId === a.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Withdraw
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => { setReportTarget({ id: a.opportunity.id, title: a.opportunity.title }); setCategory(''); setSubject(''); setDescription('') }}>
                  <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden /> Report this listing
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Withdrawal — explicit, final confirmation */}
      <AlertDialog open={!!withdrawTarget} onOpenChange={open => !open && !busyId && setWithdrawTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Withdraw this application?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {withdrawTarget && (
                <>
                  Withdrawing is final for this application. “{withdrawTarget.opportunity.title}” at{' '}
                  {withdrawTarget.opportunity.organizationName} will show as withdrawn and cannot be reactivated — you could
                  only apply again if the listing still accepts applications. Current status:{' '}
                  {applicationStatusLabel(withdrawTarget.status)}.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId} className="border-border bg-transparent text-muted-foreground hover:bg-elevated">Keep application</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busyId}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => { e.preventDefault(); void confirmWithdraw() }}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Withdraw application
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Application detail — submission-time snapshot + timeline */}
      <Dialog open={!!detailCard} onOpenChange={o => { if (!o) { setDetailCard(null); setDetailData(null); setDetailFailed(null) } }}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{detailCard?.opportunity.title ?? 'Application'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              What you shared at submission, the current status, and the listing details.
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex min-h-[20vh] items-center justify-center" role="status" aria-label="Loading application"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
          ) : detailFailed ? (
            <div className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{detailFailed}</p>
              <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={retryDetail}>Try again</Button>
            </div>
          ) : detailData ? (
            (() => {
              const app = detailData.application
              const rows = snapshotDisplayRows(app.snapshot)
              return (
                <div className="grid gap-4">
                  <div className="grid gap-1.5 rounded-lg border border-border bg-elevated p-4 text-sm text-muted-foreground">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="text-gold">Employer:</span> {app.organization.name}
                      {employerIsVerified(app.organization.verificationStatus) ? (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Identity reviewed by BEAN</Badge>
                      ) : null}
                    </p>
                    <p><span className="text-gold">Role:</span> {app.opportunity.opportunityType.toLowerCase()}{app.opportunity.workMode ? ` · ${app.opportunity.workMode.toLowerCase()}` : ''}{app.opportunity.location ? ` · ${app.opportunity.location}` : ''}</p>
                    {app.opportunity.applicationDeadline ? (
                      <p><span className="text-gold">Listing deadline:</span> {new Date(app.opportunity.applicationDeadline).toLocaleDateString()}</p>
                    ) : null}
                    <p><span className="text-gold">Submitted:</span> {new Date(app.submittedAt).toLocaleDateString()}</p>
                    <p><span className="text-gold">Last update:</span> {new Date(app.updatedAt).toLocaleDateString()}</p>
                    <p className="flex items-center gap-2">
                      <span className="text-gold">Current status:</span>
                      <Badge variant="outline" className={applicationStatusBadgeClass(app.status)}>{applicationStatusLabel(app.status)}</Badge>
                    </p>
                  </div>

                  {app.candidateVisibleStatusNote ? (
                    <div className="rounded-lg border border-border bg-elevated p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-gold">Employer update</p>
                      <p className="mt-1 text-sm text-muted-foreground">{app.candidateVisibleStatusNote}</p>
                    </div>
                  ) : null}

                  {app.contactSharingConsent ? (
                    <p className="text-xs text-muted-foreground">You consented to share your account email with this employer for this application.</p>
                  ) : null}

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gold">Snapshot shared at submission</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      This is the immutable snapshot the employer received — later profile changes do not change it.
                    </p>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-border p-4">
                      <div className="grid gap-2.5">
                        {rows.map(row => (
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
                        {rows.length === 0 ? <p className="text-xs text-muted-foreground">No shared items recorded.</p> : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()
          ) : null}

          <DialogFooter>
            {detailCard ? (
              <Button
                variant="ghost"
                className="mr-auto text-muted-foreground hover:text-destructive"
                onClick={() => { const target = { id: detailCard.opportunity.id, title: detailCard.opportunity.title }; setDetailCard(null); setDetailData(null); setDetailFailed(null); setReportTarget(target); setCategory(''); setSubject(''); setDescription('') }}
              >
                <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden /> Report this listing
              </Button>
            ) : null}
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => { setDetailCard(null); setDetailData(null); setDetailFailed(null) }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safety report — private to BEAN administrators */}
      <Dialog open={!!reportTarget} onOpenChange={o => !o && !busy && setReportTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Report {reportTarget?.title}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Private to BEAN administrators. A report never auto-suspends a listing or organization — every action follows
              a recorded human investigation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="report-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="report-category" aria-label="Report category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {REPORT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="report-subject">Subject</Label>
              <Input id="report-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="report-desc">What happened?</Label>
              <Textarea id="report-desc" rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setReportTarget(null)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !category || subject.trim().length < 8 || description.trim().length < 30} onClick={() => void fileReport()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} File report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
