'use client'

// ─── Personal Learning Intelligence (Phase 3B) ────────────────────────────────
// The personal learning hub: today's plan, evidence-based mastery map, spaced
// revision, mistake ledger, explainable next-best actions and honest
// stated-vs-observed insights.
//
// Honesty doctrine (spec §10): every number comes from real DB records via
// /api/learning/*; thin data shows honest empty states; nothing invents
// streaks, percentages or urgency. Works for guests AND signed-in students —
// the working identity is the app-wide guestId.

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/bean/empty-state'
import { useAppStore } from '@/lib/store'
import { api, learnerTimezone } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDate } from '@/components/bean/format'
import type {
  LearningOverviewDTO,
  TopicMasteryDTO,
  DayPlanDTO,
  PlanTaskDTO,
  RevisionResponseDTO,
  MistakesResponseDTO,
  MistakeItemDTO,
  MistakeStudentTag,
  MasteryStatus,
} from '@/lib/learning/dto'
import {
  AlertTriangle,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardX,
  Compass,
  GraduationCap,
  Hourglass,
  Loader2,
  RefreshCw,
  Sparkles,
  Stethoscope,
  Target,
} from 'lucide-react'

// The browser's IANA timezone — sent once with every day-keyed learning request.
const LEARNER_TZ = learnerTimezone()

const STATUS_META: Record<MasteryStatus, { label: string; className: string }> = {
  NOT_ASSESSED: { label: 'Not assessed', className: 'border-border text-muted-foreground bg-muted' },
  INSUFFICIENT_EVIDENCE: { label: 'Thin evidence', className: 'border-border text-muted-foreground bg-muted' },
  LEARNING: { label: 'Learning', className: 'border-destructive/40 text-destructive bg-destructive/10' },
  DEVELOPING: { label: 'Developing', className: 'border-gold/40 text-gold bg-gold/10' },
  STRONG: { label: 'Strong', className: 'border-success/40 text-success bg-success/10' },
  NEEDS_REVISION: { label: 'Needs revision', className: 'border-destructive bg-destructive/20 text-destructive' },
}

const TASK_KIND_LABEL: Record<string, string> = {
  REVISE_TOPIC: 'Spaced revision',
  PRACTICE_TOPIC: 'Targeted practice',
  DIAGNOSTIC: 'Diagnostic',
  REVIEW_MISTAKES: 'Mistake review',
  GOAL_WORK: 'Goal work',
  CONTINUE_DOC: 'Material check',
}

const MISTAKE_TAG_LABEL: Record<MistakeStudentTag, string> = {
  CONCEPT: 'Concept gap',
  FACT: 'Fact recall',
  FORMULA: 'Formula slip',
  MISREAD: 'Misread the question',
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
  ariaLabel,
}: {
  icon: typeof Compass
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  ariaLabel?: string
}) {
  return (
    <section aria-label={ariaLabel ?? title} className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Icon className="h-4 w-4 text-gold" aria-hidden /> {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StatusChip({ status }: { status: MasteryStatus }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant="outline" className={cn('shrink-0', meta.className)}>
      {meta.label}
    </Badge>
  )
}

export function LearningView() {
  const [reloadKey, setReloadKey] = useState(0)
  return <LearningData key={reloadKey} onRetry={() => setReloadKey(k => k + 1)} />
}

function LearningData({ onRetry }: { onRetry: () => void }) {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)

  const [overview, setOverview] = useState<LearningOverviewDTO | null>(null)
  const [mastery, setMastery] = useState<TopicMasteryDTO[] | null>(null)
  const [revision, setRevision] = useState<RevisionResponseDTO | null>(null)
  const [mistakes, setMistakes] = useState<MistakesResponseDTO | null>(null)
  const [plan, setPlan] = useState<DayPlanDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!guestId) return
    let cancelled = false
    Promise.all([
      api.learningOverview(guestId, LEARNER_TZ),
      api.learningMastery(guestId),
      api.learningRevision(guestId, LEARNER_TZ),
      api.learningMistakes(guestId, { limit: 30 }),
    ])
      .then(([o, m, r, mk]) => {
        if (cancelled) return
        setOverview(o)
        setMastery(m.topics)
        setRevision(r)
        setMistakes(mk)
      })
      .catch(e => !cancelled && setFailed(e instanceof Error ? e.message : 'Could not load your learning hub.'))
    return () => {
      cancelled = true
    }
  }, [guestId])

  const refreshPlanAndOverview = async () => {
    if (!guestId) return
    const [o, p] = await Promise.all([api.learningOverview(guestId, LEARNER_TZ), api.learningPlan(guestId, undefined, LEARNER_TZ)])
    setOverview(o)
    setPlan(p)
  }

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work — please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (!guestId) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <GraduationCap className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Setting up your session…</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your learning hub works in guest mode too — one moment.</p>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <EmptyState icon={RefreshCw} title="Could not load your learning hub" description={failed} actionLabel="Try again" onAction={onRetry} />
      </div>
    )
  }

  if (!overview || !mastery || !revision || !mistakes) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-64" />
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  const runDiagnostic = (scope: { scopeType: 'TOPIC' | 'UNIT' | 'SUBJECT' | 'EXAM'; scopeId: string }) =>
    withBusy(`diag:${scope.scopeId}`, async () => {
      const r = await api.startDiagnostic(guestId, scope)
      navigate({ view: 'test', attemptId: r.attemptId })
    })

  const taskAction = (task: PlanTaskDTO, action: 'COMPLETE' | 'SKIP' | 'DEFER' | 'RESCHEDULE' | 'RESIZE', extra?: { date?: string; minutes?: number }) =>
    withBusy(`task:${task.id}:${action}`, async () => {
      await api.updatePlanTask(task.id, { guestId, action, ...extra })
      await refreshPlanAndOverview()
    })

  const regenerate = () =>
    withBusy('plan-regen', async () => {
      await refreshPlanAndOverview()
      const p = await api.regenerateLearningPlan(guestId, LEARNER_TZ)
      setPlan(p)
      setNotice('Plan regenerated — only open tasks were replaced; your completed history is untouched.')
    })

  const decideAction = (actionKey: string, decision: 'DISMISS' | 'SNOOZE' | 'COMPLETE') =>
    withBusy(`act:${actionKey}:${decision}`, async () => {
      await api.decideLearningAction({ guestId, actionKey, decision })
      const [o, a] = await Promise.all([api.learningOverview(guestId, LEARNER_TZ), api.learningActions(guestId, LEARNER_TZ)])
      setOverview(o)
      setPlan(null) // overview carries the plan slice; clear stale full plan
      void a
    })

  const tagMistake = (m: MistakeItemDTO, tag: MistakeStudentTag | null) =>
    withBusy(`mistake:${m.id}`, async () => {
      const r = await api.updateMistake(m.id, { guestId, studentTag: tag })
      setMistakes(prev =>
        prev ? { ...prev, mistakes: prev.mistakes.map(x => (x.id === m.id ? { ...r.mistake, timesWrong: x.timesWrong } : x)) } : prev,
      )
    })

  const planData = plan
  const planSlice = overview.plan

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Personal learning intelligence</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Your learning, read honestly.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Everything here is computed from your own submitted attempts — never from what you merely read, and never by an
          AI inventing a score. Thin evidence is labelled thin; quiet days are just quiet.
        </p>
        {notice && (
          <p className="mt-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold" role="status">
            {notice}
          </p>
        )}
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* ── Left column ── */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Today's plan */}
          <SectionCard
            icon={CalendarClock}
            title={`Today · ${formatDate(planSlice.date)}`}
            ariaLabel="Today's plan"
            action={
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" disabled={busy === 'plan-regen'} onClick={regenerate}>
                {busy === 'plan-regen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />}
                Regenerate
              </Button>
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Capacity <span className="font-semibold text-foreground">{planSlice.availableMinutes} min</span>
              </span>
              <span>
                Planned <span className="font-semibold text-foreground">{planSlice.plannedMinutes} min</span>
              </span>
              <span>
                Done <span className="font-semibold text-foreground">{planSlice.completedMinutes} min</span>
              </span>
            </div>

            {planData ? (
              planData.tasks.length === 0 ? (
                <p className="rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
                  {planData.history.length > 0
                    ? 'Everything for today is already handled — completed, skipped or deferred.'
                    : 'Nothing needed today: your evidence does not justify inventing tasks. Take a diagnostic or a practice test to create real data.'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {planData.tasks.map(t => (
                    <li key={t.id} className="rounded-lg border border-border bg-elevated p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                            {t.title}
                            <Badge variant="outline" className="border-border text-muted-foreground">
                              {TASK_KIND_LABEL[t.kind] ?? t.kind}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{t.estimatedMinutes} min</span>
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.rationale}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="bg-gold text-primary-foreground hover:bg-gold-hover"
                          disabled={busy === `task:${t.id}:COMPLETE`}
                          onClick={() => taskAction(t, 'COMPLETE')}
                        >
                          {busy === `task:${t.id}:COMPLETE` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" aria-hidden />}
                          Done
                        </Button>
                        {t.topicId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gold/40 text-gold hover:bg-gold/10"
                            onClick={() => (t.kind === 'DIAGNOSTIC' ? runDiagnostic({ scopeType: 'TOPIC', scopeId: t.topicId as string }) : navigate({ view: 'topic', topicId: t.topicId as string }))}
                          >
                            {t.kind === 'DIAGNOSTIC' ? 'Start diagnostic' : 'Open topic'}
                            <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={busy === `task:${t.id}:RESIZE`} onClick={() => taskAction(t, 'RESIZE', { minutes: Math.min(180, t.estimatedMinutes + 10) })}>
                          +10 min
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={busy === `task:${t.id}:RESCHEDULE`} onClick={() => taskAction(t, 'RESCHEDULE', { date: tomorrowKey(planSlice.date) })}>
                          Move to tomorrow
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={busy === `task:${t.id}:DEFER`} onClick={() => taskAction(t, 'DEFER')}>
                          Put off
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={busy === `task:${t.id}:SKIP`} onClick={() => taskAction(t, 'SKIP')}>
                          Skip
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <ul className="space-y-3">
                {planSlice.tasks.map(t => (
                  <li key={t.id} className="rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-foreground">
                    <span className="font-medium">{t.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.estimatedMinutes} min · {t.rationale}</span>
                  </li>
                ))}
              </ul>
            )}

            {planData && planData.history.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Today’s history (immutable)</h3>
                <ul className="mt-2 space-y-1.5">
                  {planData.history.map(h => (
                    <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
                      <span className={cn('truncate', h.status === 'COMPLETED' ? 'text-success' : 'text-muted-foreground line-through opacity-80')}>
                        {h.title}
                      </span>
                      <Badge variant="outline" className="shrink-0 border-border text-muted-foreground">
                        {h.status === 'COMPLETED' ? 'Completed' : h.status === 'SKIPPED' ? 'Skipped' : 'Deferred'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>

          {/* Mastery map */}
          <SectionCard
            icon={Brain}
            title="Mastery map"
            ariaLabel="Topic mastery"
            action={
              <span className="text-xs text-muted-foreground">
                {overview.mastery.totalTracked} tracked · strong {overview.mastery.counts.strong} · learning {overview.mastery.counts.learning} · needs revision {overview.mastery.counts.needsRevision}
              </span>
            }
          >
            {mastery.length === 0 ? (
              <EmptyState
                icon={Stethoscope}
                title="No topics assessed yet"
                description="Mastery appears only after real submitted answers — take a diagnostic or a practice test and this map builds itself from the results."
                actionLabel="Open practice"
                onAction={() => navigate({ view: 'practice' })}
              />
            ) : (
              <div className="max-h-96 space-y-2 overflow-x-hidden overflow-y-auto pr-1 [scrollbar-width:thin]">
                {mastery.map(t => (
                  <div key={t.topicId} className="rounded-lg border border-border bg-elevated p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 text-left text-sm font-medium text-foreground hover:text-gold"
                        onClick={() => navigate({ view: 'topic', topicId: t.topicId })}
                      >
                        {t.topicName}
                      </button>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t.accuracy}%</span>
                        <StatusChip status={t.status} />
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t.statusReason ?? ''} {t.attemptCount > 0 ? `· ${t.attemptCount} attempt${t.attemptCount === 1 ? '' : 's'}` : ''}
                      {t.lastActivityAt ? ` · last ${formatDate(t.lastActivityAt)}` : ''}
                    </p>
                    {(t.status === 'INSUFFICIENT_EVIDENCE' || t.status === 'LEARNING' || t.status === 'NEEDS_REVISION') && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="h-7 border-gold/40 text-gold hover:bg-gold/10" disabled={busy === `diag:${t.topicId}`} onClick={() => runDiagnostic({ scopeType: 'TOPIC', scopeId: t.topicId })}>
                          {busy === `diag:${t.topicId}` ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Diagnose'}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 border-border text-muted-foreground hover:bg-muted" onClick={() => navigate({ view: 'topic', topicId: t.topicId })}>
                          Practice
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Bands: &lt;60% learning · 60-79% developing · 80%+ strong — always over at least five distinct questions
              (repeating the same question never inflates a score). Recent drops below 60% flag a topic as needing revision.
            </p>
          </SectionCard>

          {/* Mistakes */}
          <SectionCard icon={ClipboardX} title="Mistake ledger" ariaLabel="Mistake review">
            {mistakes.mistakes.length === 0 ? (
              <p className="rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
                No mistakes recorded yet — either nothing was submitted, or everything landed. Records appear here from
                real wrong answers, with the original question, your answer and the explanation.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  {mistakes.repeatGapCount} repeat gap{mistakes.repeatGapCount === 1 ? '' : 's'} · {mistakes.unclassifiedCount} unclassified
                  (the system only labels what it can prove — your own tag is shown as self-reported).
                </p>
                <Accordion type="single" collapsible className="max-h-96 overflow-x-hidden overflow-y-auto pr-1 [scrollbar-width:thin]">
                  {mistakes.mistakes.map(m => (
                    <AccordionItem key={m.id} value={m.id} className="border-border">
                      <AccordionTrigger className="min-w-0 text-left text-sm text-foreground hover:no-underline">
                        <span className="min-w-0 flex-1 pr-2">
                          <span className="block truncate font-medium">{m.text}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
                            {m.topicName && <span>{m.topicName}</span>}
                            <span>missed {m.timesWrong}×</span>
                            <Badge variant="outline" className={cn('shrink-0', m.category === 'REPEAT_GAP' ? 'border-destructive/40 text-destructive' : m.category === 'CONCEPT' ? 'border-gold/40 text-gold' : 'border-border text-muted-foreground')}>
                              {m.studentTag ? `You said: ${MISTAKE_TAG_LABEL[m.studentTag]}` : m.category === 'UNCLASSIFIED' ? 'Unclassified' : m.category === 'REPEAT_GAP' ? 'Repeat gap' : 'Concept gap'}
                            </Badge>
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3 text-sm">
                        <ol className="space-y-1.5">
                          {m.options.map((opt, i) => (
                            <li
                              key={i}
                              className={cn(
                                'rounded-md border px-3 py-1.5 text-xs',
                                i === m.correctIndex
                                  ? 'border-success/40 bg-success/10 text-success'
                                  : i === m.chosenIndex
                                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                    : 'border-border text-muted-foreground',
                              )}
                            >
                              {opt}
                              {i === m.correctIndex && ' · correct'}
                              {i === m.chosenIndex && i !== m.correctIndex && ' · your answer'}
                            </li>
                          ))}
                        </ol>
                        {m.explanation && <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{m.explanation}</p>}
                        {m.categoryReason && <p className="text-xs text-muted-foreground">{m.categoryReason}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">Your label:</span>
                          {(['CONCEPT', 'FACT', 'FORMULA', 'MISREAD'] as MistakeStudentTag[]).map(tag => (
                            <Button
                              key={tag}
                              size="sm"
                              variant="outline"
                              className={cn('h-7', m.studentTag === tag ? 'border-gold/60 bg-gold/10 text-gold' : 'border-border text-muted-foreground')}
                              disabled={busy === `mistake:${m.id}`}
                              onClick={() => tagMistake(m, m.studentTag === tag ? null : tag)}
                            >
                              {MISTAKE_TAG_LABEL[tag]}
                            </Button>
                          ))}
                          {m.source === 'RIISHE' && <span className="text-[11px] text-muted-foreground">AI-generated set</span>}
                        </div>
                        <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'result', attemptId: m.attemptId })}>
                          Open the original attempt
                        </Button>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </>
            )}
          </SectionCard>
        </div>

        {/* ── Right column ── */}
        <div className="min-w-0 space-y-6">
          {/* Next best actions */}
          <SectionCard icon={Sparkles} title="Next best actions" ariaLabel="Next best actions">
            {overview.actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to act on right now — that is an honest empty state, not a placeholder. Actions appear when your
                records justify them.
              </p>
            ) : (
              <ul className="space-y-2">
                {overview.actions.map(a => (
                  <li key={a.actionKey} className="rounded-lg border border-border bg-elevated p-3">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        window.location.hash = a.href
                        window.scrollTo({ top: 0 })
                      }}
                    >
                      <span className="block text-sm font-medium text-gold">{a.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{a.reason}</span>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 border-border text-muted-foreground hover:bg-muted" disabled={busy === `act:${a.actionKey}:DISMISS`} onClick={() => decideAction(a.actionKey, 'DISMISS')}>
                        Dismiss
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 border-border text-muted-foreground hover:bg-muted" disabled={busy === `act:${a.actionKey}:SNOOZE`} onClick={() => decideAction(a.actionKey, 'SNOOZE')}>
                        <Hourglass className="mr-1 h-3 w-3" aria-hidden /> Snooze
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 border-success/40 text-success hover:bg-success/10" disabled={busy === `act:${a.actionKey}:COMPLETE`} onClick={() => decideAction(a.actionKey, 'COMPLETE')}>
                        Done
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Fixed, documented priority rules over your own records — no randomness, no urgency theatre.
            </p>
          </SectionCard>

          {/* Spaced revision */}
          <SectionCard icon={AlertTriangle} title="Revision due" ariaLabel="Spaced revision">
            {revision.due.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {revision.upcoming.length === 0
                  ? 'No revision scheduled yet — the schedule builds itself from your submitted results.'
                  : 'Nothing due right now. Next up once the interval lands:'}
              </p>
            ) : (
              <ul className="space-y-2">
                {revision.due.slice(0, 5).map(r => (
                  <li key={r.topicId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
                    <span className="min-w-0">
                      <button type="button" className="block max-w-full truncate text-sm font-medium text-foreground hover:text-gold" onClick={() => navigate({ view: 'topic', topicId: r.topicId })}>
                        {r.topicName}
                      </button>
                      <span className="block text-xs text-muted-foreground">
                        {r.dueState === 'OVERDUE' ? `${-r.daysUntilDue} day${r.daysUntilDue === -1 ? '' : 's'} overdue` : 'Due today'} · last: {r.lastOutcome ?? '—'}
                        {r.misconceptionFlag ? ' · flagged gap' : ''}
                      </span>
                    </span>
                    <Button size="sm" variant="outline" className="shrink-0 border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'topic', topicId: r.topicId })}>
                      Revise
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {revision.upcoming.length > 0 && revision.due.length === 0 && (
              <ul className="mt-3 space-y-1.5">
                {revision.upcoming.slice(0, 3).map(r => (
                  <li key={r.topicId} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">{r.topicName}</span>
                    <span>{r.daysUntilDue}d</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{revision.note}</p>
          </SectionCard>

          {/* Diagnostics */}
          <SectionCard icon={Stethoscope} title="Diagnostics" ariaLabel="Diagnostic assessments">
            {overview.diagnostics.availableTopics.length === 0 && overview.diagnostics.broaderScopes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No topic needs a baseline right now — diagnostics appear when a topic has questions available but too
                little evidence.
              </p>
            ) : (
              <ul className="space-y-2">
                {overview.diagnostics.availableTopics.map(d => (
                  <li key={d.topicId} className="rounded-lg border border-border bg-elevated px-3 py-2">
                    <button type="button" className="w-full text-left" onClick={() => runDiagnostic({ scopeType: 'TOPIC', scopeId: d.topicId })} disabled={busy === `diag:${d.topicId}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{d.topicName}</span>
                        {busy === `diag:${d.topicId}` ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" />
                        ) : (
                          <Badge variant="outline" className="shrink-0 border-gold/40 text-gold">{d.questionBank} verified Qs</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{d.examLabel ?? ''} · short diagnostic, results feed your mastery map</span>
                    </button>
                  </li>
                ))}
                {overview.diagnostics.broaderScopes.map(d => (
                  <li key={d.scopeId} className="rounded-lg border border-border bg-elevated px-3 py-2">
                    <button type="button" className="w-full text-left" onClick={() => runDiagnostic({ scopeType: d.scopeType, scopeId: d.scopeId })} disabled={busy === `diag:${d.scopeId}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{d.label}</span>
                        {busy === `diag:${d.scopeId}` ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" />
                        ) : (
                          <Badge variant="outline" className="shrink-0 border-gold/40 text-gold">{d.questionBank} verified Qs</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{d.examLabel ?? ''} · wider baseline across the whole {d.scopeType.toLowerCase()}, results feed your mastery map</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* Insights */}
          <SectionCard icon={Target} title="Insights" ariaLabel="Stated vs observed insights">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border bg-elevated p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">You said</h3>
                <ul className="mt-2 space-y-1 text-xs text-foreground">
                  <li>Daily target: {overview.insights.stated.dailyMinutes !== null ? `${overview.insights.stated.dailyMinutes} min` : '—'}</li>
                  <li>Goal exam: {overview.insights.stated.goalExam ?? '—'}</li>
                  <li>Active goals: {overview.insights.stated.activeGoals}</li>
                  {overview.insights.stated.source === null && <li className="text-muted-foreground">Guest session — set these after claiming an account.</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-border bg-elevated p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Records show (14 days)</h3>
                <ul className="mt-2 space-y-1 text-xs text-foreground">
                  <li>Active days: {overview.insights.observed.activeDays14}</li>
                  <li>Minutes: {overview.insights.observed.minutes14 !== null ? overview.insights.observed.minutes14 : '—'}</li>
                  <li>Attempts: {overview.insights.observed.attempts14}</li>
                  {overview.insights.observed.topTopics.length > 0 && (
                    <li className="truncate text-muted-foreground">Most practised: {overview.insights.observed.topTopics.slice(0, 3).map(t => t.name).join(', ')}</li>
                  )}
                </ul>
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              {overview.insights.honestyNotes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Compass className="mt-0.5 h-3 w-3 shrink-0 text-gold" aria-hidden /> {n}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function tomorrowKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const next = new Date(y, m - 1, d + 1)
  const mm = String(next.getMonth() + 1).padStart(2, '0')
  const dd = String(next.getDate()).padStart(2, '0')
  return `${next.getFullYear()}-${mm}-${dd}`
}
