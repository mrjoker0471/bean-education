'use client'

// ─── BEAN Classroom Intelligence (CI-2E): administrator trust review ─────────
// The admin-facing review surface for teacher disputes against AI report
// findings. It USES the existing dispute APIs and permission model — no new
// review logic lives in the frontend:
//   • every action is a server-side, ADMIN-gated, append-only event;
//   • RESOLVE supports UPHELD / CORRECTED (deterministic rebuild without the
//     disputed findings — never a silent rewrite) / RETRACTED;
//   • the administrator who made the original decision cannot review a
//     reconsideration (server-enforced; the UI surfaces the honest refusal);
//   • AI agents never resolve their own disputes — a human decides, with a
//     documented note, and the full case history stays visible.
//
// Design follows the Trust Center conventions (obsidian/gold, restrained).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Scale, FileSearch, ShieldAlert, CheckCircle2, Ban, Undo2, Eye, Clock3, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import type { CiAdminDisputeDTO, CiAdminReportDTO } from '@/lib/ci/dto'
import { toast } from '@/hooks/use-toast'

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  RESOLVED: 'border-success/40 bg-success/10 text-success',
  DISMISSED: 'border-border bg-elevated text-muted-foreground',
}

const ACTION_BADGE: Record<string, string> = {
  SUBMITTED: 'border-border bg-elevated text-muted-foreground',
  ASSIGNED: 'border-border bg-elevated text-muted-foreground',
  UNDER_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  RESOLVED: 'border-success/40 bg-success/10 text-success',
  DISMISSED: 'border-border bg-elevated text-muted-foreground',
  NOTE_ADDED: 'border-border bg-elevated text-muted-foreground',
  RECONSIDER_REQUESTED: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

function AppendOnlyTimeline({ events }: { events: CiAdminDisputeDTO['events'] }) {
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-elevated/60 px-3 py-2" aria-label="Case history (append-only)">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Case history (append-only)</p>
      <ul className="flex flex-col gap-1.5">
        {events.map((e) => (
          <li key={e.id} className="text-xs text-muted-foreground">
            <span className={`mr-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] ${ACTION_BADGE[e.action] ?? 'border-border bg-elevated text-muted-foreground'}`}>
              {e.action.replaceAll('_', ' ').toLowerCase()}
            </span>
            <span className="text-foreground/80">{e.detail ?? e.action}</span>
            <span className="ml-1 text-[10px] text-muted-foreground/70">{new Date(e.createdAt).toLocaleString()} · {e.actorRole}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReportInspector({ reportId }: { reportId: string }) {
  const [data, setData] = useState<CiAdminReportDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .adminCiReport(reportId)
      .then((d) => { if (alive) { setData(d); setFailed(null) } })
      .catch((e) => { if (alive) setFailed(e instanceof Error ? e.message : 'Could not load the report.') })
    return () => { alive = false }
  }, [reportId])

  if (failed) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{failed}</p>
  if (!data) {
    return (
      <div className="flex items-center justify-center py-4" role="status" aria-label="Loading report">
        <Loader2 className="h-4 w-4 animate-spin text-gold" />
      </div>
    )
  }
  const r = data.report
  return (
    <div className="flex flex-col gap-3 text-xs" data-ci-admin-report={r.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px]">v{r.version} · {r.status}</Badge>
        {r.insufficientEvidence && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">insufficient evidence</Badge>}
        {r.requiresHumanReview && <Badge variant="outline" className="border-gold/40 bg-gold/10 text-[10px] text-gold">human review flagged</Badge>}
        {r.modelId ? <span className="text-[10px] text-muted-foreground/70">engine: {r.modelId}</span> : <span className="text-[10px] text-muted-foreground/70">deterministic rebuild (no model)</span>}
        <span className="text-[10px] text-muted-foreground/70">{new Date(r.createdAt).toLocaleString()}</span>
      </div>
      <div>
        <p className="text-[11px] font-semibold text-foreground">Class</p>
        <p className="text-muted-foreground">{r.classSession.title} · {r.classSession.subject} · job {r.job.status} ({r.job.trigger}, attempt {r.job.attempts})</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold text-foreground">Evidence register</p>
        <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
          {r.evidenceRefs.map((e, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className={e.available ? 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500' : 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40'} aria-hidden />
              <span>{e.kind.replaceAll('_', ' ').toLowerCase()} — {e.summary}</span>
            </li>
          ))}
        </ul>
      </div>
      {r.report && (
        <div>
          <p className="text-[11px] font-semibold text-foreground">Agent findings in this version</p>
          <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-elevated/60 px-3 py-2">
            <ul className="flex flex-col gap-1.5 text-muted-foreground">
              {[...r.report.strengths, ...r.report.improvements, ...r.report.otherFindings].map((f) => (
                <li key={f.findingId} id={`admin-finding-${f.findingId}`} className="leading-relaxed">
                  <span className="font-medium text-foreground">{f.findingId}</span> · {f.category.replaceAll('_', ' ').toLowerCase()} · {f.confidence} confidence{f.flaggedForReview ? ' · advisory only' : ''} — {f.observation.slice(0, 220)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {r.agentRuns.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-foreground">Agent runs (audit)</p>
          <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
            {r.agentRuns.map((a) => (
              <li key={a.id}>
                {a.agent} · {a.status} · attempt {a.attempt}{a.durationMs ? ` · ${a.durationMs} ms` : ''}{a.error ? ` · error: ${a.error.slice(0, 140)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function AdminCiReviewPanel() {
  const [disputes, setDisputes] = useState<CiAdminDisputeDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState<'UPHELD' | 'CORRECTED' | 'RETRACTED' | null>(null)
  const [actionFor, setActionFor] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .adminCiDisputes()
      .then((d) => { setDisputes(d.disputes); setFailed(null) })
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Could not load the dispute queue.'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const pending = useMemo(() => (disputes ?? []).filter((d) => d.status === 'SUBMITTED' || d.status === 'UNDER_REVIEW'), [disputes])
  const closed = useMemo(() => (disputes ?? []).filter((d) => d.status === 'RESOLVED' || d.status === 'DISMISSED'), [disputes])

  const applyAction = async (id: string, action: 'ASSIGN' | 'UNDER_REVIEW' | 'RESOLVE' | 'DISMISS', res?: 'UPHELD' | 'CORRECTED' | 'RETRACTED', noteText?: string) => {
    setBusy(true)
    try {
      await api.adminCiDisputeAction(id, { action, resolution: res, note: noteText })
      toast({ title: 'Action recorded', description: 'The append-only case history was updated.' })
      setOpenId(null)
      setActionFor(null)
      setNote('')
      setResolution(null)
      load()
    } catch (e) {
      toast({ title: 'Action refused', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (failed && disputes === null) {
    return <EmptyState icon={ShieldAlert} title="Could not load the Classroom Intelligence dispute queue" description={failed} actionLabel="Try again" onAction={load} />
  }
  if (disputes === null) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading disputes">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5" data-ci-admin-queue={disputes.length}>
      <p className="text-sm text-muted-foreground">
        Teacher disputes against AI evaluation findings. AI reports are <span className="text-foreground">advisory evidence</span>: a human decides
        whether disputed findings stand (UPHELD), the report is rebuilt without them (CORRECTED — deterministic, no new AI output), or the report is
        retracted. Every decision requires a documented note and lands in an append-only case history.
      </p>

      {disputes.length === 0 && (
        <p className="rounded-xl border border-border bg-elevated/60 px-4 py-3 text-sm text-muted-foreground">
          No teacher disputes exist yet.
        </p>
      )}

      {pending.length > 0 && (
        <section aria-label="Pending disputes">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Clock3 className="h-4 w-4 text-gold" aria-hidden /> Review queue <span className="font-normal text-muted-foreground">({pending.length})</span>
          </h3>
          <div className="flex flex-col gap-3">
            {pending.map((d) => (
              <div key={d.id} className="rounded-xl border border-border bg-card" data-ci-dispute={d.id}>
                <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {d.classTitle} <span className="text-muted-foreground">· report v{d.reportVersion} ({d.reportStatus.toLowerCase()})</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {d.classSubject} · disputed {d.findings.length} finding(s): {d.findings.map((f) => f.findingId).join(', ')} · submitted {new Date(d.createdAt).toLocaleDateString()}
                      {d.assignedAdminId ? ' · assigned' : ' · unassigned'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[d.status]}`}>{d.status}</Badge>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-elevated" onClick={() => setOpenId(openId === d.id ? null : d.id)} aria-expanded={openId === d.id}>
                      {openId === d.id ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                      {openId === d.id ? 'Close' : 'Review'}
                    </Button>
                    {!d.assignedAdminId && (
                      <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => applyAction(d.id, 'ASSIGN')} disabled={busy}>
                        Assign to me
                      </Button>
                    )}
                  </div>
                </div>
                {openId === d.id && (
                  <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Scale className="h-3 w-3" aria-hidden /> Disputed findings and the teacher&apos;s explanation
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {d.findings.map((f) => (
                          <li key={f.findingId} className="rounded-lg border border-border bg-elevated/60 px-3 py-2 text-xs">
                            <span className="font-medium text-foreground">{f.findingId}</span>
                            <span className="mt-1 block text-muted-foreground">{f.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <FileSearch className="h-3 w-3" aria-hidden /> Original evaluation and evidence
                      </p>
                      <ReportInspector reportId={d.reportId} />
                    </div>
                    <AppendOnlyTimeline events={d.events} />
                    <div className="flex flex-wrap gap-2">
                      {d.status === 'SUBMITTED' && d.assignedAdminId && (
                        <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => applyAction(d.id, 'UNDER_REVIEW')} disabled={busy}>
                          <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Mark under review
                        </Button>
                      )}
                      <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => { setActionFor(d.id); setResolution(null); setNote('') }} disabled={busy}>
                        Decide
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section aria-label="Closed disputes">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Closed <span className="font-normal text-muted-foreground">({closed.length})</span>
          </h3>
          <div className="flex flex-col gap-2">
            {closed.map((d) => (
              <div key={d.id} className="rounded-xl border border-border bg-elevated/40 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[d.status]}`}>{d.status}</Badge>
                  {d.resolution && <Badge variant="outline" className="text-[10px]">{d.resolution}</Badge>}
                  <span className="text-sm text-foreground">{d.classTitle}</span>
                  <span className="text-xs text-muted-foreground">· v{d.reportVersion} · {d.findings.map((f) => f.findingId).join(', ')}</span>
                  {d.events.some((e) => e.action === 'RECONSIDER_REQUESTED') && (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                      <Undo2 className="mr-1 h-3 w-3" aria-hidden /> reconsidered
                    </Badge>
                  )}
                </div>
                {d.resolutionNote && <p className="mt-1.5 text-xs text-muted-foreground">Decision note: {d.resolutionNote}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Decision dialog — UPHELD / CORRECTED / RETRACTED / DISMISS with a mandatory note */}
      <Dialog open={actionFor !== null} onOpenChange={(o) => { if (!o) setActionFor(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Human decision</DialogTitle>
            <DialogDescription>
              UPHELD — the findings stand. CORRECTED — the report is rebuilt WITHOUT the disputed findings by the deterministic orchestrator (no new AI
              output). RETRACTED — the report is hidden from dashboards and aggregates. DISMISS — close without a report change. A documented note is
              mandatory and lands in the append-only history.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {(['UPHELD', 'CORRECTED', 'RETRACTED'] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={resolution === r ? 'default' : 'outline'}
                className={resolution === r ? 'bg-gold text-primary-foreground hover:bg-gold-hover' : 'border-border text-muted-foreground hover:bg-elevated'}
                onClick={() => setResolution(r)}
                aria-pressed={resolution === r}
              >
                {r === 'UPHELD' && <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                {r === 'CORRECTED' && <FileSearch className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                {r === 'RETRACTED' && <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                {r}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              onClick={() => setResolution(null)}
              aria-pressed={resolution === null}
            >
              DISMISS instead
            </Button>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Documented grounds for this decision (10-1000 characters)…"
            rows={4}
            maxLength={1000}
            aria-label="Decision note"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setActionFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              disabled={busy || note.trim().length < 10}
              onClick={() => {
                if (!actionFor) return
                if (resolution) applyAction(actionFor, 'RESOLVE', resolution, note.trim())
                else applyAction(actionFor, 'DISMISS', undefined, note.trim())
              }}
            >
              Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
