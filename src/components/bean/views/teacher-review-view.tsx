'use client'

// ─── BEAN Teach (Phase 4A): admin teacher application review ─────────────────
// ADMIN-only surface (server enforces the same rule; the UI check is only
// convenience). Pending / approved / rejected queues with search, full
// application detail, the append-only review history, approve (optional note)
// and reject (a written reason of 10–400 characters is REQUIRED so applicants
// can correct and resubmit). An admin can never review their own application
// (server-side guard). Rejection reasons are shown to the applicant; review
// history stays private.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ClipboardCheck, Search, CheckCircle2, XCircle, ShieldCheck, FileClock } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { AdminTeachApplicationDTO } from '@/lib/types'
import { TEACH_LEVEL_LABELS, applicationStatusBadgeClass, formatDay } from '@/components/bean/teach-format'

export function TeacherReviewView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  if (!authChecked) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent || authedStudent.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          icon={ClipboardCheck}
          title="Administrators only"
          description="Teacher application review is restricted to BEAN administrators. The server enforces this regardless of the interface."
          actionLabel={authedStudent ? 'Back to dashboard' : 'Sign in'}
          onAction={() => navigate(authedStudent ? { view: 'dashboard' } : { view: 'auth' })}
        />
      </div>
    )
  }
  return <ReviewPanel />
}

function ReviewPanel() {
  const navigate = useAppStore(s => s.navigate)
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ applications: AdminTeachApplicationDTO[]; total: number; pageSize: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminTeachApplicationDTO | null>(null)

  const load = useCallback(() => {
    setData(null)
    api.adminTeachApplications({ status, q: q || undefined, page })
      .then(res => { setData({ applications: res.applications, total: res.total, pageSize: res.pageSize }); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load applications.'))
  }, [status, q, page])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach · Admin</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Teacher Review</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Approve or reject teacher applications. Rejections need a written reason so the applicant can correct and resubmit. Every decision is recorded in an append-only history.
      </p>
      {/* Phase 6: Trust Center — complaints, review moderation, trust actions, appeals. */}
      <Button
        size="sm"
        variant="outline"
        className="mt-4 border-gold/40 text-gold hover:bg-gold/10"
        onClick={() => navigate({ view: 'admin-trust' })}
      >
        <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden />Open Trust Center
      </Button>

      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Search by applicant email, name or teaching name" className="pl-9" aria-label="Search applications" />
        </div>
      </div>

      <Tabs value={status} onValueChange={v => { setStatus(v as typeof status); setPage(1) }} className="mt-4">
        <TabsList className="bg-elevated">
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          <TabsTrigger value="ALL">All</TabsTrigger>
        </TabsList>
        <TabsContent value={status} className="mt-4">
          {data === null && !failed ? (
            <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading applications"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
          ) : failed ? (
            <EmptyState icon={ClipboardCheck} title="Could not load applications" description={failed} actionLabel="Try again" onAction={load} />
          ) : !data || data.applications.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title={q ? 'No applications match your search' : 'Queue is clear'} description={q ? 'Try a different search.' : 'No teacher applications in this state right now.'} />
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {data.applications.map(a => (
                  <ApplicationRow key={a.id} app={a} onOpen={() => setSelected(a)} />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <ReviewDialog app={selected} onClose={() => setSelected(null)} onReviewed={() => { setSelected(null); load() }} />
    </div>
  )
}

function ApplicationRow({ app, onOpen }: { app: AdminTeachApplicationDTO; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-gold/40 sm:flex-row sm:items-center sm:justify-between"
      aria-label={`Open application by ${app.teachingName}`}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {app.teachingName}
          <Badge variant="outline" className={applicationStatusBadgeClass(app.verificationStatus)}>{app.verificationStatus}</Badge>
          {app.isPublished && <Badge variant="outline" className="border-success/40 text-success">public</Badge>}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {app.headline} · applicant {app.applicant.displayName || app.applicant.email} ({app.applicant.email}) · applied {formatDay(app.createdAt)}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {app.subjects.slice(0, 4).map(s => <Badge key={s} variant="outline" className="border-gold/40 text-gold">{s}</Badge>)}
          <Badge variant="outline" className="border-border text-muted-foreground">{app.experienceYears} yr{app.experienceYears === 1 ? '' : 's'} exp</Badge>
        </p>
      </div>
      <span className="shrink-0 text-xs text-gold">Review →</span>
    </button>
  )
}

function ReviewDialog({ app, onClose, onReviewed }: { app: AdminTeachApplicationDTO | null; onClose: () => void; onReviewed: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNote('')
    setError(null)
  }, [app?.id])

  if (!app) return null

  const review = async (action: 'APPROVE' | 'REJECT') => {
    setBusy(true)
    setError(null)
    try {
      await api.adminTeachReview(app.id, { action, note: note.trim() || undefined })
      toast({ title: action === 'APPROVE' ? 'Teacher approved — profile is now public' : 'Application rejected — the applicant can correct and resubmit' })
      onReviewed()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the review.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-foreground">
            {app.teachingName}
            <Badge variant="outline" className={applicationStatusBadgeClass(app.verificationStatus)}>{app.verificationStatus}</Badge>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Applicant {app.applicant.displayName || app.applicant.email} ({app.applicant.email}) · learning level {app.applicant.learningLevel ?? 'unknown'} · applied {formatDay(app.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          <div className="grid gap-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Headline</p>
            <p className="text-foreground">{app.headline}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Biography</p>
            <p className="whitespace-pre-wrap text-foreground">{app.bio}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Subjects</p>
              <p className="mt-1 flex flex-wrap gap-1">{app.subjects.map(s => <Badge key={s} variant="outline" className="border-gold/40 text-gold">{s}</Badge>)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Levels</p>
              <p className="mt-1 flex flex-wrap gap-1">{app.levels.map(l => <Badge key={l} variant="outline" className="border-border text-muted-foreground">{TEACH_LEVEL_LABELS[l] ?? l}</Badge>)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Languages</p>
              <p className="mt-1 flex flex-wrap gap-1">{app.languages.map(l => <Badge key={l} variant="outline" className="border-border text-muted-foreground">{l}</Badge>)}</p>
            </div>
          </div>
          <div className="grid gap-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Qualifications ({app.experienceYears} yr{app.experienceYears === 1 ? '' : 's'} experience)</p>
            <p className="whitespace-pre-wrap text-foreground">{app.qualificationsText}</p>
          </div>
          {app.portfolioUrl && (
            <div className="grid gap-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Portfolio</p>
              <a href={app.portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">{app.portfolioUrl}</a>
            </div>
          )}
          {app.reviewNote && (
            <div className="grid gap-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Latest decision note</p>
              <blockquote className="rounded-lg border border-border bg-elevated px-3 py-2 text-muted-foreground">“{app.reviewNote}”</blockquote>
            </div>
          )}

          {/* Append-only review history */}
          <div className="grid gap-1">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"><FileClock className="h-3.5 w-3.5" aria-hidden /> Review history (append-only)</p>
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-elevated p-3">
              {app.history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events recorded yet.</p>
              ) : (
                app.history.map(h => (
                  <div key={h.id} className="flex items-start justify-between gap-3 text-xs">
                    <span className="text-foreground"><span className="font-medium">{h.action}</span>{h.detail ? ` — ${h.detail}` : ''} <span className="text-muted-foreground">by {h.actorRole}</span></span>
                    <span className="shrink-0 text-muted-foreground">{formatDay(h.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {app.verificationStatus !== 'APPROVED' && (
            <div className="grid gap-1.5">
              <Label htmlFor="review-note">Decision note (required for rejection, 10–400 characters)</Label>
              <Textarea id="review-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={400} placeholder="Shown to the applicant on rejection; recorded in the audit trail on approval" />
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter className="flex flex-wrap gap-2">
          {app.verificationStatus !== 'APPROVED' && (
            <>
              <Button variant="outline" className="border-success/40 text-success hover:bg-success/10" disabled={busy} onClick={() => void review('APPROVE')}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Approve
              </Button>
              <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busy || note.trim().length < 10} onClick={() => void review('REJECT')}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />} Reject
              </Button>
            </>
          )}
          {app.verificationStatus === 'APPROVED' && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Approved teachers appear in the public marketplace.</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
