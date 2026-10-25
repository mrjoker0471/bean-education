'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AttemptStateDTO } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { formatClock } from '@/components/bean/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { CheckCircle2, Flag, Loader2, RotateCcw, TimerOff } from 'lucide-react'

type StateResponse = AttemptStateDTO & { redirect?: string }

const MAX_TIME_SPENT_SEC = 6 * 60 * 60 // honest clamp for untimed sessions

export function TestRunnerView({ attemptId }: { attemptId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)

  const [state, setState] = useState<AttemptStateDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fetchedFor, setFetchedFor] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Local runner state — answers are autosaved and only scored on submit (server-authoritative)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [marked, setMarked] = useState<Map<string, boolean>>(new Map())
  const [current, setCurrent] = useState(0)
  const answersRef = useRef<Record<string, number>>({})

  const [clockBase, setClockBase] = useState<{ endsAt: number; offset: number } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  // Untimed sessions measure elapsed time from this mount (clamped on submit)
  const mountedAtRef = useRef<number>(Date.now())

  // Autosave — debounced, silent, never disrupts the exam
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const submittingRef = useRef(false)
  const autoSubmittedRef = useRef(false)
  const redirectedRef = useRef(false)
  const submitFnRef = useRef<(timedOut: boolean) => void>(() => {})

  // Loading is derived: this attemptId has not been fetched (yet)
  const loading = fetchedFor !== attemptId
  const untimed = state ? state.config.durationMin <= 0 : false

  // ─── Load attempt state (state changes only in async callbacks) ───
  useEffect(() => {
    if (!guestId) return
    let alive = true
    api.attemptState(attemptId, guestId)
      .then(raw => {
        const res = raw as StateResponse
        if (res.redirect === 'result') {
          if (!redirectedRef.current) {
            redirectedRef.current = true
            navigate({ view: 'result', attemptId })
          }
          return
        }
        if (!alive) return
        setState(res)
        setClockBase({ endsAt: res.endsAt, offset: res.serverNow - Date.now() })
        mountedAtRef.current = Date.now()
        // Resume: restore saved answers only into an empty local set (fresh mount)
        const saved = res.savedAnswers ?? {}
        if (Object.keys(saved).length > 0 && Object.keys(answersRef.current).length === 0) {
          answersRef.current = { ...saved }
          setAnswers({ ...saved })
        }
        setFetchedFor(attemptId)
      })
      .catch(e => {
        if (!alive) return
        setLoadError(e instanceof Error ? e.message : 'Failed to load the test')
        setFetchedFor(attemptId)
      })
    return () => { alive = false }
  }, [attemptId, guestId, navigate, reloadKey])

  // ─── Debounced autosave after each answer change (fire-and-forget, silent) ───
  const queueAutosave = (next: Record<string, number>) => {
    if (!guestId) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      api.autosaveAttempt(attemptId, guestId, next)
        .then(r => { if (r?.ok) setSaveState('saved') })
        .catch(() => { /* autosave failures must not disturb the exam */ })
    }, 800)
  }

  // Clear any pending autosave timer when leaving the runner
  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
  }, [])

  const remainingSec = clockBase
    ? Math.max(0, Math.round((clockBase.endsAt - (nowMs + clockBase.offset)) / 1000))
    : null

  const answeredCount = Object.keys(answers).length

  // ─── Submit (also used by the timer; safe from callbacks and handlers) ───
  const doSubmit = () => {
    if (!state || !guestId || submittingRef.current) return
    submittingRef.current = true
    setConfirmOpen(false)
    setSubmitting(true)
    setSubmitError(null)
    // Flush any pending debounced autosave immediately (fire-and-forget)
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    api.autosaveAttempt(attemptId, guestId, answersRef.current).catch(() => {})
    const durSec = state.config.durationMin * 60
    const timeSpentSec = state.config.durationMin <= 0
      ? Math.max(0, Math.min(MAX_TIME_SPENT_SEC, Math.round((Date.now() - mountedAtRef.current) / 1000)))
      : Math.max(0, Math.min(durSec, durSec - (remainingSec ?? 0)))
    api.submitAttempt(attemptId, guestId, answersRef.current, timeSpentSec)
      .then(() => navigate({ view: 'result', attemptId }))
      .catch(e => {
        submittingRef.current = false
        setSubmitting(false)
        setSubmitError(e instanceof Error ? e.message : 'Could not submit the test — please try again')
      })
  }

  // Keep a ref to the latest submit closure for the timer interval
  useEffect(() => { submitFnRef.current = doSubmit })

  // ─── Clock tick + auto-submit exactly once when the timer hits zero ───
  // Untimed tests never tick and never auto-submit.
  useEffect(() => {
    if (!clockBase || untimed) return
    const iv = setInterval(() => {
      const now = Date.now()
      setNowMs(now)
      const remaining = Math.max(0, Math.round((clockBase.endsAt - (now + clockBase.offset)) / 1000))
      if (remaining === 0 && !autoSubmittedRef.current && !submittingRef.current) {
        autoSubmittedRef.current = true
        submitFnRef.current(true)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [clockBase, untimed])

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading test">
        <Skeleton className="h-8 w-2/3 bg-elevated" />
        <Skeleton className="mt-3 h-4 w-1/3 bg-elevated" />
        <div className="mt-8 flex flex-col gap-4 lg:flex-row">
          <div className="flex-1 space-y-3">
            <Skeleton className="h-24 w-full bg-elevated" />
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full bg-elevated" />)}
          </div>
          <Skeleton className="h-64 w-full bg-elevated lg:w-72" />
        </div>
      </div>
    )
  }

  if (loadError && !state) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {loadError}
        </div>
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            className="border-gold/40 text-gold hover:bg-gold/10"
            onClick={() => { setFetchedFor(null); setLoadError(null); setReloadKey(k => k + 1) }}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!state) return null

  const q = state.questions[current]
  const total = state.questions.length
  const unanswered = total - answeredCount
  const currentMarked = marked.get(q.id) ?? false
  const backDocId = state.source === 'RIISHE' ? state.documentId : null

  const selectAnswer = (qid: string, idx: number) => {
    const next = { ...answersRef.current, [qid]: idx }
    answersRef.current = next
    setAnswers(next)
    queueAutosave(next)
  }

  const clearResponse = () => {
    const next = { ...answersRef.current }
    delete next[q.id]
    answersRef.current = next
    setAnswers(next)
    queueAutosave(next)
  }

  const toggleMark = () => {
    setMarked(prev => {
      const next = new Map(prev)
      const wasMarked = next.get(q.id) ?? false
      if (wasMarked) next.delete(q.id)
      else next.set(q.id, true)
      return next
    })
  }

  const handleRetry = () => {
    setFetchedFor(null)
    setLoadError(null)
    setReloadKey(k => k + 1)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* ─── Runner header ─── */}
      <header className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold leading-tight text-foreground sm:text-2xl">{state.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {state.examLabel}
              {state.source === 'RIISHE' && (
                <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">Riishe test</Badge>
              )}
            </p>
            {backDocId && (
              <button
                type="button"
                className="mt-1.5 text-xs font-medium text-gold hover:underline"
                onClick={() => navigate({ view: 'riishe', docId: backDocId })}
              >
                Back to workspace
              </button>
            )}
          </div>
          {untimed ? (
            <Badge variant="outline" className="shrink-0 self-start border-border bg-elevated px-4 py-2 text-sm font-medium text-muted-foreground sm:self-auto">
              <TimerOff className="mr-1.5 h-3.5 w-3.5" aria-hidden /> No time limit
            </Badge>
          ) : (
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-elevated px-4 py-2" role="timer" aria-label={`Time remaining: ${formatClock(remainingSec ?? 0)}`}>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Time left</p>
                <p className={cn('font-display text-2xl font-bold tabular-nums text-foreground', remainingSec !== null && remainingSec < 60 && 'timer-warning')}>
                  {formatClock(remainingSec ?? 0)}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">{state.config.count} questions</Badge>
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">
            {state.config.marksPerQuestion} {state.config.marksPerQuestion === 1 ? 'mark' : 'marks'} / question
          </Badge>
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">
            {state.config.negativeMark > 0 ? `−${state.config.negativeMark} / wrong` : 'No negative marking'}
          </Badge>
          <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold" aria-live="polite">
            <CheckCircle2 className="h-3 w-3" /> Answered {answeredCount}/{total}
          </Badge>
          {saveState === 'saved' && (
            <span className="text-[11px] text-muted-foreground" aria-hidden>Answers saved</span>
          )}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* ─── Question card ─── */}
        <section aria-label="Question" aria-live="polite">
          <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                Question <span className="text-gold">{current + 1}</span> of {total}
              </p>
              {q.topicName && (
                <Badge variant="outline" className="max-w-[16rem] truncate border-border text-muted-foreground">{q.topicName}</Badge>
              )}
            </div>
            <p className="mt-4 text-base font-medium leading-relaxed text-foreground sm:text-lg">{q.text}</p>

            {/* Options — native radios give full keyboard/accessibility semantics */}
            <div role="radiogroup" aria-label={`Options for question ${current + 1}`} className="mt-5 flex flex-col gap-2.5">
              {q.options.map((opt, oi) => {
                const selected = answers[q.id] === oi
                return (
                  <label
                    key={oi}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors',
                      selected
                        ? 'border-gold bg-gold/10 text-foreground'
                        : 'border-border bg-card hover:border-gold/40 hover:bg-elevated',
                      submitting && 'pointer-events-none opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      className="sr-only"
                      checked={selected}
                      onChange={() => selectAnswer(q.id, oi)}
                      disabled={submitting}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                        selected ? 'border-gold bg-gold text-primary-foreground' : 'border-border text-muted-foreground',
                      )}
                    >
                      {'ABCD'[oi] ?? oi + 1}
                    </span>
                    <span className="text-sm leading-relaxed">{opt}</span>
                  </label>
                )
              })}
            </div>

            {/* Controls */}
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
              <Button variant="outline" className="border-border" disabled={current === 0 || submitting} onClick={() => setCurrent(c => Math.max(0, c - 1))}>
                Previous
              </Button>
              <Button variant="outline" className="border-border" disabled={answers[q.id] === undefined || submitting} onClick={clearResponse}>
                Clear response
              </Button>
              <Button
                variant="outline"
                onClick={toggleMark}
                disabled={submitting}
                aria-pressed={currentMarked}
                className={cn(
                  currentMarked
                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-300'
                    : 'border-border text-muted-foreground',
                )}
              >
                <Flag className={cn('h-4 w-4', currentMarked && 'fill-current')} /> Mark for review
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button variant="outline" className="border-border" disabled={current >= total - 1 || submitting} onClick={() => setCurrent(c => Math.min(total - 1, c + 1))}>
                  Next
                </Button>
                <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={submitting} onClick={() => setConfirmOpen(true)}>
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Submitting…</> : 'Submit test'}
                </Button>
              </div>
            </div>

            {submitError && (
              <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                {submitError}
              </p>
            )}
          </div>
        </section>

        {/* ─── Question palette ─── */}
        <aside aria-label="Question palette" className="self-start lg:sticky lg:top-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Question palette</h2>
            <div className="mt-3 grid max-h-96 grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8 lg:grid-cols-5">
              {state.questions.map((pq, i) => {
                const answered = answers[pq.id] !== undefined
                const isMarked = marked.get(pq.id) ?? false
                const isCurrent = i === current
                return (
                  <button
                    key={pq.id}
                    type="button"
                    onClick={() => setCurrent(i)}
                    aria-label={`Question ${i + 1}${answered ? ', answered' : ', not answered'}${isMarked ? ', marked for review' : ''}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={cn(
                      'flex h-10 items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors',
                      isCurrent && 'ring-2 ring-gold ring-offset-2 ring-offset-card',
                      answered
                        ? 'border-gold bg-gold text-primary-foreground'
                        : 'border-border bg-elevated text-muted-foreground hover:text-foreground',
                      isMarked && 'border-2 border-amber-400 text-amber-300',
                      isMarked && answered && 'bg-gold text-primary-foreground',
                    )}
                  >
                    {i + 1}
                  </button>
                )
              })}
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-3.5 w-3.5 rounded-sm border border-gold bg-gold" /> Answered
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-3.5 w-3.5 rounded-sm border-2 border-amber-400" /> Marked for review
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-3.5 w-3.5 rounded-sm border border-border bg-elevated" /> Not answered
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {/* ─── Submit confirmation ─── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Submit this test?</AlertDialogTitle>
            <AlertDialogDescription>
              {unanswered > 0
                ? `You have answered ${answeredCount} of ${total} questions. The remaining ${unanswered} will be scored as skipped.`
                : `All ${total} questions answered. Submit now to see your score and the full answer review.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting} className="border-border">Keep working</AlertDialogCancel>
            <AlertDialogAction
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              disabled={submitting}
              onClick={e => { e.preventDefault(); doSubmit() }}
            >
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Scoring…</> : 'Submit final answers'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Screen-reader + visual hint for the timed status (untimed tests have none) */}
      {!untimed && (
        <>
          <p className="sr-only" aria-live="assertive">
            {remainingSec !== null && remainingSec <= 0
              ? 'Time is over. The test is being submitted automatically.'
              : `Test in progress. Time remaining ${formatClock(remainingSec ?? 0)}.`}
          </p>
          {remainingSec === 0 && (
            <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive shadow-lg" role="alert">
              <TimerOff className="mr-1.5 inline h-3.5 w-3.5" aria-hidden /> Time over — submitting automatically…
            </div>
          )}
        </>
      )}
    </div>
  )
}
