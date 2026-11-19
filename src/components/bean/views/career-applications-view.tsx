'use client'

// ─── Phase 7 — My applications (#/career/applications) ───────────────────────
// Two tabs:
//   • Applications — the student's own tracker: status with the employer's
//     candidate-visible note, withdrawal, and the safety-report entry point.
//     employerNotes are never present in these DTOs (server-enforced privacy).
//   • Reports — the student's own filed safety reports. The DTO
//     (OwnSafetyReportDTO in src/lib/types.ts) exposes ONLY: subject, category,
//     targetType, targetId, status, createdAt and resolutionVisible (a fixed
//     completion message when RESOLVED/DISMISSED). Internal case notes and
//     resolutionNote are admin-only and are never shown here — nothing is
//     invented beyond those fields.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import type { MyApplicationsResponse, OwnApplicationClientDTO, OwnSafetyReportDTO } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { FileWarning, Inbox, Loader2, ShieldAlert } from 'lucide-react'

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  SHORTLISTED: 'border-success/40 bg-success/10 text-success',
  INTERVIEW: 'border-success/40 bg-success/10 text-success',
  SELECTED: 'border-success/40 bg-success/10 text-success',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  WITHDRAWN: 'border-border bg-elevated text-muted-foreground',
}

const REPORT_STATUS_BADGE: Record<string, string> = {
  OPEN: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  RESOLVED: 'border-success/40 bg-success/10 text-success',
  DISMISSED: 'border-border bg-elevated text-muted-foreground',
}

const REPORT_CATEGORIES = ['FRAUDULENT_LISTING', 'MISLEADING_DESCRIPTION', 'ORGANIZATION_CONDUCT', 'HARASSMENT', 'DISCRIMINATION', 'SAFEGUARDING', 'OTHER']

export function CareerApplicationsView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [data, setData] = useState<MyApplicationsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [reports, setReports] = useState<OwnSafetyReportDTO[] | null>(null)
  const [reportsFailed, setReportsFailed] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reportFor, setReportFor] = useState<OwnApplicationClientDTO | null>(null)
  const [category, setCategory] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setData(null)
    setReports(null)
    setFailed(null)
    setReportsFailed(null)
    // Applications are the primary surface; reports failing is shown honestly
    // inside the Reports tab without hiding the tracker.
    Promise.allSettled([api.myApplications(), api.myCareerReports()])
      .then(([apps, reps]) => {
        if (apps.status === 'fulfilled') {
          setData(apps.value)
          setFailed(null)
        } else {
          setFailed(apps.reason instanceof Error ? apps.reason.message : 'Could not load your applications.')
        }
        if (reps.status === 'fulfilled') {
          setReports(reps.value.reports)
          setReportsFailed(null)
        } else {
          setReportsFailed(reps.reason instanceof Error ? reps.reason.message : 'Could not load your reports.')
        }
      })
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  const withdraw = async (a: OwnApplicationClientDTO) => {
    setBusyId(a.id)
    try {
      await api.withdrawApplication(a.id)
      toast({ title: 'Application withdrawn' })
      load()
    } catch (e) {
      toast({ title: 'Could not withdraw', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const fileReport = async () => {
    if (!reportFor) return
    setBusy(true)
    try {
      await api.fileCareerReport({
        targetType: 'OPPORTUNITY',
        targetId: reportFor.opportunity.id,
        category: category || 'OTHER',
        subject: subject.trim(),
        description: description.trim(),
      })
      toast({ title: 'Report filed privately — BEAN administrators will investigate. Nothing is auto-suspended.' })
      setReportFor(null); setCategory(''); setSubject(''); setDescription('')
      load()
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

      {failed && !data ? (
        <div className="mt-8"><EmptyState icon={Inbox} title="Could not load applications" description={failed} actionLabel="Try again" onAction={load} /></div>
      ) : !data ? (
        <div className="mt-8 flex min-h-[30vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : (
        <Tabs defaultValue="applications" className="mt-6">
          <TabsList className="bg-elevated" aria-label="Application sections">
            <TabsTrigger value="applications">Applications</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          {/* ── Applications tab (existing tracker, unchanged flow) ── */}
          <TabsContent value="applications" className="mt-4">
            {data.applications.length === 0 ? (
              <EmptyState icon={Inbox} title="No applications yet" description="Browse moderated opportunities from verified employers." actionLabel="Browse opportunities" onAction={() => navigate({ view: 'career-opportunities' })} />
            ) : (
              <ul className="space-y-3">
                {data.applications.map(a => (
                  <li key={a.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <button type="button" className="font-display text-base font-semibold text-foreground hover:text-gold" onClick={() => navigate({ view: 'career-opportunity', opportunityId: a.opportunity.id })}>
                          {a.opportunity.title}
                        </button>
                        <p className="mt-0.5 text-xs text-muted-foreground">{a.opportunity.organizationName} · {a.opportunity.opportunityType.toLowerCase()} · applied {new Date(a.submittedAt).toLocaleDateString()}</p>
                      </div>
                      <Badge variant="outline" className={STATUS_BADGE[a.status] ?? 'border-border text-muted-foreground'}>{a.status.replace('_', ' ').toLowerCase()}</Badge>
                    </div>
                    {a.candidateVisibleStatusNote ? (
                      <p className="mt-2 rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">Note from employer: {a.candidateVisibleStatusNote}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW'].includes(a.status) ? (
                        <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busyId === a.id} onClick={() => void withdraw(a)}>
                          Withdraw
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setReportFor(a)}>
                        <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden /> Report this listing
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* ── Reports tab: only fields OwnSafetyReportDTO actually exposes ── */}
          <TabsContent value="reports" className="mt-4">
            {reportsFailed ? (
              <EmptyState icon={FileWarning} title="Could not load your reports" description={reportsFailed} actionLabel="Try again" onAction={load} />
            ) : !reports ? (
              <div className="flex min-h-[20vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
            ) : reports.length === 0 ? (
              <EmptyState
                icon={FileWarning}
                title="No reports filed"
                description="If a listing or organization misbehaves, you can report it privately from any application — reports never auto-suspend anything; BEAN administrators investigate each one."
              />
            ) : (
              <ul className="space-y-3">
                {reports.map(r => (
                  <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold text-foreground">{r.subject}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.category.replace(/_/g, ' ').toLowerCase()} · {r.targetType.toLowerCase()} · filed {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="outline" className={REPORT_STATUS_BADGE[r.status] ?? 'border-border text-muted-foreground'}>{r.status.replace('_', ' ').toLowerCase()}</Badge>
                    </div>
                    {r.resolutionVisible ? (
                      <p className="mt-2 rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">Outcome: {r.resolutionVisible}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              BEAN shares only the status and, when a review is complete, a brief outcome message. Internal case notes
              and details stay confidential — they are never part of the reporter-facing record.
            </p>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!reportFor} onOpenChange={o => !o && !busy && setReportFor(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Report {reportFor?.opportunity.title}</DialogTitle>
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
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setReportFor(null)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !category || subject.trim().length < 8 || description.trim().length < 30} onClick={fileReport}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} File report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
