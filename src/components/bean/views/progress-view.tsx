'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { ProgressDTO } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { CountPill } from '@/components/bean/count-pill'
import { EmptyState } from '@/components/bean/empty-state'
import { cn } from '@/lib/utils'
import { ChevronRight, ClipboardList, Info, RotateCcw, Sparkles, TrendingUp } from 'lucide-react'

type TotalsDTO = ProgressDTO['totals']
type WeakTopic = ProgressDTO['weakTopics'][number]
type AttemptEntry = ProgressDTO['attempts'][number]

const STATUS_META: Record<string, { label: string; className: string }> = {
  SUBMITTED: { label: 'SUBMITTED', className: 'border-gold/40 bg-gold/10 text-gold' },
  TIMED_OUT: { label: 'TIMED OUT', className: 'border-destructive/40 text-destructive' },
  IN_PROGRESS: { label: 'IN PROGRESS', className: 'border-border bg-elevated text-muted-foreground' },
  ABANDONED: { label: 'ABANDONED', className: 'border-border bg-elevated text-muted-foreground' },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ProgressView() {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)
  const setBeanContext = useAppStore(s => s.setBeanContext)

  const [data, setData] = useState<ProgressDTO | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .progress(guestId)
      .then(d => {
        if (alive) {
          setData(d)
          setStatus('ready')
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setErrorMsg(e instanceof Error ? e.message : 'Could not load progress.')
          setStatus('error')
        }
      })
    return () => {
      alive = false
    }
  }, [guestId, retryTick])

  const retry = () => {
    setErrorMsg(null)
    setStatus('loading')
    setRetryTick(t => t + 1)
  }

  const askBean = () => {
    if (!data || data.weakTopics.length === 0) return
    setBeanContext({
      attemptSummary: `Weak topics: ${data.weakTopics.map(t => `${t.name} (${t.accuracy}%)`).join(', ')}`,
    })
    navigate({ view: 'bean', seeded: false })
  }

  const loading = status === 'loading'
  const error = status === 'error' ? (errorMsg ?? 'Could not load progress.') : null

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Guest session</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Progress</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Accuracy, study time and weak-topic tracking — derived only from the attempts you complete on this device.
        </p>
      </header>

      {loading && <LoadingSkeleton />}

      {!loading && error && (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={retry}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="mt-8 space-y-8">
          <TotalsGrid totals={data.totals} />

          {data.totals.attempts === 0 && (
            <EmptyState
              icon={ClipboardList}
              title="No attempts yet"
              description="Your progress builds from real, saved test attempts. Take your first test to start tracking accuracy, study time and weak topics."
              actionLabel="Browse examinations"
              onAction={() => navigate({ view: 'catalog' })}
            />
          )}

          <WeakTopicsCard
            topics={data.weakTopics}
            onRevise={topicId => navigate({ view: 'topic', topicId })}
            onOpenRiishe={() => navigate({ view: 'riishe' })}
            onAskBean={askBean}
          />

          <AttemptsCard
            attempts={data.attempts}
            onOpen={attemptId => navigate({ view: 'result', attemptId })}
            onResume={attemptId => navigate({ view: 'test', attemptId })}
          />

          <p className="flex items-start gap-2 rounded-lg border border-border bg-elevated px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
            Progress is derived from your saved attempts on this device (guest session). No activity is fabricated.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Totals ───
function TotalsGrid({ totals }: { totals: TotalsDTO }) {
  const hasAttempts = totals.attempts > 0
  const cards = [
    {
      label: 'Attempts completed',
      value: hasAttempts ? String(totals.attempts) : '—',
      hint: hasAttempts ? 'Test sessions saved on this device' : 'No attempts yet — take a test',
    },
    {
      label: 'Questions answered',
      value: totals.questionsAnswered > 0 ? String(totals.questionsAnswered) : '—',
      hint: totals.questionsAnswered > 0 ? 'Across all graded attempts' : 'Nothing answered yet',
    },
    {
      label: 'Overall accuracy',
      value: hasAttempts ? `${totals.accuracy}%` : '—',
      hint: hasAttempts ? 'Across your graded attempts' : 'Available after your first test',
    },
    {
      label: 'Study time',
      value: totals.timeSpentMin > 0 ? `${totals.timeSpentMin} min` : '—',
      hint: totals.timeSpentMin > 0 ? 'Minutes spent in test sessions' : 'No study time recorded',
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Progress totals">
      {cards.map(card => (
        <div key={card.label} className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{card.label}</p>
          <p className="mt-2 font-display text-3xl font-bold text-gold sm:text-4xl">{card.value}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{card.hint}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Weak topics ───
function WeakTopicsCard({
  topics,
  onRevise,
  onOpenRiishe,
  onAskBean,
}: {
  topics: WeakTopic[]
  onRevise: (topicId: string) => void
  onOpenRiishe: () => void
  onAskBean: () => void
}) {
  return (
    <section aria-label="Weak topics" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-gold" aria-hidden /> Weak topics
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Topics where your accuracy fell below 60% across at least two questions.
          </p>
        </div>
        {topics.length > 0 && <CountPill label="flagged" value={topics.length} />}
      </div>

      {topics.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={TrendingUp}
            title="No weak topics yet"
            description="Take a test to generate your personalised revision list."
          />
        </div>
      ) : (
        <>
          <ul className="mt-5 max-h-96 space-y-3 overflow-y-auto pr-1">
            {topics.map(topic => (
              <li
                key={topic.topicId}
                className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 lg:max-w-[45%]">
                  <p className="truncate text-sm font-medium text-foreground">{topic.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {topic.examName} · {topic.total} questions attempted
                  </p>
                </div>
                <div className="flex items-center gap-3 lg:w-52">
                  <Progress
                    value={topic.accuracy}
                    className="h-2 flex-1"
                    aria-label={`Accuracy in ${topic.name}: ${topic.accuracy}%`}
                  />
                  <span className="w-10 shrink-0 text-right text-xs font-semibold text-gold">{topic.accuracy}%</span>
                </div>
                {topic.topicId.startsWith('t:') ? (
                  // Riishe-generated topic label ("t:Label") — not a catalogue topic;
                  // the Riishe hub shows the material's weak areas instead.
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-gold/40 text-gold hover:bg-gold/10"
                    onClick={onOpenRiishe}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open Riishe
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-gold/40 text-gold hover:bg-gold/10"
                    onClick={() => onRevise(topic.topicId)}
                  >
                    Revise topic
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={onAskBean}>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Ask BEAN for a revision plan
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Attempt history ───
function AttemptsCard({
  attempts,
  onOpen,
  onResume,
}: {
  attempts: AttemptEntry[]
  onOpen: (attemptId: string) => void
  onResume: (attemptId: string) => void
}) {
  return (
    <section aria-label="Attempt history" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <ClipboardList className="h-4 w-4 text-gold" aria-hidden /> Attempt history
        </h2>
        {attempts.length > 0 && <CountPill label="saved" value={attempts.length} />}
      </div>

      {attempts.length === 0 ? (
        <p className="mt-5 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
          No attempts saved yet — results will appear here after you finish a test.
        </p>
      ) : (
        <ul className="mt-5 max-h-96 space-y-3 overflow-y-auto pr-1">
          {attempts.map(attempt => (
            <AttemptRow key={attempt.id} attempt={attempt} onOpen={onOpen} onResume={onResume} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AttemptRow({
  attempt,
  onOpen,
  onResume,
}: {
  attempt: AttemptEntry
  onOpen: (attemptId: string) => void
  onResume: (attemptId: string) => void
}) {
  const meta = STATUS_META[attempt.status] ?? STATUS_META.ABANDONED
  const canOpen = attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT'

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        {canOpen ? (
          <button
            type="button"
            onClick={() => onOpen(attempt.id)}
            className="group flex w-full items-center gap-2 rounded text-left"
            aria-label={`View result for ${attempt.title}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-gold">
                {attempt.title}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {attempt.examLabel} · Started {formatDate(attempt.startedAt)}
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-gold"
              aria-hidden
            />
          </button>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{attempt.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {attempt.examLabel} · Started {formatDate(attempt.startedAt)}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        {attempt.score !== null && attempt.maxScore !== null && (
          <span className="text-sm font-semibold text-gold">
            {attempt.score}/{attempt.maxScore}
          </span>
        )}
        <Badge variant="outline" className={cn('shrink-0', meta.className)}>
          {meta.label}
        </Badge>
        {attempt.status === 'IN_PROGRESS' && (
          <Button
            size="sm"
            className="bg-gold text-primary-foreground hover:bg-gold-hover"
            onClick={() => onResume(attempt.id)}
          >
            Resume
          </Button>
        )}
      </div>
    </li>
  )
}

// ─── Loading ───
function LoadingSkeleton() {
  return (
    <div className="mt-8" aria-hidden>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-32 bg-elevated" />
        ))}
      </div>
      <Skeleton className="mt-8 h-64 bg-elevated" />
      <Skeleton className="mt-6 h-64 bg-elevated" />
    </div>
  )
}
