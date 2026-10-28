'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AttemptResultDTO, RiisheExplanationsDTO } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { formatClock, optionLetter, pct } from '@/components/bean/format'
import { RiisheChatPanel } from '@/components/bean/riishe-chat'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import {
  BookOpen, CheckCircle2, ClipboardList, Clock, FileText, FolderOpen, Loader2, MessageCircleQuestion,
  MinusCircle, RotateCcw, ShieldCheck, ShieldQuestion, Sparkles, Trophy, TriangleAlert, XCircle,
} from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  FOUNDATION: 'Foundation',
  APPLICATION: 'Application',
  STATEMENT: 'Statement-based',
  MULTISTEP: 'Multi-step',
  MISCONCEPTION: 'Misconception',
}

/** Riishe topics are free-text labels keyed "t:Label" — not catalogue topic ids. */
const isRiisheLabel = (topicId: string | null | undefined) => !!topicId?.startsWith('t:')

const EXPLAIN_POLL_MS = 4000
const EXPLAIN_MAX_POLLS = 90 // honest stop after ~6 minutes of polling

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

  // ─── Riishe post-exam explanations ───
  const [explain, setExplain] = useState<RiisheExplanationsDTO | null>(null)
  const [explainPhase, setExplainPhase] = useState<'idle' | 'requesting' | 'polling' | 'done' | 'error'>('idle')
  const [explainError, setExplainError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  // Loading is derived: this attemptId has not been fetched (yet)
  const loading = fetchedFor !== attemptId
  const error = fetchedFor === attemptId ? loadError : null

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const pollExplanationsOnce = () => {
    if (!guestId) return
    pollCountRef.current += 1
    api.riisheExplanations(attemptId, guestId)
      .then(r => {
        setExplain(r)
        if (r.pending <= 0 || pollCountRef.current >= EXPLAIN_MAX_POLLS) {
          stopPolling()
          setExplainPhase('done')
        }
      })
      .catch(e => {
        stopPolling()
        const msg = e instanceof Error ? e.message : 'Could not load explanations'
        setExplainError(msg)
        setExplainPhase('error')
      })
  }

  const startExplanations = () => {
    if (!guestId || !dto) return
    if (explainPhase === 'requesting' || explainPhase === 'polling') return
    setExplainError(null)
    setExplainPhase('requesting')
    pollCountRef.current = 0
    api.requestExplanations(attemptId, guestId)
      .then(() => {
        setExplainPhase('polling')
        stopPolling()
        pollExplanationsOnce()
        pollRef.current = setInterval(pollExplanationsOnce, EXPLAIN_POLL_MS)
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : 'Could not start the explanation review'
        setExplainError(msg)
        setExplainPhase('error')
        toast({ title: 'Riishe could not start the review', description: msg, variant: 'destructive' })
      })
  }

  // Stop polling when the result view unmounts
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ─── Load result (state changes only in async callbacks) ───
  useEffect(() => {
    if (!guestId) return
    let alive = true
    api.attemptResult(attemptId, guestId)
      .then(r => {
        if (!alive) return
        setDto(r)
        setFetchedFor(attemptId)
        // Riishe attempts: silently restore any explanations generated earlier
        // (a previous request may have finished, or may still be running)
        if (r.source === 'RIISHE' && r.wrongCount > 0) {
          api.riisheExplanations(attemptId, guestId)
            .then(x => {
              if (!alive) return
              if (x.readyCount + x.failedCount === 0) return // never requested — CTA stays
              setExplain(x)
              if (x.pending > 0) {
                setExplainPhase('polling')
                pollCountRef.current = 0
                pollRef.current = setInterval(pollExplanationsOnce, EXPLAIN_POLL_MS)
              } else {
                setExplainPhase('done')
              }
            })
            .catch(() => { /* stay idle — the CTA remains available */ })
        }
      })
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
      examSlug: dto.examSlug ?? undefined,
      examName: dto.examLabel,
      attemptSummary: `Scored ${dto.score}/${dto.maxScore} on "${dto.title}". Weak topics: ${weakLabel}.`,
    })
    navigate({ view: 'bean', seeded: false })
  }

  /** Ask BEAN about one specific weak topic. */
  const handleAskBeanTopic = (topicId: string, topicName: string) => {
    if (!dto) return
    const t = dto.perTopic.find(x => x.topicId === topicId)
    useAppStore.getState().setBeanContext({
      examSlug: dto.examSlug ?? undefined,
      examName: dto.examLabel,
      topicId,
      topicName,
      attemptSummary: `In "${dto.title}" this topic scored ${t ? `${t.correct}/${t.total} (${pct(t.correct, t.total)}%)` : '—'}. Explain the mistakes and build my revision plan.`,
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
  const isRiishe = dto.source === 'RIISHE'
  const explainBusy = explainPhase === 'requesting' || explainPhase === 'polling'
  const showExplainCta = isRiishe && dto.wrongCount > 0
  const wrongQuestions = dto.questions.filter(q => q.selectedIndex !== null && !q.isCorrect)
  const hasExplanations = !!explain && (explain.readyCount > 0 || explain.failedCount > 0)

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
        <p className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
          {dto.examLabel}
          {isRiishe && (
            <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">Riishe test</Badge>
          )}
        </p>

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
            {dto.perTopic.map(t => {
              const weak = t.total > 0 && t.correct / t.total < 0.6
              const bankTopic = !isRiisheLabel(t.topicId)
              return (
                <li key={t.topicId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {t.name}
                      {weak && (
                        <span className="ml-2 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] text-gold">weak topic</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.correct}/{t.total} correct ({pct(t.correct, t.total)}%)
                    </p>
                  </div>
                  <Progress value={pct(t.correct, t.total)} className="mt-2 h-2" aria-label={`${t.name}: ${pct(t.correct, t.total)}% correct`} />
                  {bankTopic && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-gold/40 px-2.5 text-xs text-gold hover:bg-gold/10"
                        onClick={() => navigate({ view: 'topic', topicId: t.topicId })}
                      >
                        <BookOpen className="mr-1 h-3 w-3" aria-hidden /> Study this topic
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-gold/40 px-2.5 text-xs text-gold hover:bg-gold/10"
                        onClick={() => handleAskBeanTopic(t.topicId, t.name)}
                      >
                        <Sparkles className="mr-1 h-3 w-3" aria-hidden /> Ask BEAN
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ─── Actions ─── */}
      <section aria-label="Actions" className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {isRiishe ? (
            <>
              {showExplainCta && (
                <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={startExplanations} disabled={explainBusy}>
                  {explainBusy
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Riishe is reviewing…</>
                    : <><Sparkles className="mr-2 h-4 w-4" /> Explain my mistakes with Riishe</>}
                </Button>
              )}
              {dto.documentId && (
                <Button
                  variant="outline"
                  className="border-gold/40 text-gold hover:bg-gold/10"
                  onClick={() => navigate({ view: 'riishe', docId: dto.documentId! })}
                >
                  <FileText className="mr-2 h-4 w-4" /> Back to workspace
                </Button>
              )}
              <Button variant="outline" className="border-border" onClick={() => navigate({ view: 'materials' })}>
                <FolderOpen className="mr-2 h-4 w-4" /> Back to My Materials
              </Button>
            </>
          ) : (
            <>
              <Button
                className="bg-gold text-primary-foreground hover:bg-gold-hover"
                onClick={handleRetake}
                disabled={!retakeTopicId || retaking}
              >
                {retaking
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Preparing…</>
                  : <><RotateCcw className="mr-2 h-4 w-4" /> Try another test</>}
              </Button>
              {dto.examSlug && (
                <Button
                  variant="outline"
                  className="border-gold/40 text-gold hover:bg-gold/10"
                  onClick={() => navigate({ view: 'exam', slug: dto.examSlug!, tab: 'practice' })}
                >
                  <ClipboardList className="mr-2 h-4 w-4" /> Practice exam
                </Button>
              )}
              <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={handleAskBean}>
                <Sparkles className="mr-2 h-4 w-4" /> Ask BEAN about my mistakes
              </Button>
            </>
          )}
          <Button variant="outline" className="border-border" onClick={() => navigate({ view: 'progress' })}>
            <MessageCircleQuestion className="mr-2 h-4 w-4" /> Back to My Progress
          </Button>
        </div>
        {retakeError && !isRiishe && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {retakeError}
          </p>
        )}
        {!isRiishe && !retakeTopicId && !retakeError && (
          <p className="mt-3 text-sm text-muted-foreground">
            This attempt had no topic-linked questions to retake — start a new test from any exam or subject page.
          </p>
        )}
        {explainPhase === 'error' && explainError && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {explainError}
          </p>
        )}
      </section>

      {/* ─── Riishe explanation progress ─── */}
      {isRiishe && explainBusy && (
        <section aria-label="Explanation progress" aria-live="polite" className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Riishe is reviewing your answers…</p>
              {explain && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {explain.readyCount} of {dto.wrongCount} explained
                  {explain.failedCount > 0 ? ` · ${explain.failedCount} could not be prepared yet` : ''}
                </p>
              )}
            </div>
          </div>
          {explain && dto.wrongCount > 0 && (
            <Progress
              value={Math.round((explain.readyCount / dto.wrongCount) * 100)}
              className="mt-3 h-1.5"
              aria-label={`Explanations ready: ${explain.readyCount} of ${dto.wrongCount}`}
            />
          )}
        </section>
      )}

      {/* ─── Riishe&apos;s review of your mistakes ─── */}
      {isRiishe && hasExplanations && (
        <section aria-label="Riishe review of your mistakes" className="mt-8">
          <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Riishe&apos;s review of your mistakes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Why each wrong answer was wrong — grounded in the material you uploaded.
          </p>
          <div className="mt-4 max-h-[36rem] overflow-y-auto rounded-xl pr-1">
            <Accordion type="single" collapsible className="flex flex-col gap-2.5">
              {wrongQuestions.map(q => {
                const num = dto.questions.findIndex(x => x.id === q.id) + 1
                const entry = explain?.explanations[q.id]
                const payload = entry?.status === 'READY' ? entry.payload : null
                return (
                  <AccordionItem key={q.id} value={q.id} className="rounded-xl border border-border bg-card px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <span className="flex w-full min-w-0 items-center gap-2.5 pr-3 text-left">
                        <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">Q{num}</span>
                        {payload ? (
                          <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Wrong" />
                        ) : entry?.status === 'FAILED' ? (
                          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" aria-label="Explanation failed" />
                        ) : (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Explanation pending" />
                        )}
                        <span className="line-clamp-1 flex-1 text-sm font-medium text-foreground">{q.text}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-4 pb-5">
                      {payload ? (
                        <>
                          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Why your answer is wrong</p>
                            <p className="mt-1.5 text-sm leading-relaxed text-foreground">{payload.whyWrong}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-elevated p-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gold">Correct reasoning</p>
                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{payload.correctReasoning}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From your material</p>
                            <blockquote className="mt-2 rounded-r-lg border-l-2 border-gold/50 bg-elevated px-4 py-3 text-sm italic leading-relaxed text-foreground">
                              &ldquo;{payload.excerpt}&rdquo;
                            </blockquote>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {(payload.pageRefs ?? []).map(p => (
                                <Badge key={p} variant="outline" className="border-border bg-card text-muted-foreground">page {p}</Badge>
                              ))}
                              {payload.grounding === 'external' && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] text-amber-300">
                                  <TriangleAlert className="h-3 w-3" aria-hidden /> This part needed context beyond your document
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">Concept: {payload.concept}</Badge>
                          </div>
                          {payload.misconception && (
                            <p className="text-sm leading-relaxed text-muted-foreground">
                              <span className="font-semibold text-foreground">Misconception:</span> {payload.misconception}
                            </p>
                          )}
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            <span className="font-semibold text-foreground">Revise:</span> {payload.revisionTopic}
                          </p>
                        </>
                      ) : entry?.status === 'FAILED' ? (
                        <div className="flex flex-col gap-3">
                          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-300" role="status">
                            Riishe could not prepare an explanation for this question this time. Your result was not affected — you can retry.
                          </p>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-gold/40 text-gold hover:bg-gold/10"
                              onClick={startExplanations}
                              disabled={explainBusy}
                            >
                              {explainBusy
                                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> Working…</>
                                : <><RotateCcw className="mr-2 h-3.5 w-3.5" /> Retry explanations</>}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Explanation being prepared…</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </div>
        </section>
      )}

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
              const bankTopic = !isRiisheLabel(q.topicId)
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
                    <div className="flex flex-wrap items-center gap-2">
                      {q.topicName && (
                        <Badge variant="outline" className="border-border text-muted-foreground">{q.topicName}</Badge>
                      )}
                      {isRiishe && q.category && (
                        <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">
                          {CATEGORY_LABELS[q.category] ?? q.category}
                        </Badge>
                      )}
                      {!isRiishe && q.sourceType === 'PYQ_VERIFIED' && (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                          <ShieldCheck className="mr-1 h-3 w-3" /> PYQ — verified
                        </Badge>
                      )}
                      {!isRiishe && q.sourceType === 'PYQ_UNVERIFIED' && (
                        <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">
                          <ShieldQuestion className="mr-1 h-3 w-3" /> PYQ — provenance uncertain
                        </Badge>
                      )}
                      {!isRiishe && (!q.sourceType || q.sourceType === 'ORIGINAL') && (
                        <Badge variant="outline" className="border-border text-muted-foreground">
                          <FileText className="mr-1 h-3 w-3" /> Original practice question
                        </Badge>
                      )}
                      {isRiishe && (q.pageRefs?.length ?? 0) > 0 && q.pageRefs!.map(p => (
                        <Badge key={p} variant="outline" className="border-border bg-card text-muted-foreground">page {p}</Badge>
                      ))}
                    </div>
                    {!isRiishe && q.sourcePaper && (
                      <p className="text-xs text-muted-foreground">
                        Source: {q.sourcePaper}{q.year ? ` · ${q.year}` : ''}
                      </p>
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
                    {isRiishe && q.evidence && (
                      <blockquote className="rounded-r-lg border-l-2 border-gold/40 bg-elevated px-3 py-2 text-xs italic leading-relaxed text-muted-foreground">
                        From your material: &ldquo;{q.evidence}&rdquo;
                      </blockquote>
                    )}
                    {isRiishe && (
                      <details className="rounded-lg border border-border bg-elevated/60 px-3 py-2">
                        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-gold">
                          <Sparkles className="mr-1 inline h-3 w-3" aria-hidden /> Ask Riishe about this question
                        </summary>
                        <div className="mt-3">
                          <RiisheChatPanel
                            guestId={guestId}
                            scope={{ attemptId, questionId: q.id }}
                            greeting="Ask a follow-up about this question — Riishe answers from your material and cites the pages it used."
                            onOpenPage={(page, docId) => {
                              if (docId) navigate({ view: 'riishe', docId, page })
                            }}
                            compact
                          />
                        </div>
                      </details>
                    )}
                    {bankTopic && q.topicId && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-gold/40 px-2.5 text-xs text-gold hover:bg-gold/10"
                          onClick={() => navigate({ view: 'topic', topicId: q.topicId! })}
                        >
                          <BookOpen className="mr-1 h-3 w-3" aria-hidden /> Study this topic
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-gold/40 px-2.5 text-xs text-gold hover:bg-gold/10"
                          onClick={() => {
                            if (!q.topicId) return
                            handleAskBeanTopic(q.topicId, q.topicName ?? 'this topic')
                          }}
                        >
                          <Sparkles className="mr-1 h-3 w-3" aria-hidden /> Ask BEAN about this question
                        </Button>
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
          {isRiishe
            ? 'These questions were generated from your uploaded material and validated before the test — each item above shows its category and the pages it was drawn from.'
            : dto.questions.some(q => q.sourceType === 'PYQ_VERIFIED' || q.sourceType === 'PYQ_UNVERIFIED')
              ? 'Question sources are labelled per item above — verified previous-year questions carry their source paper and year; originals carry an author-verified answer.'
              : 'All questions in this attempt are original BEAN EXAMS practice questions with author-verified answers — no unverified material is presented as previous-year.'}
        </p>
      </section>
    </div>
  )
}
