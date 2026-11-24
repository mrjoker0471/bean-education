'use client'

// ─── BEAN Teach (Phase 6): ADMIN Trust Center ────────────────────────────────
// ADMIN-only moderation surface (the server enforces the same rule; the UI
// check is convenience only). Five tabs: overview counters, review moderation
// (flagged/hidden queues with documented reasons), complaint investigation
// (filters, full notes, status workflow), teacher trust actions (NOTICE through
// EMERGENCY_STOP, plus reinstatement) and appeal adjudication (assign → decide,
// reviewer must differ from the original decision maker). Every mutation needs
// a documented reason, lands in the append-only case history and refetches the
// affected list. Filing a complaint never applies restrictions automatically.

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, FileClock, Flag, GraduationCap, Loader2, Scale, Search, ShieldAlert, Star } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { AdminCiReviewPanel } from '@/components/bean/admin/ci-review-panel'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  AdminAppealDTO,
  AdminComplaintDTO,
  AdminReviewModerationItem,
  AdminTrustOverviewResponse,
  AdminTrustTeacherRow,
  ComplaintEventDTO,
} from '@/lib/types'
import { applicationStatusBadgeClass } from '@/components/bean/teach-format'

const COMPLAINT_CATEGORY_LABELS: Record<string, string> = {
  TEACHING_QUALITY: 'Teaching quality',
  MISLEADING_CLASS_DESCRIPTION: 'Misleading class description',
  TEACHER_CONDUCT: 'Teacher conduct',
  STUDENT_CONDUCT: 'Student conduct',
  SAFEGUARDING: 'Safeguarding',
  HARASSMENT: 'Harassment or threats',
  DISCRIMINATION: 'Discrimination',
  CLASS_CANCELLATION: 'Class cancellation',
  TECHNICAL_PROBLEM: 'Technical problem',
  ATTENDANCE_DISPUTE: 'Attendance dispute',
  OTHER: 'Other',
}

const COMPLAINT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'WAITING_FOR_INFORMATION', 'RESOLVED', 'DISMISSED']
const SEVERITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL']

const APPEAL_TARGET_LABELS: Record<string, string> = {
  COMPLAINT_DECISION: 'Complaint decision',
  REVIEW_MODERATION: 'Review moderation',
  TRUST_ACTION: 'Trust restriction',
}

const TRUST_ACTION_OPTIONS = [
  { value: 'NOTICE', label: 'Notice', description: 'Record-only. Documents a concern; no effect on listings, publishing or live classrooms.' },
  { value: 'WARNING', label: 'Warning', description: 'Record-only escalation of a notice. Still no automatic enforcement.' },
  { value: 'PAUSE_LISTINGS', label: 'Pause listings', description: 'Hides the teacher listings and blocks new bookings until reinstated or expired.' },
  { value: 'SUSPEND_PUBLISHING', label: 'Suspend publishing', description: 'Blocks the teacher from publishing new classes until reinstated or expired.' },
  { value: 'EMERGENCY_STOP', label: 'Emergency stop', description: 'Blocks live classrooms immediately — a safeguarding measure with no expiry.' },
] as const

const TRUST_ACTION_LABELS: Record<string, string> = {
  NOTICE: 'Notice',
  WARNING: 'Warning',
  PAUSE_LISTINGS: 'Pause listings',
  SUSPEND_PUBLISHING: 'Suspend publishing',
  EMERGENCY_STOP: 'Emergency stop',
  REINSTATE: 'Reinstate',
}

type ComplaintAction = 'ACKNOWLEDGE' | 'START_REVIEW' | 'REQUEST_INFO' | 'NOTE' | 'ESCALATE' | 'RESOLVE' | 'DISMISS'

const COMPLAINT_ACTION_META: Record<ComplaintAction, { label: string; blurb: string; noteRequired: boolean }> = {
  ACKNOWLEDGE: { label: 'Acknowledge', blurb: 'Marks the case as acknowledged so the complainant can see it is being handled.', noteRequired: false },
  START_REVIEW: { label: 'Start review', blurb: 'Marks the case UNDER_REVIEW. Investigate with notes — the case history is append-only.', noteRequired: false },
  REQUEST_INFO: { label: 'Request information', blurb: 'Sets the case to WAITING_FOR_INFORMATION. Your note tells the complainant what detail to add.', noteRequired: true },
  NOTE: { label: 'Add note', blurb: 'Appends an internal note to the case history. Notes are never shown to the other party.', noteRequired: true },
  ESCALATE: { label: 'Escalate', blurb: 'Raises the severity to CRITICAL for prioritised handling.', noteRequired: false },
  RESOLVE: { label: 'Resolve', blurb: 'Closes the case as RESOLVED. Your reason is recorded in the case history.', noteRequired: true },
  DISMISS: { label: 'Dismiss', blurb: 'Closes the case as DISMISSED. Your reason is recorded in the case history.', noteRequired: true },
}

type ReviewFilter = 'flagged' | 'hidden' | 'published' | 'all'
type ReviewModerationAction = 'KEEP_PUBLISHED' | 'HIDE' | 'RESTORE'

const REVIEW_ACTION_META: Record<ReviewModerationAction, { title: string; blurb: string }> = {
  KEEP_PUBLISHED: { title: 'Keep this review published?', blurb: 'The flag is cleared and the review stays publicly visible with a documented reason.' },
  HIDE: { title: 'Hide this review?', blurb: 'The review disappears from the public class page. The author keeps the right to appeal this decision.' },
  RESTORE: { title: 'Restore this review?', blurb: 'The review returns to the public class page with a documented reason.' },
}

function labelFromEnum(value: string): string {
  return value.replace(/_/g, ' ')
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function complaintStatusBadgeClass(status: string): string {
  switch (status) {
    case 'OPEN':
    case 'ACKNOWLEDGED':
    case 'UNDER_REVIEW':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'WAITING_FOR_INFORMATION':
      return 'border-border bg-elevated text-muted-foreground'
    case 'RESOLVED':
      return 'border-success/40 bg-success/10 text-success'
    case 'DISMISSED':
      return 'border-border bg-elevated text-muted-foreground'
    default:
      return 'border-border text-muted-foreground'
  }
}

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'LOW':
    case 'NORMAL':
      return 'border-border text-muted-foreground'
    case 'HIGH':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'CRITICAL':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    default:
      return 'border-border text-muted-foreground'
  }
}

function reviewStatusBadgeClass(status: string): string {
  switch (status) {
    case 'PUBLISHED':
      return 'border-success/40 bg-success/10 text-success'
    case 'FLAGGED':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'HIDDEN':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    default:
      return 'border-border text-muted-foreground'
  }
}

function appealStatusBadgeClass(status: string): string {
  switch (status) {
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'OVERTURNED':
      return 'border-success/40 bg-success/10 text-success'
    default:
      return 'border-border bg-elevated text-muted-foreground'
  }
}

export function AdminTrustView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  if (!authChecked) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (authedStudent?.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          icon={ShieldAlert}
          title="Administrator access required"
          description="The Trust Center is restricted to authorised BEAN administrators. The server enforces this regardless of the interface."
          actionLabel={authedStudent ? 'Back to dashboard' : 'Sign in'}
          onAction={() => navigate(authedStudent ? { view: 'dashboard' } : { view: 'auth' })}
        />
      </div>
    )
  }
  return <TrustCenter />
}

function TrustCenter() {
  const navigate = useAppStore(s => s.navigate)
  const [tab, setTab] = useState('overview')

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'teach-review' })}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Teacher Review
      </Button>

      <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach · Admin</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Trust Center</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Complaints, review moderation, teacher trust actions and appeals in one place. Every action needs a documented reason and lands in an append-only case history — nothing happens automatically from a report alone.
      </p>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        {/* h-auto + flex-wrap keeps the five triggers reachable on narrow phones. */}
        <TabsList className="h-auto flex-wrap bg-elevated">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="complaints">Complaints</TabsTrigger>
          <TabsTrigger value="teachers">Teachers</TabsTrigger>
          <TabsTrigger value="appeals">Appeals</TabsTrigger>
          <TabsTrigger value="classroom-intelligence">Classroom Intelligence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><OverviewPanel /></TabsContent>
        <TabsContent value="reviews" className="mt-4"><ReviewsPanel /></TabsContent>
        <TabsContent value="complaints" className="mt-4"><ComplaintsPanel /></TabsContent>
        <TabsContent value="teachers" className="mt-4"><TeachersPanel /></TabsContent>
        <TabsContent value="appeals" className="mt-4"><AppealsPanel /></TabsContent>
        <TabsContent value="classroom-intelligence" className="mt-4"><AdminCiReviewPanel /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewPanel() {
  const [data, setData] = useState<AdminTrustOverviewResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.adminTrustOverview()
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load the overview.'))
  }, [])

  useEffect(() => { load() }, [load])

  if (data === null && !failed) {
    return <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading overview"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (failed) {
    return <EmptyState icon={ShieldAlert} title="Could not load the overview" description={failed} actionLabel="Try again" onAction={load} />
  }
  if (!data) return null

  const stats: { label: string; value: number; destructive?: boolean }[] = [
    { label: 'New complaints', value: data.newComplaints },
    { label: 'Open investigations', value: data.openInvestigations },
    { label: 'Safeguarding open', value: data.sensitiveOpen, destructive: data.sensitiveOpen > 0 },
    { label: 'Flagged reviews', value: data.flaggedReviews },
    { label: 'Hidden reviews', value: data.hiddenReviews },
    { label: 'Pending appeals', value: data.pendingAppeals },
    { label: 'Active restrictions', value: data.activeRestrictions },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {stats.map(s => (
        <div key={s.label} className={`rounded-xl border border-border bg-card p-5${s.destructive ? ' border-destructive/40' : ''}`}>
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className={`mt-1.5 font-display text-2xl ${s.destructive ? 'text-destructive' : 'text-foreground'}`}>{s.value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Reviews (moderation) ────────────────────────────────────────────────────

function ReviewsPanel() {
  const [filter, setFilter] = useState<ReviewFilter>('flagged')
  const [reviews, setReviews] = useState<AdminReviewModerationItem[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.adminTrustReviews(filter)
      .then(res => { setReviews(res.reviews); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load reviews.'))
  }, [filter])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="max-w-xs">
          <Select value={filter} onValueChange={v => setFilter(v as ReviewFilter)}>
            <SelectTrigger aria-label="Filter reviews by state"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="hidden">Hidden</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {reviews === null && !failed ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading reviews"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : failed ? (
        <EmptyState icon={Flag} title="Could not load reviews" description={failed} actionLabel="Try again" onAction={load} />
      ) : !reviews || reviews.length === 0 ? (
        <EmptyState icon={Flag} title="No reviews in this state" description="No reviews match the current filter — the moderation queue is clear." />
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map(r => <ReviewModCard key={r.id} review={r} onModerated={load} />)}
        </div>
      )}
    </div>
  )
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-4 w-4 ${i <= rating ? 'fill-gold text-gold' : 'text-muted-foreground/40'}`} aria-hidden />
      ))}
      <span className="ml-1.5 text-xs font-medium text-gold">{rating}/5</span>
    </span>
  )
}

function ReviewModCard({ review, onModerated }: { review: AdminReviewModerationItem; onModerated: () => void }) {
  const [reason, setReason] = useState('')
  const [pendingAction, setPendingAction] = useState<ReviewModerationAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Documented reasons are mandatory; hiding or restoring needs a substantive
  // one (10+ characters). Keeping a flagged review published still needs a note.
  const canKeep = reason.trim().length >= 1
  const canHideOrRestore = reason.trim().length >= 10

  const openAction = (action: ReviewModerationAction) => {
    setError(null)
    setPendingAction(action)
  }

  const confirmAction = async () => {
    if (!pendingAction) return
    setBusy(true)
    setError(null)
    try {
      await api.adminModerateReview(review.id, { action: pendingAction, reason: reason.trim() })
      toast({ title: pendingAction === 'HIDE' ? 'Review hidden' : pendingAction === 'RESTORE' ? 'Review restored' : 'Review kept published' })
      setPendingAction(null)
      onModerated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the moderation decision.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RatingStars rating={review.rating} />
        <Badge variant="outline" className={reviewStatusBadgeClass(review.status)}>{labelFromEnum(review.status)}</Badge>
      </div>

      {review.title && <h3 className="mt-3 font-display text-base font-semibold text-foreground">{review.title}</h3>}
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{review.reviewText}</p>

      <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <div>Reviewer: {review.reviewer.displayName || review.reviewer.email} ({review.reviewer.email})</div>
        {review.classSession && <div>Class: {review.classSession.title}</div>}
        {review.teacher && <div>Teacher: {review.teacher.teachingName}</div>}
        <div>
          Posted {formatDateTime(review.createdAt)}
          {review.moderatedAt ? ` · moderated ${formatDateTime(review.moderatedAt)}` : ''}
        </div>
      </dl>

      {review.moderationReason && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Moderation reason: {review.moderationReason}
        </p>
      )}
      {review.response && (
        <blockquote className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted-foreground">
          Teacher response: “{review.response.responseText}”
        </blockquote>
      )}

      {(review.status === 'FLAGGED' || review.status === 'HIDDEN') && (
        <div className="mt-4 grid gap-2">
          <Label htmlFor={`moderation-reason-${review.id}`} className="text-xs text-muted-foreground">
            Moderation reason (required — recorded in the audit trail)
          </Label>
          <Input
            id={`moderation-reason-${review.id}`}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Documented reason for this decision"
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {review.status === 'FLAGGED' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] border-success/40 text-success hover:bg-success/10"
                  disabled={busy || !canKeep}
                  onClick={() => openAction('KEEP_PUBLISHED')}
                >
                  Keep published
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={busy || !canHideOrRestore}
                  onClick={() => openAction('HIDE')}
                >
                  Hide
                </Button>
              </>
            )}
            {review.status === 'HIDDEN' && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] border-gold/40 text-gold hover:bg-gold/10"
                disabled={busy || !canHideOrRestore}
                onClick={() => openAction('RESTORE')}
              >
                Restore
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={!!pendingAction} onOpenChange={open => { if (!open && !busy) setPendingAction(null) }}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{pendingAction && REVIEW_ACTION_META[pendingAction].title}</DialogTitle>
            <DialogDescription className="text-muted-foreground">{pendingAction && REVIEW_ACTION_META[pendingAction].blurb}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Documented reason</p>
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-muted-foreground">{reason.trim()}</p>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-border bg-transparent text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button
              className={pendingAction === 'HIDE' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              disabled={busy}
              onClick={() => void confirmAction()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

// ─── Complaints (investigation) ──────────────────────────────────────────────

interface ComplaintFilters {
  status: string
  category: string
  severity: string
  q: string
  sensitive: boolean
}

function ComplaintsPanel() {
  const [filters, setFilters] = useState<ComplaintFilters>({ status: 'all', category: 'all', severity: 'all', q: '', sensitive: false })
  const [complaints, setComplaints] = useState<AdminComplaintDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.adminTrustComplaints({
      status: filters.status === 'all' ? undefined : filters.status,
      category: filters.category === 'all' ? undefined : filters.category,
      severity: filters.severity === 'all' ? undefined : filters.severity,
      q: filters.q || undefined,
      sensitive: filters.sensitive || undefined,
    })
      .then(res => { setComplaints(res.complaints); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load complaints.'))
  }, [filters])

  // Debounced — the free-text search keeps request sizes bounded.
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Search subject, description or complainant"
              className="pl-9"
              aria-label="Search complaints"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {COMPLAINT_STATUSES.map(s => <SelectItem key={s} value={s}>{labelFromEnum(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.category} onValueChange={v => setFilters(f => ({ ...f, category: v }))}>
              <SelectTrigger className="w-[200px]" aria-label="Filter by category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {Object.entries(COMPLAINT_CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.severity} onValueChange={v => setFilters(f => ({ ...f, severity: v }))}>
              <SelectTrigger className="w-[140px]" aria-label="Filter by severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id="trust-sensitive-only"
                checked={filters.sensitive}
                onCheckedChange={v => setFilters(f => ({ ...f, sensitive: v }))}
                aria-label="Sensitive cases only"
              />
              <Label htmlFor="trust-sensitive-only" className="text-xs text-muted-foreground">Sensitive only</Label>
            </div>
          </div>
        </div>
      </div>

      {complaints === null && !failed ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading complaints"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : failed ? (
        <EmptyState icon={ShieldAlert} title="Could not load complaints" description={failed} actionLabel="Try again" onAction={load} />
      ) : !complaints || complaints.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No complaints match" description="No complaint cases match the current filters — try widening them." />
      ) : (
        <div className="flex flex-col gap-4">
          {complaints.map(c => <AdminComplaintCard key={c.id} complaint={c} onChanged={load} />)}
        </div>
      )}
    </div>
  )
}

function AdminComplaintCard({ complaint, onChanged }: { complaint: AdminComplaintDTO; onChanged: () => void }) {
  const [action, setAction] = useState<ComplaintAction | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decided = complaint.status === 'RESOLVED' || complaint.status === 'DISMISSED'

  const openAction = (a: ComplaintAction) => {
    setNote('')
    setError(null)
    setAction(a)
  }

  const confirmAction = async () => {
    if (!action) return
    setBusy(true)
    setError(null)
    try {
      await api.adminComplaintAction(complaint.id, { action, note: note.trim() || undefined })
      toast({ title: `${COMPLAINT_ACTION_META[action].label} recorded` })
      setAction(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the action.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-gold/40 text-gold">{COMPLAINT_CATEGORY_LABELS[complaint.category] ?? complaint.category}</Badge>
        {complaint.isSensitive && (
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Restricted</Badge>
        )}
        <Badge variant="outline" className={severityBadgeClass(complaint.severity)}>{complaint.severity}</Badge>
        <Badge variant="outline" className={complaintStatusBadgeClass(complaint.status)}>{labelFromEnum(complaint.status)}</Badge>
      </div>

      <h3 className="mt-3 font-display text-base font-semibold text-foreground">{complaint.subject}</h3>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{complaint.description}</p>

      <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <div>Complainant: {complaint.complainant.displayName || complaint.complainant.email} ({complaint.complainant.email})</div>
        {complaint.classTitle && <div>Class: {complaint.classTitle}</div>}
        <div>Assigned admin: {complaint.assignedAdminId ?? '—'}</div>
        <div>
          Filed {formatDateTime(complaint.createdAt)}
          {complaint.resolvedAt ? ` · decided ${formatDateTime(complaint.resolvedAt)}` : ''}
        </div>
      </dl>

      {/* Admin view shows the full internal notes (detailFull). */}
      <AdminEventTimeline events={complaint.events} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="min-h-[44px] border-border text-muted-foreground hover:bg-elevated" onClick={() => openAction('ACKNOWLEDGE')}>Acknowledge</Button>
        <Button size="sm" variant="outline" className="min-h-[44px] border-border text-muted-foreground hover:bg-elevated" onClick={() => openAction('START_REVIEW')}>Start review</Button>
        <Button size="sm" variant="outline" className="min-h-[44px] border-border text-muted-foreground hover:bg-elevated" onClick={() => openAction('REQUEST_INFO')}>Request info</Button>
        <Button size="sm" variant="outline" className="min-h-[44px] border-border text-muted-foreground hover:bg-elevated" onClick={() => openAction('NOTE')}>Add note</Button>
        {!decided && (
          <>
            <Button size="sm" variant="outline" className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => openAction('ESCALATE')}>Escalate</Button>
            <Button size="sm" variant="outline" className="min-h-[44px] border-success/40 text-success hover:bg-success/10" onClick={() => openAction('RESOLVE')}>Resolve</Button>
            <Button size="sm" variant="outline" className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => openAction('DISMISS')}>Dismiss</Button>
          </>
        )}
      </div>

      <Dialog open={!!action} onOpenChange={open => { if (!open && !busy) { setAction(null); setError(null) } }}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{action && COMPLAINT_ACTION_META[action].label}</DialogTitle>
            <DialogDescription className="text-muted-foreground">{action && COMPLAINT_ACTION_META[action].blurb}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <Label htmlFor={`complaint-note-${complaint.id}`}>
              {action !== null && COMPLAINT_ACTION_META[action].noteRequired ? 'Note (required)' : 'Note (optional)'}
            </Label>
            <Textarea
              id={`complaint-note-${complaint.id}`}
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              disabled={busy}
              placeholder="Appended to the append-only case history"
            />
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-border bg-transparent text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => { setAction(null); setError(null) }}>
              Cancel
            </Button>
            <Button
              className={action === 'RESOLVE' ? 'bg-gold text-primary-foreground hover:bg-gold-hover' : 'bg-destructive text-white hover:bg-destructive/90'}
              disabled={busy || (action !== null && COMPLAINT_ACTION_META[action].noteRequired && note.trim().length === 0)}
              onClick={() => void confirmAction()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

// ─── Teachers (trust actions) ────────────────────────────────────────────────

function TeachersPanel() {
  const [q, setQ] = useState('')
  const [teachers, setTeachers] = useState<AdminTrustTeacherRow[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.adminTrustTeachers(q || undefined)
      .then(res => { setTeachers(res.teachers); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load teachers.'))
  }, [q])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by teaching name" className="pl-9" aria-label="Search teachers" />
        </div>
      </div>

      {teachers === null && !failed ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading teachers"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : failed ? (
        <EmptyState icon={GraduationCap} title="Could not load teachers" description={failed} actionLabel="Try again" onAction={load} />
      ) : !teachers || teachers.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No teachers match" description="No teacher profiles match this search." />
      ) : (
        <div className="flex flex-col gap-4">
          {teachers.map(t => <TeacherTrustCard key={t.teacherProfileId} teacher={t} onChanged={load} />)}
        </div>
      )}
    </div>
  )
}

function TeacherTrustCard({ teacher, onChanged }: { teacher: AdminTrustTeacherRow; onChanged: () => void }) {
  const [dialogMode, setDialogMode] = useState<'issue' | 'reinstate' | null>(null)

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            {teacher.teachingName}
            <Badge variant="outline" className={applicationStatusBadgeClass(teacher.verificationStatus)}>{teacher.verificationStatus}</Badge>
            {teacher.isPublished && <Badge variant="outline" className="border-success/40 bg-success/10 text-success">published</Badge>}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {teacher.reviewCount} review{teacher.reviewCount === 1 ? '' : 's'} · average rating {teacher.averageRating === null ? '—' : teacher.averageRating.toFixed(1)} · {teacher.openComplaints} open / {teacher.totalComplaints} total complaints
          </p>
          {teacher.activeRestrictions.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {teacher.activeRestrictions.map(a => (
                <Badge key={a} variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                  {TRUST_ACTION_LABELS[a] ?? a}
                </Badge>
              ))}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" className="min-h-[44px] border-gold/40 text-gold hover:bg-gold/10" onClick={() => setDialogMode('issue')}>
            Trust action
          </Button>
          {teacher.activeRestrictions.length > 0 && (
            <Button variant="outline" className="min-h-[44px] border-success/40 text-success hover:bg-success/10" onClick={() => setDialogMode('reinstate')}>
              Reinstate
            </Button>
          )}
        </div>
      </div>

      <TrustActionDialog
        teacher={teacher}
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onDone={() => { setDialogMode(null); onChanged() }}
      />
    </article>
  )
}

function TrustActionDialog({
  teacher,
  mode,
  onClose,
  onDone,
}: {
  teacher: AdminTrustTeacherRow
  mode: 'issue' | 'reinstate' | null
  onClose: () => void
  onDone: () => void
}) {
  const [action, setAction] = useState<string>('NOTICE')
  const [reason, setReason] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode) {
      setAction('NOTICE')
      setReason('')
      setEndsAt('')
      setError(null)
    }
  }, [mode, teacher.teacherProfileId])

  if (!mode) return null

  // Only PAUSE_LISTINGS / SUSPEND_PUBLISHING accept an expiry; EMERGENCY_STOP
  // is indefinite and NOTICE/WARNING are record-only.
  const temporary = mode === 'issue' && (action === 'PAUSE_LISTINGS' || action === 'SUSPEND_PUBLISHING')
  const reasonValid = mode === 'reinstate' ? reason.trim().length >= 10 : reason.trim().length >= 20
  const endsAtIso =
    temporary && endsAt && !Number.isNaN(new Date(endsAt).getTime())
      ? new Date(endsAt).toISOString()
      : undefined

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const body =
        mode === 'reinstate'
          ? { action: 'REINSTATE', reason: reason.trim() }
          : { action, reason: reason.trim(), ...(endsAtIso ? { endsAt: endsAtIso } : {}) }
      await api.adminTrustAction(teacher.teacherProfileId, body)
      toast({ title: mode === 'reinstate' ? 'Teacher reinstated' : 'Trust action recorded' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the trust action.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">
            {mode === 'reinstate' ? `Reinstate ${teacher.teachingName}` : `Issue trust action — ${teacher.teachingName}`}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {mode === 'reinstate'
              ? 'Removes the active restrictions so the teacher can publish and teach again. The reinstatement and its reason are recorded in the audit trail.'
              : 'Choose an enforcement action and document the reason. Filing a complaint never applies restrictions automatically — every restriction is a deliberate administrator decision.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          {mode === 'issue' && (
            <div className="grid gap-1.5">
              <Label htmlFor="trust-action-select">Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="trust-action-select" aria-label="Trust action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRUST_ACTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{TRUST_ACTION_OPTIONS.find(o => o.value === action)?.description}</p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="trust-action-reason">Reason (required, at least {mode === 'reinstate' ? '10' : '20'} characters)</Label>
            <Textarea
              id="trust-action-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              maxLength={600}
              disabled={busy}
              placeholder="Documented reason — recorded in the append-only audit trail"
            />
          </div>

          {temporary && (
            <div className="grid gap-1.5">
              <Label htmlFor="trust-action-ends">Ends at (optional)</Label>
              <Input
                id="trust-action-ends"
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                disabled={busy}
                className="[color-scheme:dark]"
                aria-label="Restriction end date and time"
              />
              <p className="text-xs text-muted-foreground">Temporary restrictions lift automatically at this time. Leave empty for an indefinite restriction (reinstatable manually).</p>
            </div>
          )}

          {mode === 'issue' && (
            <div className="rounded-lg border border-border bg-elevated p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What each action does</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {TRUST_ACTION_OPTIONS.map(o => (
                  <li key={o.value}><span className="text-foreground">{o.label}</span> — {o.description}</li>
                ))}
              </ul>
              <p className="mt-2">Notice and warning record concerns only. Filing a complaint never applies restrictions automatically.</p>
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border bg-transparent text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className={mode === 'reinstate' ? 'bg-gold text-primary-foreground hover:bg-gold-hover' : 'bg-destructive text-white hover:bg-destructive/90'}
            disabled={busy || !reasonValid}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === 'reinstate' ? 'Reinstate teacher' : 'Issue action'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Appeals (adjudication) ──────────────────────────────────────────────────

function AppealsPanel() {
  const [appeals, setAppeals] = useState<AdminAppealDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.adminTrustAppeals()
      .then(res => { setAppeals(res.appeals); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load appeals.'))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col gap-4">
      {appeals === null && !failed ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading appeals"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : failed ? (
        <EmptyState icon={Scale} title="Could not load appeals" description={failed} actionLabel="Try again" onAction={load} />
      ) : !appeals || appeals.length === 0 ? (
        <EmptyState icon={Scale} title="No appeals to review" description="No appeals have been filed. Every appeal must be decided by a reviewer different from the original decision maker." />
      ) : (
        <div className="flex flex-col gap-4">
          {appeals.map(a => <AdminAppealCard key={a.id} appeal={a} onChanged={load} />)}
        </div>
      )}
    </div>
  )
}

function AdminAppealCard({ appeal, onChanged }: { appeal: AdminAppealDTO; onChanged: () => void }) {
  const [reviewerId, setReviewerId] = useState('')
  const [busy, setBusy] = useState<'assign' | 'close' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decideOpen, setDecideOpen] = useState(false)

  const decided =
    appeal.status === 'UPHELD' || appeal.status === 'OVERTURNED' || appeal.status === 'CLOSED' || appeal.decision !== null

  const assign = async () => {
    setBusy('assign')
    setActionError(null)
    try {
      await api.adminAppealAction(appeal.id, { action: 'ASSIGN', reviewerId: reviewerId.trim() })
      toast({ title: 'Reviewer assigned' })
      setReviewerId('')
      onChanged()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not assign the reviewer.')
    } finally {
      setBusy(null)
    }
  }

  const closeWithoutDecision = async () => {
    setBusy('close')
    setActionError(null)
    try {
      await api.adminAppealAction(appeal.id, { action: 'CLOSE_WITHOUT_DECISION' })
      toast({ title: 'Appeal closed without decision' })
      onChanged()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not close the appeal.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-gold/40 text-gold">{APPEAL_TARGET_LABELS[appeal.targetType] ?? appeal.targetType}</Badge>
        <Badge variant="outline" className={appealStatusBadgeClass(appeal.status)}>{labelFromEnum(appeal.status)}</Badge>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{appeal.reason}</p>

      <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <div>Appellant: {appeal.appellant.displayName || appeal.appellant.email} ({appeal.appellant.email})</div>
        {appeal.originalDecisionById && <div>Original decision by: {appeal.originalDecisionById}</div>}
        <div>Assigned reviewer: {appeal.assignedReviewerId ?? '—'}</div>
        <div>Filed {formatDateTime(appeal.createdAt)}</div>
      </dl>

      {appeal.decision && (
        <div className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-sm">
          <p className="font-medium text-foreground">Decision: {labelFromEnum(appeal.decision)}</p>
          {appeal.decisionNote && <p className="mt-1 text-muted-foreground">{appeal.decisionNote}</p>}
          {appeal.decidedAt && <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(appeal.decidedAt)}</p>}
        </div>
      )}

      <AdminEventTimeline events={appeal.events} />

      {!decided && (
        <div className="mt-4 grid gap-2">
          {appeal.status === 'SUBMITTED' && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={reviewerId}
                onChange={e => setReviewerId(e.target.value)}
                placeholder="Admin user id to assign as reviewer"
                aria-label="Reviewer admin id"
                disabled={busy !== null}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] border-gold/40 text-gold hover:bg-gold/10"
                disabled={busy !== null || reviewerId.trim().length === 0}
                onClick={() => void assign()}
              >
                {busy === 'assign' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Assign reviewer
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {appeal.assignedReviewerId && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] border-gold/40 text-gold hover:bg-gold/10"
                disabled={busy !== null}
                onClick={() => { setActionError(null); setDecideOpen(true) }}
              >
                Decide
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="min-h-[44px] border-border text-muted-foreground hover:bg-elevated"
              disabled={busy !== null}
              onClick={() => void closeWithoutDecision()}
            >
              {busy === 'close' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Close without decision
            </Button>
          </div>
          {actionError && <p className="text-sm text-destructive" role="alert">{actionError}</p>}
        </div>
      )}

      <DecideDialog
        appeal={appeal}
        open={decideOpen}
        onClose={() => setDecideOpen(false)}
        onDecided={() => { setDecideOpen(false); onChanged() }}
      />
    </article>
  )
}

function DecideDialog({
  appeal,
  open,
  onClose,
  onDecided,
}: {
  appeal: AdminAppealDTO
  open: boolean
  onClose: () => void
  onDecided: () => void
}) {
  const [decision, setDecision] = useState<'UPHELD' | 'OVERTURNED'>('UPHELD')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDecision('UPHELD')
      setNote('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.adminAppealAction(appeal.id, { action: 'DECIDE', decision, decisionNote: note.trim() })
      toast({ title: `Appeal ${decision === 'UPHELD' ? 'upheld' : 'overturned'}` })
      onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the decision.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Decide appeal</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            UPHELD means the original decision stands; OVERTURNED reverses it. The reviewer must be a different administrator than the original decision maker — the server rejects self-reviews.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <RadioGroup value={decision} onValueChange={v => setDecision(v as 'UPHELD' | 'OVERTURNED')} className="gap-2">
            <div className="flex items-start gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
              <RadioGroupItem value="UPHELD" id="decide-upheld" className="mt-0.5" />
              <div>
                <Label htmlFor="decide-upheld" className="text-foreground">UPHELD</Label>
                <p className="text-xs text-muted-foreground">The original decision was correct and stays in force.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
              <RadioGroupItem value="OVERTURNED" id="decide-overturned" className="mt-0.5" />
              <div>
                <Label htmlFor="decide-overturned" className="text-foreground">OVERTURNED</Label>
                <p className="text-xs text-muted-foreground">The original decision was wrong and is reversed.</p>
              </div>
            </div>
          </RadioGroup>
          <div className="grid gap-1.5">
            <Label htmlFor="decide-note">Decision note (required, at least 10 characters)</Label>
            <Textarea
              id="decide-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              disabled={busy}
              placeholder="Reasoning recorded in the audit trail"
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border bg-transparent text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-gold text-primary-foreground hover:bg-gold-hover"
            disabled={busy || note.trim().length < 10}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Shared: append-only case history with full admin notes ──────────────────

function AdminEventTimeline({ events }: { events: Array<ComplaintEventDTO & { detailFull?: string | null }> }) {
  return (
    <div className="mt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <FileClock className="h-3.5 w-3.5" aria-hidden /> Case history (append-only)
      </p>
      <div className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-elevated p-3">
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No events recorded yet.</p>
        ) : (
          events.map(ev => {
            const detail = ev.detailFull ?? ev.detail
            return (
              <div key={ev.id} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0 text-foreground">
                  <span className="font-medium">{labelFromEnum(ev.action)}</span>
                  {detail ? ` — ${detail}` : ev.action === 'NOTE_ADDED' ? ' — An administrator added an internal note.' : ''}
                  <span className="text-muted-foreground"> · by {ev.actorRole}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{formatDateTime(ev.createdAt)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
