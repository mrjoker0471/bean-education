'use client'

// Exam detail view (Task 4-a): header with honesty features + Overview / Syllabus / Study Material / Practice Tests tabs.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ExamDetailDTO, TopicNode } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { CountPill } from '@/components/bean/count-pill'
import { EmptyState } from '@/components/bean/empty-state'
import { SyllabusStatusBadge } from '@/components/bean/status-badge'
import { PatternTable, ResourceList, SubjectSyllabusCard, TemplateCard } from '@/components/bean/exam-parts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ClipboardList,
  Compass,
  ExternalLink,
  Info,
  LayoutList,
  ListTree,
  MapPin,
  Play,
  RotateCcw,
} from 'lucide-react'

const TAB_IDS = ['overview', 'syllabus', 'materials', 'tests'] as const
type TabId = (typeof TAB_IDS)[number]

const TABS: { id: TabId; label: string; icon: typeof LayoutList }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutList },
  { id: 'syllabus', label: 'Syllabus', icon: ListTree },
  { id: 'materials', label: 'Study Material', icon: BookOpen },
  { id: 'tests', label: 'Practice Tests', icon: ClipboardList },
]

function normalizeTab(tab: string | undefined): TabId {
  return TAB_IDS.includes(tab as TabId) ? (tab as TabId) : 'overview'
}

export function ExamView({ slug, initialTab }: { slug: string; initialTab?: string }) {
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)

  const [reloadToken, setReloadToken] = useState(0)
  const [tab, setTab] = useState<TabId>(normalizeTab(initialTab))
  const [pendingTopicId, setPendingTopicId] = useState<string | null>(null)

  // Keyed load state — each slug+retry combination has its own slot, so loading/error are
  // derived during render (no cascading setState inside effects).
  const loadKey = `${slug}|${reloadToken}`
  const [loaded, setLoaded] = useState<{ key: string; data: ExamDetailDTO } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  // Load the exam
  useEffect(() => {
    let alive = true
    api.exam(slug)
      .then(d => {
        if (!alive) return
        setLoaded({ key: loadKey, data: d })
        setFailure(null)
        // Carry exam context into BEAN Intelligence (#/bean inherits it)
        useAppStore.getState().setBeanContext({ examSlug: slug, examName: d.exam.name })
      })
      .catch(e => {
        if (alive) setFailure({ key: loadKey, message: e.message })
      })
    return () => {
      alive = false
    }
  }, [slug, loadKey])

  // Keep the active tab in sync with deep links (browser back/forward).
  // Guarded render-time adjustment — the pattern documented at react.dev/learn/you-might-not-need-an-effect.
  const [lastInitialTab, setLastInitialTab] = useState(initialTab)
  if (lastInitialTab !== initialTab) {
    setLastInitialTab(initialTab)
    setTab(normalizeTab(initialTab))
  }

  const data = loaded && loaded.key === loadKey ? loaded.data : null
  const error = failure && failure.key === loadKey ? failure.message : null
  const loading = !data && !error

  const changeTab = (value: string) => {
    const next = normalizeTab(value)
    setTab(next)
    navigate({ view: 'exam', slug, tab: next === 'overview' ? undefined : next })
  }

  const startTopicTest = (topic: TopicNode) => {
    if (!guestId) {
      toast({
        title: 'Preparing your session',
        description: 'Your guest profile is still initialising — try again in a moment.',
        variant: 'destructive',
      })
      return
    }
    if (pendingTopicId) return
    setPendingTopicId(topic.id)
    api.startTest({ guestId, topicId: topic.id })
      .then(r => navigate({ view: 'test', attemptId: r.attemptId }))
      .catch(e => {
        toast({ title: 'Could not start the practice test', description: e.message, variant: 'destructive' })
      })
      .finally(() => setPendingTopicId(null))
  }

  // ─── Loading ───
  if (loading) return <ExamSkeleton />

  // ─── Not found / errors ───
  if (error) {
    if (/not found/i.test(error)) {
      return (
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <EmptyState
            icon={Compass}
            title="Examination not found"
            description={`No examination lives at “${slug}” in the BEAN EXAMS catalogue. It may have been renamed — browse the catalogue to find what you need.`}
            actionLabel="Back to catalogue"
            onAction={() => navigate({ view: 'catalog' })}
          />
        </div>
      )
    }
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
          <p className="font-display text-lg font-semibold text-destructive">Could not load this examination</p>
          <p className="mt-2 text-sm text-destructive/90">{error}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setReloadToken(t => t + 1)}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Try again
            </Button>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => navigate({ view: 'catalog' })}>
              Back to catalogue
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null
  const { exam } = data

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      {/* ─── Header ─── */}
      <header>
        <button
          type="button"
          onClick={() => navigate({ view: 'catalog' })}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All examinations
        </button>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-gold/30 bg-gold/5 px-3 py-1 text-xs font-medium text-gold">
            {exam.shortName ?? 'Examination'}
          </span>
          <SyllabusStatusBadge status={exam.syllabusStatus} />
        </div>

        <h1 className="mt-3 font-display text-2xl font-bold leading-tight text-foreground sm:text-3xl lg:text-4xl">
          {exam.name}
        </h1>

        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>Conducted by {exam.authority}</span>
          {exam.state && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden /> {exam.state}
            </span>
          )}
        </p>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{exam.description}</p>

        {/* Honesty feature: preparation coverage */}
        {exam.contentNote && (
          <div className="mt-5 max-w-3xl rounded-xl border border-gold/30 bg-gold/5 p-4 sm:p-5" role="note">
            <p className="flex items-center gap-2 text-sm font-semibold text-gold">
              <Info className="h-4 w-4 shrink-0" aria-hidden /> Preparation coverage
            </p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">{exam.contentNote}</p>
          </div>
        )}

        {/* Official source links */}
        {exam.sourceRefs && exam.sourceRefs.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Official sources</span>
            {exam.sourceRefs.map(ref => (
              <a
                key={ref.url}
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-gold/40 hover:text-gold"
              >
                {ref.label} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <CountPill label="topics" value={exam.counts.topics} />
          <CountPill label="notes" value={exam.counts.notes} />
          <CountPill label="questions" value={exam.counts.questions} />
          <CountPill label="tests" value={exam.counts.tests} />
        </div>
      </header>

      {/* ─── Tabs ─── */}
      <div
        role="tablist"
        aria-label="Examination sections"
        className="mt-8 flex w-full gap-1.5 overflow-x-auto rounded-xl border border-border bg-card p-1.5"
      >
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`exam-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`exam-panel-${t.id}`}
            onClick={() => changeTab(t.id)}
            className={cn(
              'flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
              tab === t.id
                ? 'bg-elevated text-gold'
                : 'text-muted-foreground hover:bg-elevated/60 hover:text-foreground'
            )}
          >
            <t.icon className="h-3.5 w-3.5" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`exam-panel-${tab}`}
        aria-labelledby={`exam-tab-${tab}`}
        className="mt-6 focus-visible:outline-none"
      >
        {tab === 'overview' && <OverviewTab data={data} />}
        {tab === 'syllabus' && (
          <SyllabusTab
            data={data}
            pendingTopicId={pendingTopicId}
            onStartTopic={startTopicTest}
          />
        )}
        {tab === 'materials' && <MaterialsTab data={data} slug={slug} />}
        {tab === 'tests' && <TestsTab data={data} guestId={guestId} slug={slug} />}
      </div>
    </div>
  )
}

// ─── Overview tab ───
function OverviewTab({ data }: { data: ExamDetailDTO }) {
  return (
    <div className="space-y-8">
      <section aria-label="Selection stages and pattern">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Selection stages &amp; pattern</h2>
        {data.stages.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Stage structure for this examination is being mapped.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {data.stages.map(stage => (
              <Card key={stage.id} className="border-border bg-card">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">{stage.name}</h3>
                      {stage.paperNote && <p className="mt-1 text-xs text-muted-foreground">{stage.paperNote}</p>}
                    </div>
                    <CountPill label="subjects" value={stage.subjects.length} />
                  </div>
                  {stage.pattern ? (
                    <div className="mt-4">
                      <PatternTable pattern={stage.pattern} />
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs text-muted-foreground">
                      A detailed marking pattern for this stage is not published here yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Curated resources for this examination">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Curated resources for this examination</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          External material picked for this exam — every link states its verification status honestly.
        </p>
        {data.examResources.length > 0 ? (
          <div className="mt-4">
            <ResourceList resources={data.examResources} />
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No exam-level resources yet — topic-level resources are listed inside each topic in the Syllabus tab.
          </p>
        )}
      </section>
    </div>
  )
}

// ─── Syllabus tab ───
function SyllabusTab({
  data,
  pendingTopicId,
  onStartTopic,
}: {
  data: ExamDetailDTO
  pendingTopicId: string | null
  onStartTopic: (topic: TopicNode) => void
}) {
  return (
    <div className="space-y-8">
      <p className="rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        <span className="font-medium text-gold">How to read this syllabus:</span> topics marked with a gold
        <BookOpen className="mx-1 inline h-3 w-3" aria-hidden />
        badge have an original BEAN EXAMS study note; topics with a question count are ready to practise. Topics showing
        {' '}“material in progress” are mapped in the syllabus but their notes and questions are still being authored.
      </p>

      {data.stages.map(stage => (
        <section key={stage.id} aria-label={`${stage.name} syllabus`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-foreground sm:text-xl">{stage.name}</h3>
            <CountPill label="subjects" value={stage.subjects.length} />
          </div>
          {stage.paperNote && <p className="mt-1 text-xs text-muted-foreground">{stage.paperNote}</p>}
          {stage.subjects.length === 0 ? (
            <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              Subjects for this stage are being mapped.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {stage.subjects.map(subject => (
                <SubjectSyllabusCard
                  key={subject.id}
                  subject={subject}
                  pendingTopicId={pendingTopicId}
                  onStartTopic={onStartTopic}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// ─── Study Material tab ───
function MaterialsTab({ data, slug }: { data: ExamDetailDTO; slug: string }) {
  const navigate = useAppStore(s => s.navigate)
  const multiStage = data.stages.length > 1

  const rows = data.stages.flatMap(stage =>
    stage.subjects.map(subject => ({ stageName: stage.name, subject }))
  )

  return (
    <div className="space-y-8">
      {/* Honest navigation note */}
      <div className="rounded-xl border border-gold/25 bg-gold/5 p-4 sm:p-5" role="note">
        <p className="flex items-center gap-2 text-sm font-semibold text-gold">
          <Info className="h-4 w-4 shrink-0" aria-hidden /> How study material is organised
        </p>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          Study notes and curated resources are attached at the <strong>topic</strong> level. Open any topic from the
          Syllabus tab to read its original BEAN EXAMS note and see its verified external links — we list them there,
          on the exact syllabus line they support, instead of duplicating thousands of links on this page.
        </p>
      </div>

      {/* Notes coverage by subject */}
      <section aria-label="Notes coverage by subject">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Notes coverage by subject</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Where original BEAN EXAMS notes exist today, subject by subject.
        </p>
        {rows.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Subject structure for this examination is being mapped.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ stageName, subject }) => {
              const pct = subject.topicCount > 0
                ? Math.min(100, Math.round((subject.noteCount / subject.topicCount) * 100))
                : 0
              return (
                <Card key={subject.id} className="flex flex-col border-border bg-card">
                  <CardContent className="flex flex-1 flex-col p-4">
                    {multiStage && <p className="text-[11px] uppercase tracking-[0.14em] text-gold">{stageName}</p>}
                    <h3 className="mt-1 text-sm font-semibold leading-snug text-foreground">{subject.name}</h3>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <CountPill label="notes" value={subject.noteCount} />
                      <CountPill label="topics" value={subject.topicCount} />
                    </div>
                    <div
                      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-elevated"
                      role="img"
                      aria-label={`${pct}% of topics in ${subject.name} have study notes`}
                    >
                      <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">{pct}% of topics have notes</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full border-gold/40 text-gold hover:bg-gold/10"
                      onClick={() => navigate({ view: 'exam', slug, tab: 'syllabus' })}
                    >
                      Open topics in Syllabus <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Exam-level resources */}
      <section aria-label="Exam-level resources">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">Exam-level resources</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Official notifications, syllabus documents and trustworthy portals for this examination as a whole.
        </p>
        {data.examResources.length > 0 ? (
          <div className="mt-4">
            <ResourceList resources={data.examResources} />
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No exam-level resources yet.
          </p>
        )}
      </section>
    </div>
  )
}

// ─── Practice Tests tab ───
function TestsTab({
  data,
  guestId,
  slug,
}: {
  data: ExamDetailDTO
  guestId: string
  slug: string
}) {
  const navigate = useAppStore(s => s.navigate)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const startTemplate = (templateId: string) => {
    if (!guestId) {
      setErrorId(templateId)
      setErrorMessage('Your guest session is still initialising — try again in a moment.')
      return
    }
    if (pendingId) return
    setPendingId(templateId)
    setErrorId(null)
    setErrorMessage(null)
    api.startTest({ guestId, templateId })
      .then(r => navigate({ view: 'test', attemptId: r.attemptId }))
      .catch(e => {
        setErrorId(templateId)
        setErrorMessage(e.message)
        toast({ title: 'Could not start this test', description: e.message, variant: 'destructive' })
      })
      .finally(() => setPendingId(null))
  }

  if (data.templates.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No practice tests ready yet"
        description={`Full-length tests for ${data.exam.name} are still being authored. Topic-level practice is already available from the Syllabus tab.`}
        actionLabel="Explore the syllabus"
        onAction={() => navigate({ view: 'exam', slug, tab: 'syllabus' })}
      />
    )
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Timed, server-scored practice tests with this exam&apos;s own marking rules. If you leave a test unfinished,
        starting it again resumes exactly where you stopped.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {data.templates.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            pending={pendingId === template.id}
            error={errorId === template.id ? errorMessage : null}
            onStart={() => startTemplate(template.id)}
          />
        ))}
      </div>
      <p className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Play className="h-3 w-3 text-gold" aria-hidden />
        Prefer smaller chunks? Topic-level practice tests are available on every syllabus topic with 4+ questions.
      </p>
    </div>
  )
}

// ─── Loading skeleton ───
function ExamSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
      aria-busy="true"
      aria-label="Loading examination"
    >
      <Skeleton className="h-4 w-36 bg-elevated" />
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-6 w-28 rounded-full bg-elevated" />
        <Skeleton className="h-6 w-44 rounded-full bg-elevated" />
      </div>
      <Skeleton className="mt-4 h-10 w-full max-w-xl bg-elevated" />
      <Skeleton className="mt-3 h-4 w-64 bg-elevated" />
      <Skeleton className="mt-6 h-20 w-full max-w-3xl bg-elevated" />
      <div className="mt-8 flex gap-2">
        {TABS.map(t => (
          <Skeleton key={t.id} className="h-10 w-28 rounded-lg bg-elevated" />
        ))}
      </div>
      <div className="mt-6 space-y-4">
        <Skeleton className="h-48 w-full bg-elevated" />
        <Skeleton className="h-32 w-full bg-elevated" />
      </div>
    </div>
  )
}
