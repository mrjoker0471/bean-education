'use client'

// ─── BEAN Classroom Intelligence (CI-1D): teacher quality panel ──────────────
// The BEAN Teach "Classroom Intelligence" tab. Displays ONLY real data:
//   • the consent disclosure + grant/withdraw control,
//   • evaluated classes with their evidence-backed report (versions included),
//   • pending evaluations (status + stage),
//   • eligible ended classes a teacher can explicitly request an evaluation for
//     (with optional opt-in lesson notes).
//
// There are no fake statistics and no simulated agent activity: if nothing has
// been evaluated, the panel says so. AI findings are advisory — every report
// states its evidence basis, and flagged/insufficient-evidence states are
// rendered as first-class UI, never hidden.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Sparkles, ShieldCheck, ShieldOff, ChevronDown, ChevronUp, AlertTriangle, FileSearch, BookOpenCheck, Lightbulb, Scale, RefreshCw, Clock3 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import type {
  CiClassEvaluationResponse,
  CiClassEvaluationSummaryDTO,
  CiReportVersionDTO,
  CiTeacherSummaryResponse,
} from '@/lib/ci/dto'
import type { ReportFinding } from '@/lib/ci/schemas'
import { formatClassInZone } from '@/components/bean/teach-format'

const CATEGORY_LABELS: Record<string, string> = {
  SUBJECT_ACCURACY: 'Subject accuracy',
  EXPLANATION_CLARITY: 'Explanation clarity',
  LESSON_STRUCTURE: 'Lesson structure',
  SYLLABUS_COVERAGE: 'Syllabus coverage',
  TEACHING_PACE: 'Teaching pace',
  USE_OF_EXAMPLES: 'Use of examples',
  STUDENT_INTERACTION: 'Student interaction',
  QUESTION_HANDLING: 'Question handling',
  TIME_MANAGEMENT: 'Time management',
  LEARNING_RESOURCE_QUALITY: 'Learning-resource quality',
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
    case 'CURRENT':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'FAILED':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    case 'SKIPPED':
      return 'border-border bg-elevated text-muted-foreground'
    default:
      return 'border-gold/40 bg-gold/10 text-gold'
  }
}

// ─── Report viewer ──────────────────────────────────────────────────────────────

function FindingCard({ finding, label }: { finding: ReportFinding; label?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {label && <span className="text-[11px] font-semibold uppercase tracking-wide text-gold">{label}</span>}
        <Badge variant="outline" className="text-[10px] font-medium">
          {finding.confidence} confidence
        </Badge>
        {finding.flaggedForReview && (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
            advisory only
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-sm text-foreground">{finding.observation}</p>
      {finding.suggestion && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          {finding.suggestion}
        </p>
      )}
      {finding.flaggedForReview && finding.flagReason && (
        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">{finding.flagReason}</p>
      )}
    </div>
  )
}

function ReportVersion({ version, classId }: { version: CiReportVersionDTO; classId: string }) {
  const report = version.report
  if (!report) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {version.reportError ?? 'This report version could not be displayed.'}
      </div>
    )
  }
  const evaluated = report.categories.filter((c) => c.status === 'EVALUATED')
  return (
    <div className="flex flex-col gap-4" data-class-report={classId} data-version={version.version}>
      {report.insufficientEvidence && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Insufficient evidence: the recorded classroom evidence does not support a complete evaluation. Only conclusions the evidence
            supports are shown.
          </span>
        </div>
      )}
      {report.requiresHumanReview && (
        <div className="flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-foreground">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>
            Human review recommended{report.conflicts.length > 0 ? ' — the agents produced conflicting observations (below)' : ''}; flagged
            findings are advisory evidence only. You can dispute any finding from the report view.
          </span>
        </div>
      )}

      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <BookOpenCheck className="h-4 w-4 text-gold" aria-hidden /> Lesson summary
        </h4>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{report.lessonSummary}</p>
      </div>

      {report.strengths.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Teaching &amp; learning strengths</h4>
          <div className="mt-2 flex flex-col gap-2">
            {report.strengths.map((f) => (
              <FindingCard key={f.findingId} finding={f} label={f.source === 'LEARNER' ? 'Learner view' : CATEGORY_LABELS[f.category] ?? f.category} />
            ))}
          </div>
        </div>
      )}

      {report.improvements.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Areas for improvement</h4>
          <div className="mt-2 flex flex-col gap-2">
            {report.improvements.map((f) => (
              <FindingCard key={f.findingId} finding={f} label={f.source === 'LEARNER' ? 'Learner view' : CATEGORY_LABELS[f.category] ?? f.category} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-foreground">Evaluation categories</h4>
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          {report.categories.map((c) => (
            <div key={c.category} className="flex flex-col gap-0.5 border-b border-border px-3 py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="w-56 shrink-0 text-xs font-medium text-foreground">{CATEGORY_LABELS[c.category] ?? c.category}</span>
              {c.status === 'EVALUATED' ? (
                <span className="text-xs text-muted-foreground">{c.summary}</span>
              ) : (
                <span className="text-xs italic text-muted-foreground/80">Not evaluable from this evidence — {c.summary}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {report.conflicts.length > 0 && (
        <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Scale className="h-4 w-4 text-gold" aria-hidden /> Conflicting agent observations
          </h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {report.conflicts.map((c, i) => (
              <li key={i}>{c.description}</li>
            ))}
          </ul>
        </div>
      )}

      {(report.objectivesCovered.length > 0 || report.objectivesUnverifiable.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {report.objectivesCovered.length > 0 && (
            <div className="rounded-lg border border-border bg-elevated/60 px-3 py-2">
              <p className="text-xs font-semibold text-foreground">Objectives shown as covered</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {report.objectivesCovered.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          {report.objectivesUnverifiable.length > 0 && (
            <div className="rounded-lg border border-border bg-elevated/60 px-3 py-2">
              <p className="text-xs font-semibold text-foreground">Objectives the evidence could not verify</p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">(never counted as missed without evidence)</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {report.objectivesUnverifiable.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {report.suggestedPractice.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Recommended practice for this class</h4>
          <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground">
            {report.suggestedPractice.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <FileSearch className="h-4 w-4 text-gold" aria-hidden /> Evidence the evaluation used
        </h4>
        <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
          {report.evidenceRegister.map((e) => (
            <li key={e.kind} className="flex items-start gap-1.5">
              <span className={e.available ? 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500' : 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40'} aria-hidden />
              <span>
                {e.kind.replaceAll('_', ' ').toLowerCase()} — {e.summary}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {evaluated.length === 0 && (
        <p className="text-xs italic text-muted-foreground/80">
          No category could be evaluated from the recorded evidence for this class.
        </p>
      )}
    </div>
  )
}

// ─── Class row (expanded detail fetches its evaluation on demand) ─────────────

function ClassEvaluationRow({
  item,
  mode,
  onChanged,
}: {
  item: CiClassEvaluationSummaryDTO
  mode: 'evaluated' | 'pending' | 'eligible'
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<CiClassEvaluationResponse | null>(null)
  const [detailFailed, setDetailFailed] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const loadDetail = useCallback(() => {
    setDetail(null)
    setDetailFailed(null)
    api
      .ciClassEvaluation(item.classSessionId)
      .then(setDetail)
      .catch((e) => setDetailFailed(e instanceof Error ? e.message : 'Could not load the evaluation.'))
  }, [item.classSessionId])

  useEffect(() => {
    if (open && mode !== 'eligible') loadDetail()
  }, [open, mode, loadDetail])

  const requestEvaluation = async (withNotes: boolean) => {
    setBusy(true)
    try {
      const trimmed = withNotes ? notes.trim() : ''
      await api.ciRequestEvaluation(item.classSessionId, trimmed.length > 0 ? trimmed : undefined)
      toast({ title: 'Evaluation requested', description: 'The multi-agent evaluation will run in the background shortly.' })
      setNotesOpen(false)
      setNotes('')
      setOpen(true)
      loadDetail()
      onChanged()
    } catch (e) {
      toast({ title: 'Could not request the evaluation', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.subject} · {formatClassInZone(item.startsAt, item.timeZone)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.evaluation && (
            <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(item.evaluation.status)}`}>
              {item.evaluation.status}
              {item.evaluation.status === 'RUNNING' ? ` · ${item.evaluation.stage.toLowerCase()}` : ''}
            </Badge>
          )}
          {mode === 'evaluated' && item.currentVersion !== null && (
            <Badge variant="outline" className="text-[10px]">
              v{item.currentVersion}
            </Badge>
          )}
          {mode === 'eligible' && (
            <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setNotesOpen(true)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {item.evaluation?.status === 'FAILED' ? 'Retry evaluation' : 'Request evaluation'}
            </Button>
          )}
          {mode !== 'eligible' && (
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-elevated" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
              {open ? 'Close' : 'View'}
            </Button>
          )}
          {mode === 'evaluated' && (
            <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setNotesOpen(true)} disabled={busy}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Re-run
            </Button>
          )}
        </div>
      </div>

      {mode === 'pending' && item.evaluation && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Stage: {item.evaluation.stage.toLowerCase()} — the evaluation runs in the background; this page updates when you reload.
        </p>
      )}

      {open && detailFailed && (
        <p className="border-t border-border px-4 py-3 text-sm text-destructive">{detailFailed}</p>
      )}
      {open && !detailFailed && detail === null && (
        <div className="flex items-center justify-center border-t border-border py-6" role="status" aria-label="Loading evaluation">
          <Loader2 className="h-5 w-5 animate-spin text-gold" />
        </div>
      )}
      {open && detail !== null && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
          {detail.job && ['FAILED', 'SKIPPED'].includes(detail.job.status) && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {detail.job.status === 'FAILED' ? 'The last evaluation failed' : 'The evaluation was skipped'}: {detail.job.error ?? 'unknown reason'} — the
              class and its attendance were not affected. You can request a new evaluation.
            </p>
          )}
          {detail.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No report versions yet — the evaluation is still running or was requested just now.</p>
          ) : (
            detail.versions.map((v) => (
              <div key={v.id} className="rounded-lg border border-border bg-elevated/40 px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(v.status)}`}>
                    {v.status}
                  </Badge>
                  <span className="text-xs font-medium text-foreground">Version {v.version}</span>
                  <span className="text-[11px] text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
                  {v.modelId && <span className="text-[10px] text-muted-foreground/70">engine: {v.modelId}</span>}
                </div>
                <ReportVersion version={v} classId={detail.classSession.id} />
              </div>
            ))
          )}
        </div>
      )}

      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Optional lesson notes</DialogTitle>
            <DialogDescription>
              You may add your own lesson notes (what you covered, examples you used, questions that came up). They become authorised evidence
              for THIS evaluation only. They are never required — skipping them simply limits what the agents can assess.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Started with the geometric intuition of the discriminant, worked two factorisation examples, students asked about sign errors…"
            rows={6}
            maxLength={4000}
            aria-label="Lesson notes for this evaluation"
          />
          <p className="text-[11px] text-muted-foreground">{notes.trim().length}/4000 characters (optional, minimum 30 if provided)</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => requestEvaluation(false)} disabled={busy}>
              Request without notes
            </Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => requestEvaluation(true)} disabled={busy || notes.trim().length < 30}>
              Request with notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Main panel ────────────────────────────────────────────────────────────────

export function TeacherClassroomIntelligencePanel() {
  const [data, setData] = useState<CiTeacherSummaryResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setFailed(null)
    api
      .ciTeacherSummary()
      .then(setData)
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Could not load Classroom Intelligence.'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setConsent = async (granted: boolean) => {
    setBusy(true)
    try {
      const res = await api.ciSetConsent(granted)
      setData((d) => (d ? { ...d, consent: res.consent } : d))
      toast({
        title: granted ? 'Classroom Intelligence enabled' : 'Classroom Intelligence paused',
        description: granted
          ? 'Ended classes can now be evaluated. Evaluation always happens after a class finishes and never affects it.'
          : 'No further evaluations will run for your classes. Existing reports stay until you delete them or your account is deleted.',
      })
    } catch (e) {
      toast({ title: 'Could not update consent', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (failed && data === null) {
    return <EmptyState icon={Sparkles} title="Could not load Classroom Intelligence" description={failed} actionLabel="Try again" onAction={load} />
  }
  if (data === null) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading Classroom Intelligence">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  const { consent, evaluated, pending, eligible, totals } = data

  return (
    <div className="flex flex-col gap-6">
      {/* Consent & disclosure — what this actually does, in plain language. */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5" data-ci-consent={consent.granted ? 'granted' : 'not-granted'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-gold" aria-hidden /> Classroom Intelligence
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              After a live class of yours <span className="text-foreground">ends</span>, BEAN can run a private, evidence-backed evaluation of the
              lesson. It reads <span className="text-foreground">only</span>: your lesson plan, verified attendance, aggregate connection time (no
              identities), the whiteboard&apos;s stroke structure, and — only if you provide them — your own lesson notes.{' '}
              <span className="text-foreground">It never records audio or video, never transcribes speech, and never sees individual students&apos; behaviour.</span>
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
              <li>Reports are private to you and authorised BEAN administrators — never public, never part of your ratings or reviews.</li>
              <li>Findings are advisory evidence. Nothing is actioned automatically; a human decides anything consequential.</li>
              <li>Students see a class-level learning summary for classes they attended — the same content for every attendee, never a personal assessment.</li>
            </ul>
          </div>
          <div className="shrink-0">
            {consent.granted ? (
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setConsent(false)} disabled={busy}>
                <ShieldOff className="mr-1.5 h-4 w-4" aria-hidden /> Pause evaluations
              </Button>
            ) : (
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setConsent(true)} disabled={busy}>
                <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden /> Enable evaluations
              </Button>
            )}
          </div>
        </div>
        {consent.granted && consent.grantedAt && (
          <p className="mt-3 text-[11px] text-muted-foreground/80">Consent granted {new Date(consent.grantedAt).toLocaleString()}.</p>
        )}
        {!consent.granted && consent.withdrawnAt && (
          <p className="mt-3 text-[11px] text-muted-foreground/80">Consent withdrawn {new Date(consent.withdrawnAt).toLocaleString()} — no evaluations will run until you re-enable.</p>
        )}
      </div>

      {!consent.granted && (
        <p className="rounded-xl border border-border bg-elevated/60 px-4 py-3 text-sm text-muted-foreground">
          Evaluations are paused. Enable them above to request an evaluation for an ended class.
        </p>
      )}

      {consent.granted && (
        <>
          {/* Evaluated classes */}
          <section aria-label="Evaluated classes">
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              Evaluated classes <span className="font-normal text-muted-foreground">({totals.evaluatedClasses})</span>
              {totals.requiresReview > 0 && (
                <Badge variant="outline" className="ml-2 border-gold/40 bg-gold/10 text-[10px] text-gold">
                  {totals.requiresReview} with review flags
                </Badge>
              )}
            </h3>
            {evaluated.length === 0 ? (
              <p className="rounded-xl border border-border bg-elevated/60 px-4 py-3 text-sm text-muted-foreground">
                No evaluated classes yet. After a live class ends (and attendance is marked), request its evaluation below.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {evaluated.map((item) => (
                  <ClassEvaluationRow key={item.classSessionId} item={item} mode="evaluated" onChanged={load} />
                ))}
              </div>
            )}
          </section>

          {/* Pending evaluations */}
          {pending.length > 0 && (
            <section aria-label="Evaluations in progress">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Clock3 className="h-4 w-4 text-gold" aria-hidden /> In progress <span className="font-normal text-muted-foreground">({pending.length})</span>
              </h3>
              <div className="flex flex-col gap-3">
                {pending.map((item) => (
                  <ClassEvaluationRow key={item.classSessionId} item={item} mode="pending" onChanged={load} />
                ))}
              </div>
            </section>
          )}

          {/* Eligible ended classes */}
          <section aria-label="Ended classes awaiting evaluation">
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              Ended classes <span className="font-normal text-muted-foreground">({eligible.length})</span>
            </h3>
            {eligible.length === 0 ? (
              <p className="rounded-xl border border-border bg-elevated/60 px-4 py-3 text-sm text-muted-foreground">
                No ended classes are waiting for an evaluation.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {eligible.map((item) => (
                  <ClassEvaluationRow key={item.classSessionId} item={item} mode="eligible" onChanged={load} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
