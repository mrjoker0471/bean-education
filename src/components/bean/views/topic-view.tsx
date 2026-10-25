'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ResourceDTO, TopicDetailDTO } from '@/lib/types'
import { parseHash, useAppStore } from '@/lib/store'
import { Markdown } from '@/components/bean/markdown'
import { ResourceStatusBadge, AccessTypeBadge } from '@/components/bean/status-badge'
import { CountPill } from '@/components/bean/count-pill'
import { EmptyState } from '@/components/bean/empty-state'
import { formatDate } from '@/components/bean/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  BookOpenText, ChevronRight, ExternalLink, FileDown, FileText, Link2,
  Loader2, RotateCcw, SearchX, Sparkles,
} from 'lucide-react'

export function TopicView({ topicId }: { topicId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)
  const setBeanContext = useAppStore(s => s.setBeanContext)

  const [dto, setDto] = useState<TopicDetailDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fetchedFor, setFetchedFor] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  // Loading is derived: this attemptId has not been fetched (yet)
  const loading = fetchedFor !== topicId
  const error = fetchedFor === topicId ? loadError : null

  // Load the full topic workspace DTO (state only changes in async callbacks)
  useEffect(() => {
    let alive = true
    api.topic(topicId)
      .then(d => { if (alive) { setDto(d); setFetchedFor(topicId) } })
      .catch(e => {
        if (!alive) return
        setLoadError(e instanceof Error ? e.message : 'Failed to load topic')
        setFetchedFor(topicId)
      })
    return () => { alive = false }
  }, [topicId, reloadKey])

  // Carry this topic's context into BEAN Intelligence on load
  useEffect(() => {
    if (!dto || fetchedFor !== topicId) return
    setBeanContext({
      examSlug: dto.exam?.slug,
      examName: dto.exam?.name,
      subjectName: dto.subject?.name,
      topicId: dto.topic.id,
      topicName: dto.topic.name,
      noteTitle: dto.note?.title,
    })
  }, [dto, fetchedFor, topicId, setBeanContext])

  const handleStartTest = () => {
    if (!dto || !guestId || starting) return
    setStarting(true)
    setStartError(null)
    api.startTest({ guestId, topicId: dto.topic.id })
      .then(r => navigate({ view: 'test', attemptId: r.attemptId }))
      .catch(e => setStartError(e instanceof Error ? e.message : 'Could not start the test'))
      .finally(() => setStarting(false))
  }

  const handleAskBean = () => {
    if (!dto) return
    useAppStore.getState().setBeanContext({
      examSlug: dto.exam?.slug,
      examName: dto.exam?.name,
      subjectName: dto.subject?.name,
      topicId: dto.topic.id,
      topicName: dto.topic.name,
      noteTitle: dto.note?.title,
    })
    navigate({ view: 'bean', seeded: false })
  }

  const handleRetry = () => {
    setFetchedFor(null)
    setReloadKey(k => k + 1)
  }

  // ─── Loading ───
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading topic">
        <Skeleton className="h-4 w-64 bg-elevated" />
        <Skeleton className="mt-5 h-10 w-2/3 bg-elevated" />
        <Skeleton className="mt-3 h-4 w-1/2 bg-elevated" />
        <Skeleton className="mt-8 h-64 w-full bg-elevated" />
        <Skeleton className="mt-6 h-40 w-full bg-elevated" />
      </div>
    )
  }

  // ─── Error / not found ───
  if (!dto && error) {
    const notFound = /not found/i.test(error)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={SearchX}
          title={notFound ? 'Topic not found' : 'Could not load this topic'}
          description={notFound
            ? 'That topic link doesn\u2019t match anything in the BEAN EXAMS syllabus tree.'
            : error}
          actionLabel="Back to home"
          onAction={() => navigate({ view: 'home' })}
        />
        {!notFound && (
          <div className="mt-4 text-center">
            <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={handleRetry}>
              <RotateCcw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (!dto) return null
  const testCount = Math.min(10, dto.questionCount)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      {/* Breadcrumbs */}
      <nav aria-label="Syllabus breadcrumb" className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {dto.breadcrumbs.map((crumb, i) => {
          const isLast = i === dto.breadcrumbs.length - 1
          return (
            <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />}
              {isLast ? (
                <span aria-current="page" className="text-xs font-medium text-foreground sm:text-sm">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(parseHash(crumb.href))}
                  className="text-xs text-muted-foreground transition-colors hover:text-gold sm:text-sm"
                >
                  {crumb.label}
                </button>
              )}
            </span>
          )
        })}
      </nav>

      {/* Header */}
      <header className="mt-5">
        <h1 className="font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">
          {dto.topic.name}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {dto.subject && <span className="font-medium text-foreground/90">{dto.subject.name}</span>}
          {dto.exam && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={() => navigate({ view: 'exam', slug: dto.exam!.slug })}
                className="font-medium text-gold hover:underline"
              >
                {dto.exam.shortName ?? dto.exam.name}
              </button>
            </>
          )}
        </p>
        {dto.topic.description && (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {dto.topic.description}
          </p>
        )}
      </header>

      <div className="mt-10 flex flex-col gap-10">
        {/* ─── Layer 1 — STUDY ─── */}
        <section aria-labelledby="study-layer">
          <p id="study-layer" className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Layer 1 — Study
          </p>
          <div className="mt-4">
            {dto.note ? (
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="font-display text-lg text-foreground sm:text-xl">
                    Study notes — {dto.note.title}
                  </CardTitle>
                  <CardDescription>
                    Version {dto.note.version} · Updated {formatDate(dto.note.updatedAt)} · Written by BEAN EXAMS
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Markdown content={dto.note.markdown} />
                  {dto.note.sourceRefs && dto.note.sourceRefs.length > 0 && (
                    <div className="mt-6 border-t border-border pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources consulted</p>
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                        {dto.note.sourceRefs.map(ref => (
                          <li key={ref.url}>
                            <a
                              href={ref.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
                            >
                              {ref.label} <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={FileText}
                title="Original notes are being prepared for this topic"
                description="BEAN EXAMS writes its own study notes for every topic it covers — nothing is copied or scraped. This topic is still in the writing queue. Meanwhile, the curated resources below and the practice questions available are honest, working alternatives."
              />
            )}
          </div>

          {/* Curated resources */}
          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">Curated resources</h3>
              {dto.resources.length > 0 && <CountPill label="links" value={dto.resources.length} />}
            </div>
            {dto.resources.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  icon={Link2}
                  title="No curated resources yet"
                  description={'We haven’t verified any external material for this topic yet — we only list links our checks can actually reach, so this list stays empty until then.'}
                />
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {dto.resources.map(r => <ResourceRow key={r.id} resource={r} />)}
                <li className="text-xs leading-relaxed text-muted-foreground">
                  Status badges reflect the result of our last real link check — an unreachable link is kept visible in case it works from your network.
                </li>
              </ul>
            )}
          </div>
        </section>

        {/* ─── Layer 2 — PRACTICE ─── */}
        <section aria-labelledby="practice-layer">
          <p id="practice-layer" className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Layer 2 — Practice
          </p>
          <Card className="mt-4 border-border bg-card">
            <CardHeader>
              <CardTitle className="font-display text-lg text-foreground sm:text-xl">Practise this topic</CardTitle>
              <CardDescription>
                A short, server-timed test drawn from this topic’s original question bank — scored with the exam’s own marking rules.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <CountPill label="practice questions available" value={dto.questionCount} />
                <Badge variant="outline" className="border-border text-muted-foreground">1 mark per question</Badge>
              </div>
              <div className="mt-5 flex flex-col items-start gap-3">
                <Button
                  size="lg"
                  className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto"
                  disabled={!dto.hasTest || starting || !guestId}
                  onClick={handleStartTest}
                >
                  {starting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Preparing your test…</>
                    : <>Start topic test ({testCount} questions · {testCount} min)</>}
                </Button>
                {!dto.hasTest && (
                  <p className="text-sm text-muted-foreground">
                    Needs at least 4 questions — try the exam’s subject or mixed tests.
                  </p>
                )}
                {startError && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                    {startError}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Siblings nav */}
          {dto.siblings.length > 1 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-foreground">More topics in this unit</h3>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {dto.siblings.map(sib => {
                  const current = sib.id === dto.topic.id
                  return (
                    <button
                      key={sib.id}
                      type="button"
                      aria-current={current ? 'page' : undefined}
                      onClick={() => { if (!current) navigate({ view: 'topic', topicId: sib.id }) }}
                      className={cn(
                        'max-w-full truncate rounded-full border px-3 py-1.5 text-xs transition-colors sm:text-[13px]',
                        current
                          ? 'border-gold/60 bg-gold/10 font-medium text-gold'
                          : 'border-border bg-elevated text-muted-foreground hover:border-gold/40 hover:text-foreground',
                      )}
                    >
                      {sib.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* ─── Layer 3 — ASK BEAN ─── */}
        <section aria-labelledby="bean-layer">
          <p id="bean-layer" className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Layer 3 — Intelligence
          </p>
          <Card className="mt-4 border-gold/25 bg-gradient-to-b from-gold/10 to-transparent">
            <CardHeader>
              <CardTitle className="font-display text-lg text-foreground sm:text-xl">
                Ask BEAN Intelligence about this topic
              </CardTitle>
              <CardDescription>
                BEAN opens already pointed at this topic’s notes and syllabus context — ask for a simpler explanation, a quick quiz, or exam-focused revision tips.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="lg"
                variant="outline"
                className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto"
                onClick={handleAskBean}
              >
                <Sparkles className="mr-2 h-4 w-4" /> Ask BEAN about this topic
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

// ─── Resource row ───
function ResourceRow({ resource: r }: { resource: ResourceDTO }) {
  const navigate = useAppStore(s => s.navigate)
  const unreachable = r.verificationStatus === 'UNREACHABLE'
  const isPdf = r.fileKind === 'PDF'
  return (
    <li className={cn('rounded-xl border border-border bg-card p-4', unreachable && 'opacity-80')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-foreground">{r.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.provider} · {r.type} · {r.language}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ResourceStatusBadge status={r.verificationStatus} />
            <AccessTypeBadge access={r.accessType} />
          </div>
          {r.note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.note}</p>}
          {unreachable && (
            <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground">
              This link did not respond at our last check ({r.lastChecked ? formatDate(r.lastChecked) : 'recently'}) — it may still work from your network.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isPdf && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                unreachable ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold hover:bg-gold/10',
              )}
              onClick={() => navigate({ view: 'pdf', resourceId: r.id })}
              aria-label={`Open ${r.title} in the integrated reader`}
            >
              Open in reader <BookOpenText className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          <Button
            asChild
            variant={isPdf ? 'ghost' : 'outline'}
            size="sm"
            className={cn(
              unreachable && !isPdf
                ? 'border-border text-muted-foreground'
                : isPdf
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'border-gold/40 text-gold hover:bg-gold/10',
            )}
          >
            <a
              href={isPdf ? api.pdfStreamUrl(r.url, '1') : r.url}
              {...(isPdf ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
              aria-label={isPdf ? `Download PDF: ${r.title}` : `Open resource: ${r.title} (opens in a new tab)`}
            >
              {isPdf ? 'Download' : 'Open'} {isPdf ? <FileDown className="ml-1 h-3.5 w-3.5" aria-hidden /> : <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />}
            </a>
          </Button>
        </div>
      </div>
    </li>
  )
}
