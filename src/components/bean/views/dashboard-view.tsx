'use client'

// ─── Student dashboard (Phase 2B, Milestone C) ─────────────────────────────────
// The signed-in home surface. Every value comes from GET /api/student/dashboard
// — honest zeros and empty states when there is no data; recommendations are
// the server's deterministic, data-backed suggestions rendered verbatim.
// Guests are routed to a sign-in prompt (guest mode itself is untouched).

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/bean/empty-state'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { labelForLevel } from '@/lib/profile-options'
import { cn } from '@/lib/utils'
import { formatDate } from '@/components/bean/format'
import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck,
  ClipboardList,
  Clock3,
  Compass,
  GraduationCap,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  Upload,
} from 'lucide-react'
import type { DashboardResponse } from '@/lib/types'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold text-foreground">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Target
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Icon className="h-4 w-4 text-gold" aria-hidden /> {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

const DOC_STATUS_META: Record<string, { label: string; className: string }> = {
  READY: { label: 'Ready', className: 'border-success/40 text-success bg-success/10' },
  QUEUED: { label: 'Queued', className: 'border-border text-muted-foreground bg-muted' },
  EXTRACTING: { label: 'Extracting', className: 'border-gold/40 text-gold bg-gold/10' },
  ANALYSING: { label: 'Analysing', className: 'border-gold/40 text-gold bg-gold/10' },
  NEEDS_OCR: { label: 'Needs OCR', className: 'border-gold/40 text-gold bg-gold/10' },
  FAILED: { label: 'Failed', className: 'border-destructive/40 text-destructive bg-destructive/10' },
}

function DocStatusBadge({ status }: { status: string }) {
  const meta = DOC_STATUS_META[status] ?? { label: status, className: 'border-border text-muted-foreground bg-muted' }
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className)}>{meta.label}</span>
}

export function DashboardView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!authedStudent) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .studentDashboard()
      .then(d => !cancelled && setData(d))
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'Could not load your dashboard.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [authedStudent, reloadKey])

  if (!authChecked || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading dashboard">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <GraduationCap className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Your dashboard lives with your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to see your learning profile, continue where you left off and track your goals. Guest mode keeps
          working everywhere else.
        </p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
          Sign in or create an account
        </Button>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <EmptyState
          icon={RefreshCw}
          title="Could not load your dashboard"
          description={error ?? 'Something went wrong on our side.'}
          actionLabel="Try again"
          onAction={() => setReloadKey(k => k + 1)}
        />
      </div>
    )
  }

  const { profile, today, progress, continueLearning, goals, recommendations } = data
  const greetingName = profile.displayName || profile.email.split('@')[0]
  const levelLabel = profile.learningLevel ? labelForLevel(profile.learningLevel) : null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      {/* ── Welcome ── */}
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Your learning dashboard</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
          Hello{greetingName ? `, ${greetingName}` : ''}.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {levelLabel ?? 'Your learning profile shapes what shows up here.'}
        </p>
        {today.dailyMinutesTarget !== null && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="h-3 w-3 text-gold" aria-hidden /> Daily plan: {today.dailyMinutesTarget} minutes
            {today.minutesToday !== null ? ` · ${today.minutesToday} min studied today` : ''}
          </p>
        )}
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ── Continue learning ── */}
          <SectionCard
            icon={BookOpenCheck}
            title="Continue learning"
            action={
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'workspace' })}>
                My Learning <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Button>
            }
          >
            {continueLearning.recentDocuments.length === 0 && continueLearning.recentAttempts.length === 0 ? (
              <EmptyState
                icon={Upload}
                title="Nothing to continue — yet"
                description="Upload your first study material and Riishe will turn it into topics, notes and practice sets. Everything stays yours."
                actionLabel="Upload a document"
                onAction={() => navigate({ view: 'materials' })}
              />
            ) : (
              <div className="space-y-6">
                {continueLearning.inProgressDocuments.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">In progress</h3>
                    <ul className="mt-2 space-y-2">
                      {continueLearning.inProgressDocuments.map(d => (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => navigate({ view: 'riishe', docId: d.id })}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3 text-left transition-colors hover:border-gold/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">{d.title}</span>
                              {d.statusDetail && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{d.statusDetail}</span>}
                            </span>
                            <DocStatusBadge status={d.status} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {continueLearning.recentDocuments.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Your documents</h3>
                    <ul className="mt-2 space-y-2">
                      {continueLearning.recentDocuments.map(d => (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => navigate({ view: 'riishe', docId: d.id })}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3 text-left transition-colors hover:border-gold/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">{d.title}</span>
                              {d.topics.length > 0 && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{d.topics.join(' · ')}</span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="hidden text-xs text-muted-foreground sm:block">{formatDate(d.updatedAt)}</span>
                              <DocStatusBadge status={d.status} />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {continueLearning.recentAttempts.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Recent attempts</h3>
                    <ul className="mt-2 space-y-2">
                      {continueLearning.recentAttempts.map(a => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() =>
                              a.status === 'IN_PROGRESS'
                                ? navigate({ view: 'test', attemptId: a.id })
                                : navigate({ view: 'result', attemptId: a.id })
                            }
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3 text-left transition-colors hover:border-gold/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">{a.title}</span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {a.examLabel} · {a.source === 'RIISHE' ? 'Riishe set' : 'Question bank'}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {a.status === 'IN_PROGRESS'
                                ? 'Resume'
                                : a.score !== null && a.maxScore
                                  ? `${a.score}/${a.maxScore}`
                                  : a.status === 'SUBMITTED' || a.status === 'TIMED_OUT'
                                    ? 'Scored'
                                    : a.status.toLowerCase()}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {continueLearning.recentTopics.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Recently studied topics</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {continueLearning.recentTopics.map(t => (
                        <span key={t} className="rounded-full border border-border bg-elevated px-3 py-1 text-xs text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* ── My goals ── */}
          <SectionCard
            icon={Target}
            title="My goals"
            action={
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'goals' })}>
                Manage <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Button>
            }
          >
            {goals.active.length === 0 ? (
              <EmptyState
                icon={Target}
                title={goals.completedCount > 0 ? 'No active goals right now' : 'No goals yet'}
                description={
                  goals.completedCount > 0
                    ? `You have completed ${goals.completedCount} goal${goals.completedCount === 1 ? '' : 's'} — set the next one.`
                    : 'General learning goals work great: a subject, a course, a revision plan. They are not exam-only.'
                }
                actionLabel="Create a goal"
                onAction={() => navigate({ view: 'goals' })}
              />
            ) : (
              <ul className="space-y-2">
                {goals.active.map(g => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{g.title}</span>
                      {g.targetDate && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarCheck className="h-3 w-3" aria-hidden /> target {formatDate(g.targetDate)}
                        </span>
                      )}
                    </span>
                    <Button variant="outline" size="sm" className="shrink-0 border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'goals' })}>
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          {/* ── My progress ── */}
          <SectionCard icon={ClipboardList} title="My progress">
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Attempts" value={String(progress.attempts.count)} hint={`${progress.attempts.submitted} scored`} />
              <Stat
                label="Accuracy"
                value={progress.attempts.accuracy !== null ? `${progress.attempts.accuracy}%` : '—'}
                hint={progress.attempts.accuracy === null ? 'no scored attempts yet' : 'all scored attempts'}
              />
              <Stat label="Documents" value={String(progress.riishe.documents)} hint={`${progress.riishe.documentsReady} analysed`} />
              <Stat label="Riishe sets" value={String(progress.riishe.tests)} hint={`${progress.attempts.last7Days} attempts this week`} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Counts reflect only your account — nothing here is estimated or invented.
            </p>
            <Button variant="outline" size="sm" className="mt-4 border-border text-muted-foreground hover:bg-elevated" onClick={() => navigate({ view: 'progress' })}>
              Full progress report <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </Button>
          </SectionCard>

          {/* ── Recommended next activity ── */}
          <SectionCard icon={Sparkles} title="Next step">
            {recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No suggestion right now — keep going! Your next step appears here once there is something real to act on.
              </p>
            ) : (
              <ul className="space-y-2">
                {recommendations.map(r => (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => {
                        // In-app hash navigation: the shell's hashchange listener
                        // parses the route (same mechanism the header uses).
                        window.location.hash = r.href
                        window.scrollTo({ top: 0 })
                      }}
                      className="w-full rounded-lg border border-border bg-elevated px-4 py-3 text-left transition-colors hover:border-gold/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gold">{r.title}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{r.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Compass className="mt-0.5 h-3 w-3 shrink-0 text-gold" aria-hidden />
              Suggestions come only from your own documents, attempts and goals — never from imagined streaks or mastery.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
