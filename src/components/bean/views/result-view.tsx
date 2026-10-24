'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AttemptResultDTO } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { formatClock, optionLetter, pct } from '@/components/bean/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import {
  CheckCircle2, Clock, Loader2, MessageCircleQuestion, MinusCircle, RotateCcw,
  ShieldCheck, Sparkles, Trophy, XCircle,
} from 'lucide-react'

export function ResultView({ attemptId }: { attemptId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)

  const [dto, setDto] = useState<AttemptResultDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fetchedFor, setFetchedFor] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [retaking, setRetaking] = useState(false)
  const [retakeError, setRetakeError] = useState<string | null>(null)
  const redirectedRef = useRef(false)

  // Loading is derived: this attemptId has not been fetched (yet)
  const loading = fetchedFor !== attemptId
  const error = fetchedFor === attemptId ? loadError : null

  // ─── Load result (state changes only in async callbacks) ───
  useEffect(() => {
    if (!guestId) return
    let alive = true
    api.attemptResult(attemptId, guestId)
      .then(r => { if (alive) { setDto(r); setFetchedFor(attemptId) } })
      .catch(e => {
        if (!alive) return
        const msg = e instanceof Error ? e.message : 'Failed to load result'
        // 409 — the attempt has not been submitted yet; the result route includes a redirect to the runner
        if (/still in progress/i.test(msg)) {
          if (!redirectedRef.current) {
            redirectedRef.current = true
            navigate({ view: 'test', attemptId })
          }
          return
        }
        setLoadError(msg)
        setFetchedFor(attemptId)
      })
    return () => { alive = false }
  }, [attemptId, guestId, navigate, reloadKey])

  const handleRetry = () => {
    setFetchedFor(null)
    setLoadError(null)
    setReloadKey(k => k + 1)
  }

  const handleRetake = () => {
    if (!dto || !guestId || retaking) return
    const topicId = dto.perTopic[0]?.topicId
    if (!topicId) return
    setRetaking(true)
    setRetakeError(null)
    api.startTest({ guestId, topicId })
      .then(r => navigate({ view: 'test', attemptId: r.attemptId }))
      .catch(e => setRetakeError(e instanceof Error ? e.message : 'Could not start a new test'))
      .finally(() => setRetaking(false))
  }

  const handleAskBean = () => {
    if (!dto) return
    const weak = dto.perTopic.filter(t => t.total > 0 && t.correct / t.total < 0.6)
    const weakLabel = weak.length > 0
      ? weak.map(t => `${t.name} (${t.correct}/${t.total}, ${pct(t.correct, t.total)}%)`).join('; ')
      : 'none below 60%'
    useAppStore.getState().setBeanContext({
      attemptSummary: `Scored ${dto.score}/${dto.maxScore} on "${dto.title}". Weak topics: ${weakLabel}.`,
    })
    navigate({ view: 'bean', seeded: false })
  }

  // ─── Loading ───
  if (loading && !dto) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading result">
        <Skeleton className="mx-auto h-16 w-48 bg-elevated" />
        <Skeleton className="mt-4 mx-auto h-5 w-64 bg-elevated" />
        <Skeleton className="mt-8 h-36 w-full bg-elevated" />
        <Skeleton className="mt-6 h-48 w-full bg-elevated" />
      </div>
    )
  }

  // ─── Error ───
  if (!dto && error) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={handleRetry}>
            <RotateCcw className="mr-2 h-4 w-4" /> Retry
          </Button>
          <Button variant="outline" className="border-border" onClick={() => navigate({ view: 'progress' })}>
            Back to My Progress
          </Button>
        </div>
      </div>
    )
  }

  if (!dto) return null

  const retakeTopicId = dto.perTopic[0]?.topicId ?? null

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
      {/* ─── Score header ─── */}
      <section aria-label="Score summary" className="rounded-xl border border-border bg-card p-6 text-center sm:p-8">
        {dto.status === 'SUBMITTED' ? (
          <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">
            <Trophy className="h-3 w-3" /> Submitted
          </Badge>
        ) : (
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
            <Clock className="h-3 w-3" /> Time expired — auto-submitted
          </Badge>
        )}
        <div className="mt-4 flex items-end justify-center gap-2">
          <span className="font-display text-6xl font-bold leading-none text-gold sm:text-7xl">{dto.score}</span>
          <span className="text-2xl text-muted-foreground">/ {dto.maxScore}</span>
        </div>
        {dto.maxScore > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {pct(Math.max(0, dto.score), dto.maxScore)}% of the maximum score
          </p>
        )}
        <p className="mt-3 font-display text-base text-foreground sm:text-lg">{dto.title}</p>
        <p className="text-sm text-muted-foreground">{dto.examLabel}</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
            <CheckCircle2 className="h-3 w-3" /> Correct {dto.correctCount}
          </Badge>
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
            <XCircle className="h-3 w-3" /> Wrong {dto.wrongCount}
          </Badge>
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">
            <MinusCircle className="h-3 w-3" /> Skipped {dto.skippedCount}
          </Badge>
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">
            <Clock className="h-3 w-3" /> Time taken {formatClock(dto.timeSpentSec)}
          </Badge>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {dto.config.marksPerQuestion} {dto.config.marksPerQuestion === 1 ? 'mark' : 'marks'} per question ·{' '}
          {dto.config.negativeMark > 0 ? `−${dto.config.negativeMark} for every wrong answer` : 'no negative marking'}
        </p>
      </section>

      {/* ─── Per-topic breakdown ─── */}
      <section aria-label="Per-topic breakdown" className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-6">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Per-topic breakdown</h2>
        {dto.perTopic.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            This attempt had no topic-tagged questions, so no topic breakdown is available.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {dto.perTopic.map(t => (
              <li key={t.topicId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.correct}/{t.total} correct ({pct(t.correct, t.total)}%)
                  </p>
                </div>
                <Progress value={pct(t.correct, t.total)} className="mt-2 h-2" aria-label={`${t.name}: ${pct(t.correct, t.total)}% correct`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Actions ─── */}
      <section aria-label="Actions" className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            className="bg-gold text-primary-foreground hover:bg-gold-hover"
            onClick={handleRetake}
            disabled={!retakeTopicId || retaking}
          >
            {retaking
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Preparing…</>
              : <><RotateCcw className="mr-2 h-4 w-4" /> Retake a fresh test</>}
          </Button>
          <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={handleAskBean}>
            <Sparkles className="mr-2 h-4 w-4" /> Ask BEAN about my mistakes
          </Button>
          <Button variant="outline" className="border-border" onClick={() => navigate({ view: 'progress' })}>
            <MessageCircleQuestion className="mr-2 h-4 w-4" /> Back to My Progress
          </Button>
        </div>
        {retakeError && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {retakeError}
          </p>
        )}
        {!retakeTopicId && !retakeError && (
          <p className="mt-3 text-sm text-muted-foreground">
            This attempt had no topic-linked questions to retake — start a new test from any exam or subject page.
          </p>
        )}
      </section>

      {/* ─── Answer review ─── */}
      <section aria-label="Answer review" className="mt-8">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Answer review</h2>
        <p className="mt-1 text-sm text-muted-foreground">Every question, your response, the verified answer and its explanation.</p>
        <div className="mt-4 max-h-[36rem] overflow-y-auto rounded-xl pr-1">
          <Accordion type="single" collapsible className="flex flex-col gap-2.5">
            {dto.questions.map((q, i) => {
              const answered = q.selectedIndex !== null
              const borderClass = q.isCorrect
                ? 'border-success/40'
                : answered
                  ? 'border-destructive/40'
                  : 'border-border'
              return (
                <AccordionItem
                  key={q.id}
                  value={q.id}
                  className={cn('rounded-xl border bg-card px-4', borderClass)}
                >
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex w-full min-w-0 items-center gap-2.5 pr-3 text-left">
                      <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">Q{i + 1}</span>
                      {q.isCorrect ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Correct" />
                      ) : answered ? (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Wrong" />
                      ) : (
                        <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not answered" />
                      )}
                      <span className="line-clamp-1 flex-1 text-sm font-medium text-foreground">{q.text}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-4 pb-5">
                    <p className="text-sm leading-relaxed text-foreground">{q.text}</p>
                    {q.topicName && (
                      <Badge variant="outline" className="w-fit border-border text-muted-foreground">{q.topicName}</Badge>
                    )}
                    <dl className="flex flex-col gap-2 text-sm">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your answer</dt>
                        <dd className={cn(
                          'font-medium',
                          !answered && 'text-muted-foreground',
                          answered && q.isCorrect && 'text-success',
                          answered && !q.isCorrect && 'text-destructive',
                        )}>
                          {answered
                            ? `${optionLetter(q.selectedIndex ?? 0)}. ${q.options[q.selectedIndex ?? 0] ?? ''}`
                            : 'Not answered'}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Correct answer</dt>
                        <dd className="font-medium text-success">
                          {optionLetter(q.correctIndex)}. {q.options[q.correctIndex] ?? ''}
                        </dd>
                      </div>
                    </dl>
                    {q.explanation && (
                      <div className="rounded-lg border border-border bg-elevated p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gold">Explanation</p>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{q.explanation}</p>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          All questions are original BEAN EXAMS practice questions with author-verified answers.
        </p>
      </section>
    </div>
  )
}
