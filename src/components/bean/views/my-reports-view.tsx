'use client'

// ─── BEAN Teach (Phase 6): my reports & appeals (student-facing) ─────────────
// Private list of the signed-in student's complaints and appeals, each with
// its append-only case history. Everything here is confidential by design:
// only authorised BEAN administrators can read a report and the reported
// party never sees the complainant's identity. Complaints waiting for
// information get an inline form to add detail; decided cases show the
// resolved date and the administrator's decision trail.

import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, FileClock, Loader2, Scale, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { ComplaintEventDTO, MyReportsResponse, OwnAppealDTO, OwnComplaintDTO } from '@/lib/types'

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

const APPEAL_TARGET_LABELS: Record<string, string> = {
  COMPLAINT_DECISION: 'Complaint decision',
  REVIEW_MODERATION: 'Review moderation',
  TRUST_ACTION: 'Trust restriction',
}

const PRIVACY_NOTE =
  'Reports are confidential. Only authorised BEAN administrators can see them. The person you report can never see your identity.'

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

export function MyReportsView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  if (!authChecked) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <EmptyState
          icon={ShieldAlert}
          title="Sign in to see your reports"
          description="Reports belong to your account. Sign in to file new reports from your bookings and follow the cases and appeals you have already opened."
          actionLabel="Sign in"
          onAction={() => navigate({ view: 'auth' })}
        />
      </div>
    )
  }
  return <ReportsPanel />
}

function ReportsPanel() {
  const navigate = useAppStore(s => s.navigate)
  const [data, setData] = useState<MyReportsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    // Complaints and appeals live on separate guarded endpoints — fetch both.
    Promise.all([api.myReports(), api.myAppeals()])
      .then(([complaints, appeals]) => {
        setData({ complaints: complaints.complaints, appeals: appeals.appeals })
        setFailed(null)
      })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your reports.'))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach · Trust</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">My reports & appeals</h1>
      <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
        {PRIVACY_NOTE}
      </p>

      <Tabs defaultValue="complaints" className="mt-6">
        <TabsList className="bg-elevated">
          <TabsTrigger value="complaints">Complaints</TabsTrigger>
          <TabsTrigger value="appeals">Appeals</TabsTrigger>
        </TabsList>

        <TabsContent value="complaints" className="mt-4">
          {data === null && !failed ? (
            <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading complaints"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
          ) : failed ? (
            <EmptyState icon={ShieldAlert} title="Could not load your reports" description={failed} actionLabel="Try again" onAction={load} />
          ) : !data || data.complaints.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="You have not filed any reports"
              description="You can report a class you booked — teaching quality, a misleading class description, teacher or student conduct, safeguarding, harassment, discrimination, class cancellations, technical problems and attendance disputes. Open your bookings and file the report from the affected class."
              actionLabel="Open my bookings"
              onAction={() => navigate({ view: 'classes', tab: 'bookings' })}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {data.complaints.map(c => <ComplaintCard key={c.id} complaint={c} onChanged={load} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="appeals" className="mt-4">
          {data === null && !failed ? (
            <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading appeals"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
          ) : failed ? (
            <EmptyState icon={Scale} title="Could not load your appeals" description={failed} actionLabel="Try again" onAction={load} />
          ) : !data || data.appeals.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No appeals filed"
              description="If a decision goes against you — a complaint decision, the moderation of your own review, or a trust restriction — you can appeal it. A different administrator than the original decision maker re-checks every appeal."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {data.appeals.map(a => <AppealCard key={a.id} appeal={a} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ComplaintCard({ complaint, onChanged }: { complaint: OwnComplaintDTO; onChanged: () => void }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-gold/40 text-gold">{COMPLAINT_CATEGORY_LABELS[complaint.category] ?? complaint.category}</Badge>
        {complaint.isSensitive && (
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Restricted handling</Badge>
        )}
        <Badge variant="outline" className={severityBadgeClass(complaint.severity)}>{complaint.severity}</Badge>
        <Badge variant="outline" className={complaintStatusBadgeClass(complaint.status)}>{labelFromEnum(complaint.status)}</Badge>
      </div>

      <h3 className="mt-3 font-display text-base font-semibold text-foreground">{complaint.subject}</h3>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{complaint.description}</p>

      {complaint.classTitle && <p className="mt-2 text-xs text-muted-foreground">Class: {complaint.classTitle}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Filed {formatDateTime(complaint.createdAt)}
        {complaint.resolvedAt ? ` · Decided ${formatDateTime(complaint.resolvedAt)}` : ''}
      </p>

      <ReportTimeline events={complaint.events} />

      {complaint.status === 'WAITING_FOR_INFORMATION' && (
        <AddInfoForm complaintId={complaint.id} onAdded={onChanged} />
      )}
    </article>
  )
}

/** Inline form for complaints the administrators flagged WAITING_FOR_INFORMATION. */
function AddInfoForm({ complaintId, onAdded }: { complaintId: string; onAdded: () => void }) {
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.addComplaintInfo(complaintId, detail.trim())
      setDetail('')
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the information.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-elevated p-3">
      <Label htmlFor={`add-info-${complaintId}`} className="text-xs uppercase tracking-wider text-muted-foreground">Add information</Label>
      <Textarea
        id={`add-info-${complaintId}`}
        value={detail}
        onChange={e => setDetail(e.target.value)}
        rows={3}
        maxLength={1000}
        className="mt-2"
        placeholder="The administrator asked for more detail. Your answer is appended to the case history and cannot be deleted."
        disabled={busy}
      />
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      <Button
        size="sm"
        className="mt-2 min-h-[44px] bg-gold text-primary-foreground hover:bg-gold-hover"
        disabled={busy || detail.trim().length === 0}
        onClick={() => void submit()}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Send to the case file
      </Button>
    </div>
  )
}

function AppealCard({ appeal }: { appeal: OwnAppealDTO }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-gold/40 text-gold">{APPEAL_TARGET_LABELS[appeal.targetType] ?? appeal.targetType}</Badge>
        <Badge variant="outline" className={appealStatusBadgeClass(appeal.status)}>{labelFromEnum(appeal.status)}</Badge>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{appeal.reason}</p>
      <p className="mt-2 text-xs text-muted-foreground">Filed {formatDateTime(appeal.createdAt)}</p>

      {appeal.decision && (
        <div className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-sm">
          <p className="font-medium text-foreground">Decision: {labelFromEnum(appeal.decision)}</p>
          {appeal.decisionNote && <p className="mt-1 text-muted-foreground">{appeal.decisionNote}</p>}
          {appeal.decidedAt && <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(appeal.decidedAt)}</p>}
        </div>
      )}

      <ReportTimeline events={appeal.events} />
    </article>
  )
}

/** Append-only case history. Internal administrator notes reach the student as
 *  a redacted placeholder (the server strips the note itself). */
function ReportTimeline({ events }: { events: ComplaintEventDTO[] }) {
  return (
    <div className="mt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <FileClock className="h-3.5 w-3.5" aria-hidden /> Case history (append-only)
      </p>
      <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-elevated p-3">
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No events recorded yet.</p>
        ) : (
          events.map(ev => (
            <div key={ev.id} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-start sm:justify-between">
              <span className="min-w-0 text-foreground">
                <span className="font-medium">{labelFromEnum(ev.action)}</span>
                {ev.detail ? ` — ${ev.detail}` : ev.action === 'NOTE_ADDED' ? ' — An administrator added an internal note.' : ''}
                <span className="text-muted-foreground"> · by {ev.actorRole}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">{formatDateTime(ev.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
