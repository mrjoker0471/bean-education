'use client'

// Exam detail view — THE THREE-LAYER LEARNING SYSTEM.
// Layer 1: Study Material + official PDFs   → tab "study"
// Layer 2: BEAN Intelligence                → tab "intelligence"
// Layer 3: Practice Exam                    → tab "practice"
// The exam header (breadcrumbs, authority, pattern, honest coverage status)
// stays above the tabs; syllabus/pattern detail lives inside Layer 1.
// Legacy deep links (?tab=overview|syllabus|materials|tests) still resolve.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ExamDetailDTO, ResourceDTO, TopicNode } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { CountPill } from '@/components/bean/count-pill'
import { EmptyState } from '@/components/bean/empty-state'
import { SyllabusStatusBadge } from '@/components/bean/status-badge'
import {
  negativeMarkText,
  isOfficialDoc,
  DocumentCard,
  PatternSummaryStrip,
  PatternTable,
  ResourceList,
  StudySubjectCard,
  TemplateCard,
  type FocusTopic,
} from '@/components/bean/exam-parts'
import { BeanChatPanel } from '@/components/bean/bean-chat-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Compass,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

const TAB_IDS = ['study', 'intelligence', 'practice'] as const
type TabId = (typeof TAB_IDS)[number]

const TABS: { id: TabId; label: string; sub: string; icon: typeof BookOpen }[] = [
  { id: 'study', label: 'Study Material', sub: 'Notes + official PDFs', icon: BookOpen },
  { id: 'intelligence', label: 'BEAN Intelligence', sub: 'AI tutor for this exam', icon: Sparkles },
  { id: 'practice', label: 'Practice Exam', sub: 'Timed, real scoring', icon: ClipboardList },
]

/** New tabs with graceful handling of legacy deep links. */
function normalizeTab(tab: string | undefined): TabId {
  switch (tab) {
    case 'study': case 'intelligence': case 'practice':
      return tab
    case 'overview': case 'syllabus': case 'materials':
      return 'study'
    case 'tests': case 'practice-exam':
      return 'practice'
    case 'bean':
      return 'intelligence'
    default:
      return 'study'
  }
}

export function ExamView({ slug, initialTab }: { slug: string; initialTab?: string }) {
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)

  const [reloadToken, setReloadToken] = useState(0)
  const [tab, setTab] = useState<TabId>(normalizeTab(initialTab))
  const [pendingTopicId, setPendingTopicId] = useState<string | null>(null)
  // The selected topic shared across the three layers (Study ⇄ Intelligence ⇄ Practice)
  const [focusTopic, setFocusTopic] = useState<FocusTopic | null>(null)

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
    navigate({ view: 'exam', slug, tab: next === 'study' ? undefined : next })
  }

  /** Layer-crossing: focus a topic and hand its full context to BEAN Intelligence. */
  const focusOnTopic = (t: FocusTopic, noteTitle?: string) => {
    setFocusTopic(t)
    useAppStore.getState().setBeanContext({
      examSlug: slug,
      examName: data?.exam.name,
      stageName: t.stageName,
      subjectName: t.subjectName,
      topicId: t.id,
      topicName: t.name,
      noteTitle,
    })
    changeTab('intelligence')
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
            description={`No examination lives at “${slug}” in the BEAN Education catalogue. It may have been renamed — browse the catalogue to find what you need.`}
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
  const officialDocs = data.examResources.filter(isOfficialDoc)
  // Subject-wise syllabus PDFs (37 for CUET UG) get their own compact section
  const primaryDocs = officialDocs.filter(r => r.type !== 'OFFICIAL_SUBJECT_SYLLABUS')
  const subjectSyllabusDocs = officialDocs.filter(r => r.type === 'OFFICIAL_SUBJECT_SYLLABUS')
  const otherExamResources = data.examResources.filter(r => !isOfficialDoc(r))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      {/* ─── Header ─── */}
      <header>
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground sm:text-sm">
          <button type="button" onClick={() => navigate({ view: 'home' })} className="transition-colors hover:text-gold">
            Home
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
          <button type="button" onClick={() => navigate({ view: 'catalog' })} className="transition-colors hover:text-gold">
            All examinations
          </button>
          {exam.categoryName && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
              <button
                type="button"
                onClick={() => navigate({ view: 'catalog', category: exam.categorySlug })}
                className="transition-colors hover:text-gold"
              >
                {exam.categoryName}
              </button>
            </>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
          <span aria-current="page" className="font-medium text-foreground">{exam.shortName ?? exam.name}</span>
        </nav>

        <button
          type="button"
          onClick={() => navigate({ view: 'catalog' })}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-gold"
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
          {exam.state && <span>{exam.state}</span>}
        </p>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{exam.description}</p>

        {/* Exam pattern summary — always visible above the three learning tabs */}
        <PatternSummaryStrip stages={data.stages} />

        {/* Honesty feature: preparation coverage */}
        {exam.contentNote && (
          <div className="mt-5 max-w-3xl rounded-xl border border-gold/30 bg-gold/5 p-4 sm:p-5" role="note">
            <p className="flex items-center gap-2 text-sm font-semibold text-gold">
              <Info className="h-4 w-4 shrink-0" aria-hidden /> Honest coverage status
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

      {/* ─── THE THREE LEARNING LAYERS ─── */}
      <div
        role="tablist"
        aria-label="Learning layers"
        className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
      >
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`exam-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`exam-panel-${t.id}`}
              onClick={() => changeTab(t.id)}
              className={cn(
                'group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                active
                  ? 'border-gold bg-gold/10 shadow-[0_0_0_1px_rgba(214,165,20,0.35)]'
                  : 'border-border bg-card hover:border-gold/40 hover:bg-elevated'
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                  active ? 'border-gold/50 bg-gold/15' : 'border-border bg-elevated'
                )}
              >
                <t.icon className={cn('h-4 w-4', active ? 'text-gold' : 'text-muted-foreground')} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold sm:text-base', active ? 'text-gold' : 'text-foreground')}>
                  {t.label}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">{t.sub}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`exam-panel-${tab}`}
        aria-labelledby={`exam-tab-${tab}`}
        className="mt-8 focus-visible:outline-none"
      >
        {tab === 'study' && (
          <StudyTab
            data={data}
            officialDocs={primaryDocs}
            subjectSyllabusDocs={subjectSyllabusDocs}
            otherExamResources={otherExamResources}
            pendingTopicId={pendingTopicId}
            onStartTopicTest={startTopicTest}
            onFocusTopic={focusOnTopic}
          />
        )}
        {tab === 'intelligence' && (
          <IntelligenceTab
            data={data}
            slug={slug}
            focusTopic={focusTopic}
            onFocusTopic={focusOnTopic}
            pendingTopicId={pendingTopicId}
            onStartTopicTest={startTopicTest}
            onGoPractice={() => changeTab('practice')}
          />
        )}
        {tab === 'practice' && (
          <PracticeTab
            data={data}
            guestId={guestId}
            slug={slug}
            focusTopic={focusTopic}
          />
        )}
      </div>
    </div>
  )
}

// ═══ LAYER 1 — STUDY MATERIAL + OFFICIAL PDFS ═══════════════════════════════
function StudyTab({
  data,
  officialDocs,
  subjectSyllabusDocs,
  otherExamResources,
  pendingTopicId,
  onStartTopicTest,
  onFocusTopic,
}: {
  data: ExamDetailDTO
  officialDocs: ResourceDTO[]
  subjectSyllabusDocs: ResourceDTO[]
  otherExamResources: ResourceDTO[]
  pendingTopicId: string | null
  onStartTopicTest: (topic: TopicNode) => void
  onFocusTopic: (t: FocusTopic, noteTitle?: string) => void
}) {
  const multiStage = data.stages.length > 1
  const [stageIdx, setStageIdx] = useState(0)
  const stage = data.stages[Math.min(stageIdx, data.stages.length - 1)]

  return (
    <div className="space-y-10">
      {/* ── Official documents & PDFs ── */}
      <section aria-labelledby="official-docs-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="official-docs-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
            Official documents &amp; PDFs
          </h2>
          {officialDocs.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {officialDocs.length} document{officialDocs.length === 1 ? '' : 's'} for {data.exam.shortName ?? 'this exam'}
            </span>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Syllabus documents, information bulletins and portals from the conducting authority — plus legitimate
          public-domain textbook archives. Each card states its issuing authority, type, language and real
          verification status. Pages open as pages; a direct PDF download is offered only when a stable official
          file is confirmed.
        </p>

        {officialDocs.length > 0 ? (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {officialDocs.map(r => <DocumentCard key={r.id} resource={r} />)}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={Landmark}
              title="No official documents registered for this exam yet"
              description="We haven't verified an official syllabus PDF or bulletin link for this examination yet. The official sources above the tabs are the current best pointer — we never fabricate document links or verification statuses."
            />
          </div>
        )}

        {subjectSyllabusDocs.length > 0 && (
          <div className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="subject-syllabus-heading" className="font-display text-base font-semibold text-foreground sm:text-lg">
                Subject-wise official syllabus PDFs
              </h3>
              <span className="text-xs text-muted-foreground">
                {subjectSyllabusDocs.length} official document{subjectSyllabusDocs.length === 1 ? '' : 's'} — direct NTA downloads
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              One official syllabus PDF per subject, exactly as published by {data.exam.authority} for the current cycle.
              Each card offers a direct download — verified as a real PDF file, never a disguised webpage.
            </p>
            <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {subjectSyllabusDocs.map(r => <DocumentCard key={r.id} resource={r} />)}
            </ul>
          </div>
        )}

        {officialDocs.some(d => d.verificationStatus === 'UNREACHABLE') && (
          <p className="mt-3 rounded-lg border border-border bg-card px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-success" aria-hidden />
            Some official sites block automated checks from our servers, so their status may read &ldquo;unreachable&rdquo;
            even though the link is the authority&apos;s real, current page. Statuses reflect our last actual check —
            they are never assumed.
          </p>
        )}
      </section>

      {/* ── Exam pattern & selection stages ── */}
      <section aria-labelledby="pattern-heading">
        <h2 id="pattern-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
          Exam pattern &amp; selection stages
        </h2>
        {data.stages.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Stage structure for this examination is being mapped.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {data.stages.map(s => (
              <Card key={s.id} className="border-border bg-card">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">{s.name}</h3>
                      {s.paperNote && <p className="mt-1 text-xs text-muted-foreground">{s.paperNote}</p>}
                    </div>
                    <CountPill label="subjects" value={s.subjects.length} />
                  </div>
                  {s.pattern ? (
                    <div className="mt-4">
                      <PatternTable pattern={s.pattern} />
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

      {/* ── Syllabus & topic-wise study notes ── */}
      <section aria-labelledby="syllabus-heading">
        <h2 id="syllabus-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
          Syllabus &amp; topic-wise study notes
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Expand any topic to read its original BEAN Education note right here, see its verified documents, and jump
          into practice or BEAN Intelligence with the topic&apos;s context carried over.
        </p>

        {multiStage && (
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Selection stage">
            {data.stages.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === stageIdx}
                onClick={() => setStageIdx(i)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors sm:text-[13px]',
                  i === stageIdx
                    ? 'border-gold/60 bg-gold/10 text-gold'
                    : 'border-border bg-elevated text-muted-foreground hover:border-gold/40 hover:text-foreground'
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {!stage || stage.subjects.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Subjects for this stage are being mapped.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {stage.subjects.map(subject => (
              <StudySubjectCard
                key={subject.id}
                subject={subject}
                stageName={stage.name}
                examName={data.exam.name}
                pendingTopicId={pendingTopicId}
                onStartTopic={onStartTopicTest}
                onFocusTopic={onFocusTopic}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Other curated exam-level resources ── */}
      {otherExamResources.length > 0 && (
        <section aria-labelledby="other-resources-heading">
          <h2 id="other-resources-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
            More curated resources for this examination
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Topic-level resources live inside each topic above — these are exam-wide picks.
          </p>
          <div className="mt-4">
            <ResourceList resources={otherExamResources} />
          </div>
        </section>
      )}
    </div>
  )
}

// ═══ LAYER 2 — BEAN INTELLIGENCE ════════════════════════════════════════════
function IntelligenceTab({
  data,
  focusTopic,
  onFocusTopic,
  pendingTopicId,
  onStartTopicTest,
  onGoPractice,
}: {
  data: ExamDetailDTO
  slug: string
  focusTopic: FocusTopic | null
  onFocusTopic: (t: FocusTopic, noteTitle?: string) => void
  pendingTopicId: string | null
  onStartTopicTest: (topic: TopicNode) => void
  onGoPractice: () => void
}) {
  const navigate = useAppStore(s => s.navigate)

  // Focusable topics: anything with a note or questions, labelled "Subject › Topic"
  const focusOptions = data.stages.flatMap(s =>
    s.subjects.flatMap(su =>
      su.units.flatMap(u =>
        u.topics
          .filter(t => t.noteAvailable || t.questionCount > 0)
          .map(t => ({
            id: t.id,
            label: `${su.name} › ${t.name}`,
            stageName: s.name,
            subjectName: su.name,
            name: t.name,
          }))
      )
    )
  )

  const greeting = focusTopic
    ? `Hello! I'm BEAN Intelligence. You're focusing on "${focusTopic.name}" from ${data.exam.shortName ?? data.exam.name}${focusTopic.subjectName ? ` (${focusTopic.subjectName})` : ''} — its study note is attached as grounding when available. Ask me to explain it, simplify it, quiz you on it, or plan your revision.`
    : `Hello! I'm BEAN Intelligence, focused on ${data.exam.shortName ?? data.exam.name}. Ask me about its syllabus, exam pattern or any topic — or pick a focus topic below and I'll ground my answers in its study note.`

  return (
    <div className="mx-auto max-w-4xl">
      {/* Focus topic chooser + return paths */}
      <div className="rounded-xl border border-gold/25 bg-gold/5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <label htmlFor="focus-topic" className="text-sm font-semibold text-foreground">
              Focus topic for this session
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The chosen topic&apos;s study note is supplied to BEAN as grounding. {focusOptions.length} topics available for {data.exam.shortName ?? data.exam.name}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {focusTopic && (
              <Button
                size="sm"
                variant="outline"
                className="border-gold/40 text-gold hover:bg-gold/10"
                onClick={() => navigate({ view: 'topic', topicId: focusTopic.id })}
              >
                <BookOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open topic workspace
              </Button>
            )}
            {focusTopic && (
              <Button
                size="sm"
                variant="outline"
                className="border-gold/40 text-gold hover:bg-gold/10"
                onClick={() => {
                  const node = data.stages
                    .flatMap(s => s.subjects.flatMap(su => su.units.flatMap(u => u.topics)))
                    .find(t => t.id === focusTopic.id)
                  if (node) onStartTopicTest(node)
                }}
                disabled={pendingTopicId !== null}
              >
                {pendingTopicId
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                Practice this topic
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground"
              onClick={onGoPractice}
            >
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Go to Practice Exam
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <select
            id="focus-topic"
            value={focusTopic?.id ?? ''}
            onChange={e => {
              const opt = focusOptions.find(o => o.id === e.target.value)
              if (opt) onFocusTopic({ id: opt.id, name: opt.name, stageName: opt.stageName, subjectName: opt.subjectName })
            }}
            className="h-10 w-full rounded-lg border border-border bg-elevated px-3 text-sm text-foreground focus:border-gold/50 focus:outline-none"
          >
            <option value="">Whole exam — {data.exam.name}</option>
            {focusOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5">
        <BeanChatPanel variant="embedded" greeting={greeting} />
      </div>
    </div>
  )
}

// ═══ LAYER 3 — PRACTICE EXAM ════════════════════════════════════════════════
function PracticeTab({
  data,
  guestId,
  slug,
  focusTopic,
}: {
  data: ExamDetailDTO
  guestId: string
  slug: string
  focusTopic: FocusTopic | null
}) {
  const navigate = useAppStore(s => s.navigate)

  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const runStart = (key: string, start: () => Promise<{ attemptId: string }>) => {
    if (!guestId) {
      setErrorMessage('Your guest session is still initialising — try again in a moment.')
      return
    }
    if (pendingId) return
    setPendingId(key)
    setErrorMessage(null)
    start()
      .then(r => navigate({ view: 'test', attemptId: r.attemptId }))
      .catch(e => {
        setErrorMessage(e.message)
        toast({ title: 'Could not start this test', description: e.message, variant: 'destructive' })
      })
      .finally(() => setPendingId(null))
  }

  const startTemplate = (templateId: string) =>
    runStart(templateId, () => api.startTest({ guestId, templateId }))

  const startRevision = () =>
    runStart('REVISION', () => api.startTest({ guestId, examId: data.exam.id, type: 'REVISION' }))

  const startTopic = (topicId: string) =>
    runStart(topicId, () => api.startTest({ guestId, topicId }))

  const mocks = data.templates.filter(t => t.type === 'MIXED')
  const subjectTests = data.templates.filter(t => t.type === 'SUBJECT')
  const subjectGroups = new Map<string, typeof subjectTests>()
  for (const tpl of subjectTests) {
    const key = tpl.stageName ?? 'Practice tests'
    const list = subjectGroups.get(key) ?? []
    list.push(tpl)
    subjectGroups.set(key, list)
  }

  // Practicable topics for the topic-practice picker
  const practicable = data.stages
    .flatMap(s =>
      s.subjects.map(su => ({
        subject: su,
        topics: su.units.flatMap(u => u.topics).filter(t => t.questionCount >= 4),
      }))
    )
    .filter(g => g.topics.length > 0)
  const [subjectIdx, setSubjectIdx] = useState(0)
  const activeGroup = practicable[Math.min(subjectIdx, practicable.length - 1)]

  return (
    <div className="space-y-10">
      {/* Start failures surface here + as a toast */}
      {errorMessage && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      {/* ── Full mock ── */}
      <section aria-labelledby="mock-heading">
        <h2 id="mock-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
          Full-exam mock
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mixed questions across the syllabus, this exam&apos;s own marking rules, server-timed.
        </p>
        {mocks.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {mocks.map(t => (
              <TemplateCard key={t.id} template={t} pending={pendingId === t.id} error={null} onStart={() => startTemplate(t.id)} />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            A full-length mock needs at least 15 questions in the bank — this exam&apos;s mixed practice unlocks as
            authoring progresses. Subject and topic tests below are available today.
          </p>
        )}
      </section>

      {/* ── Subject tests ── */}
      <section aria-labelledby="subject-tests-heading">
        <h2 id="subject-tests-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
          Subject tests
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One test per subject with enough authored questions — the same marking rules as the full exam.
        </p>
        {subjectTests.length > 0 ? (
          [...subjectGroups.entries()].map(([stageName, list]) => (
            <div key={stageName} className="mt-4">
              {subjectGroups.size > 1 && (
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-gold">{stageName}</h3>
              )}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {list.map(t => (
                  <TemplateCard key={t.id} template={t} pending={pendingId === t.id} error={null} onStart={() => startTemplate(t.id)} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No subject has reached the 5-question minimum for its own test yet — topic practice below is the
            fastest way in.
          </p>
        )}
      </section>

      {/* ── Topic practice ── */}
      <section aria-labelledby="topic-practice-heading">
        <h2 id="topic-practice-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
          Topic practice
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Short tests on a single syllabus topic — pick a subject, then a topic with questions ready.
        </p>
        {practicable.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No topic has 4+ questions yet. Questions are being authored — subject and mixed tests above cover
            what exists today.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Choose a subject">
              {practicable.map((g, i) => (
                <button
                  key={g.subject.id}
                  type="button"
                  role="tab"
                  aria-selected={i === subjectIdx}
                  onClick={() => setSubjectIdx(i)}
                  className={cn(
                    'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors sm:text-[13px]',
                    i === subjectIdx
                      ? 'border-gold/60 bg-gold/10 text-gold'
                      : 'border-border bg-elevated text-muted-foreground hover:border-gold/40 hover:text-foreground'
                  )}
                >
                  {g.subject.name} ({g.topics.length})
                </button>
              ))}
            </div>
            {activeGroup && (
              <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap gap-2">
                  {activeGroup.topics.map(topic => (
                    <button
                      key={topic.id}
                      type="button"
                      disabled={pendingId === topic.id}
                      onClick={() => startTopic(topic.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1.5 text-xs text-foreground transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-50 sm:text-[13px]"
                      aria-label={`Start topic practice: ${topic.name} (${topic.questionCount} questions available)`}
                    >
                      {pendingId === topic.id
                        ? <Loader2 className="h-3 w-3 animate-spin text-gold" aria-hidden />
                        : <Play className="h-3 w-3 text-gold" aria-hidden />}
                      {topic.name}
                      <span className="text-[11px] text-muted-foreground">· {topic.questionCount}Q</span>
                    </button>
                  ))}
                </div>
                {errorMessage && (
                  <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {errorMessage}
                  </p>
                )}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Looking for a topic without practice questions? It&apos;s in the syllabus under Study Material — notes
              may still be readable there.
            </p>
          </>
        )}
      </section>

      {/* ── Revision test (from my mistakes) ── */}
      <RevisionSection
        examId={data.exam.id}
        examName={data.exam.shortName ?? data.exam.name}
        guestId={guestId}
        pending={pendingId === 'REVISION'}
        onStart={startRevision}
      />

      {/* ── Previous-year papers & question integrity ── */}
      <section aria-labelledby="pyq-heading">
        <h2 id="pyq-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
          Previous-year papers &amp; question integrity
        </h2>
        <div className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1 text-xs text-foreground">
              <FileText className="h-3.5 w-3.5 text-gold" aria-hidden /> Original practice: {data.exam.questionSources?.ORIGINAL ?? 0}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs text-success">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> PYQ verified: {data.exam.questionSources?.PYQ_VERIFIED ?? 0}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" aria-hidden /> Provenance uncertain: {data.exam.questionSources?.PYQ_UNVERIFIED ?? 0}
            </span>
          </div>
          {(data.exam.questionSources?.PYQ_VERIFIED ?? 0) === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              No verified previous-year questions are in this exam&apos;s bank yet, so there is no &ldquo;previous-year
              paper&rdquo; mode to offer — and we will not label unverified material as PYQ. Every question above is an
              original BEAN Education practice question with an author-verified answer. Official previous papers, where
              the authority publishes them, are linked under Study Material &rsaquo; Official documents.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Verified previous-year questions appear inside topic practice and mixed tests, always labelled with
              their source paper and year in the answer review.
            </p>
          )}
          <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            Marking rules follow this exam&apos;s actual pattern —
            {' '}{data.stages.filter(s => s.pattern).map(s => `${s.name}: ${negativeMarkText(s.pattern!.negativeMark)}`).join(' · ') || 'per-stage patterns are being mapped'}.
          </p>
        </div>
      </section>

      {/* Keep focus context visible when arriving from Intelligence/Study */}
      {focusTopic && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 text-gold" aria-hidden />
          Focused topic: <span className="font-medium text-foreground">{focusTopic.name}</span> — find it under Topic practice above, or
          <button type="button" onClick={() => navigate({ view: 'topic', topicId: focusTopic.id })} className="text-gold hover:underline">
            open its workspace
          </button>.
        </p>
      )}
    </div>
  )
}

// ─── Revision section (lazy check against this guest's wrong answers) ────────
function RevisionSection({
  examId,
  examName,
  guestId,
  pending,
  onStart,
}: {
  examId: string
  examName: string
  guestId: string
  pending: boolean
  onStart: () => void
}) {
  const loadKey = `${examId}|${guestId}`
  const [loaded, setLoaded] = useState<{ key: string; count: number; ready: boolean } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)

  const data = loaded && loaded.key === `${loadKey}|${retry}` ? loaded : null
  const failure = failed && failed.key === `${loadKey}|${retry}` ? failed.message : null

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api.revisionCheck(examId, guestId)
      .then(r => { if (alive) setLoaded({ key: `${loadKey}|${retry}`, count: r.count, ready: r.ready }) })
      .catch(e => { if (alive) setFailed({ key: `${loadKey}|${retry}`, message: e.message }) })
    return () => { alive = false }
  }, [loadKey, retry, guestId, examId])

  return (
    <section aria-labelledby="revision-heading">
      <h2 id="revision-heading" className="font-display text-lg font-semibold text-foreground sm:text-xl">
        Revision test — built from your mistakes
      </h2>
      <Card className="mt-4 border-gold/25 bg-gradient-to-b from-gold/10 to-transparent">
        <CardContent className="p-4 sm:p-5">
          {!guestId || (!data && !failure) ? (
            <div className="space-y-2" aria-busy="true" aria-label="Checking revision availability">
              <Skeleton className="h-4 w-64 bg-elevated" />
              <Skeleton className="h-10 w-48 bg-elevated" />
            </div>
          ) : failure ? (
            <div>
              <p role="alert" className="text-sm text-destructive">{failure}</p>
              <Button size="sm" variant="outline" className="mt-3 border-gold/40 text-gold hover:bg-gold/10" onClick={() => setRetry(r => r + 1)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
              </Button>
            </div>
          ) : data && data.ready ? (
            <>
              <p className="text-sm leading-relaxed text-foreground/90">
                You have <span className="font-semibold text-gold">{data.count} wrong answer{data.count === 1 ? '' : 's'}</span> saved
                from real attempts in {examName}. This test rebuilds from exactly those questions — the honest way to
                close gaps.
              </p>
              <Button
                size="lg"
                className="mt-4 w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto"
                onClick={onStart}
                disabled={pending}
              >
                {pending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Building your revision test…</>
                  : <><RotateCcw className="mr-2 h-4 w-4" /> Start revision test ({Math.min(15, data.count)} questions)</>}
              </Button>
            </>
          ) : data ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {data.count === 0
                ? `Revision tests are built from your own wrong answers in ${examName}. Take a practice test first — this card activates automatically once you've made (and we've saved) a few mistakes.`
                : `${data.count} wrong answer${data.count === 1 ? '' : 's'} saved so far — a revision test unlocks at 4. Keep practising.`}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
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
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TABS.map(t => (
          <Skeleton key={t.id} className="h-16 rounded-xl bg-elevated" />
        ))}
      </div>
      <div className="mt-8 space-y-4">
        <Skeleton className="h-48 w-full bg-elevated" />
        <Skeleton className="h-32 w-full bg-elevated" />
      </div>
    </div>
  )
}
