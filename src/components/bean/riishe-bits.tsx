'use client'

// Shared Riishe UI pieces: page-reference chips, formatting helpers, the
// pre-test summary card and the configurable generation panel. Used by the
// document workspace, the Practice builder and the Topics browser so every
// surface behaves identically.

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { QuestionCategoryDTO, RiisheTestDetailDTO } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react'

export const CATEGORY_LABEL: Record<string, string> = {
  FOUNDATION: 'Foundation',
  APPLICATION: 'Application',
  STATEMENT: 'Statement-based',
  MULTISTEP: 'Multi-step',
  MISCONCEPTION: 'Misconception check',
}

export const DIFFICULTY_LABEL: Record<string, string> = {
  MIXED: 'Mixed',
  FOUNDATIONAL: 'Foundational',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
}

// ─── Formatting helpers ───

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** [1,2,3,7] → "pages 1–3, 7" · [5] → "page 5" */
export function formatPageRefs(pages: number[]): string {
  const sorted = [...new Set(pages)].filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = cur
    prev = cur
  }
  const joined = parts.join(', ')
  return parts.length === 1 && !joined.includes('–') ? `page ${joined}` : `pages ${joined}`
}

const DEFAULT_WEIGHTS: Record<QuestionCategoryDTO, number> = {
  FOUNDATION: 10,
  APPLICATION: 15,
  STATEMENT: 10,
  MULTISTEP: 10,
  MISCONCEPTION: 5,
}

/** Same scaling the backend uses for the distribution preview. */
export function distributionLine(count: number, active: QuestionCategoryDTO[]): string {
  const weightSum = active.reduce((s, c) => s + DEFAULT_WEIGHTS[c], 0)
  const parts = active.map(c => `${Math.max(1, Math.round((DEFAULT_WEIGHTS[c] / weightSum) * count))} ${CATEGORY_LABEL[c].toLowerCase()}`)
  return parts.join(' · ')
}

// ─── Page references ───

/**
 * Clickable page-reference chips — every citation in analyses, provenance
 * lists and explanations opens the reader at exactly that page. The host
 * decides where "that page" lives (local reader overlay or a deep link into
 * the source document's workspace).
 */
export function PageRefChips({
  pages,
  onOpenPage,
  compact,
  printedOffset,
}: {
  pages: number[]
  onOpenPage: (page: number, docId?: string) => void
  compact?: boolean
  /** Optional printed-page offset (physical = printed + offset). When set, a
   *  chip also shows the page number the document itself prints, when known.
   *  Existing callers do not pass it and see the exact previous behaviour. */
  printedOffset?: number | null
}) {
  const sorted = [...new Set(pages)].filter(p => Number.isFinite(p) && p >= 1).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', compact && 'gap-1')}>
      {sorted.map(p => {
        const printed = printedOffset != null ? p - printedOffset : null
        return (
          <button
            key={p}
            type="button"
            onClick={() => onOpenPage(p)}
            title={`Open the document at page ${p}`}
            aria-label={`Open the document at page ${p}`}
            className="inline-flex min-h-6 items-center gap-1 rounded-full border border-gold/40 bg-card px-2 py-0.5 text-[11px] font-medium text-gold transition-colors hover:bg-gold/10"
          >
            <BookOpen className="h-3 w-3" aria-hidden /> page {p}
            {printed != null && printed >= 1 ? <span className="text-gold/70">· printed {printed}</span> : null}
          </button>
        )
      })}
    </span>
  )
}

// ─── Test lifecycle hook: poll a Riishe test until it settles ───

export function useRiisheTestPoll(testId: string | null, guestId: string) {
  const [loaded, setLoaded] = useState<{ key: string; data: RiisheTestDetailDTO } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!guestId || !testId) return
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const fetchOnce = () => {
      api
        .riisheTest(testId, guestId)
        .then(d => {
          if (!alive) return
          setLoaded({ key: testId, data: d })
          setError(null)
          if (timer && d.status !== 'QUEUED' && d.status !== 'GENERATING') {
            clearInterval(timer)
            timer = null
          }
        })
        .catch((e: unknown) => {
          if (!alive) return
          setError(e instanceof Error ? e.message : 'Could not load the practice set status.')
        })
    }
    fetchOnce()
    timer = setInterval(fetchOnce, 4000)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [guestId, testId])

  const test = loaded && loaded.key === testId ? loaded.data : null
  return { test, error }
}

// ─── Pre-test summary ───

export function PreTestSummaryCard({
  test,
  starting,
  onStart,
  onOpenPage,
}: {
  test: RiisheTestDetailDTO
  starting: boolean
  onStart: () => void
  onOpenPage: (page: number, docId?: string) => void
}) {
  const stats = test.stats
  const difficulty = stats?.byDifficulty
  const scoring = `+${test.config.marksPerQuestion} per correct${
    test.config.negativeMark > 0 ? `, −${test.config.negativeMark} per wrong answer` : ', no negative marking'
  }`
  const sourceDocs = test.sourceDocuments?.length ? test.sourceDocuments : [{ id: test.documentId, title: test.documentTitle, pageCount: null }]

  return (
    <div className="rounded-xl border border-gold/40 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground" title={test.title}>
            {test.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {sourceDocs.length === 1
              ? <>Source document: {test.documentTitle}</>
              : <>Sources: {sourceDocs.map(d => d.title).join(' · ')}</>}
            {test.weakFocus ? ' · weak-area focus' : ''}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 border-success/40 bg-success/10 text-success">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryItem label="Focus" value={test.focusTopics.length ? test.focusTopics.join(' · ') : 'Balanced mix across your selection'} />
        <SummaryItem
          label="Questions"
          value={
            stats
              ? `${test.questionCount} (validated ${stats.validated} of ${stats.generated} generated; ${stats.rejected} rejected by quality gates)`
              : String(test.questionCount)
          }
        />
        <SummaryItem
          label="Scoring"
          value={scoring}
          sub="Your chosen practice scoring — not tied to any official scheme"
        />
        <SummaryItem label="Time limit" value={test.config.timed ? `${test.config.durationMin} min` : 'No time limit'} />
      </div>

      {difficulty && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Difficulty:</span>
          <Badge variant="outline" className="border-success/40 text-success">EASY {difficulty.EASY}</Badge>
          <Badge variant="outline" className="border-gold/40 text-gold">MEDIUM {difficulty.MEDIUM}</Badge>
          <Badge variant="outline" className="border-destructive/40 text-destructive">HARD {difficulty.HARD}</Badge>
        </div>
      )}

      {/* Question provenance — page-level preview of the evidence used. The
          evidence quotes and the answer key stay hidden until submission. */}
      {test.questions.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-elevated">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Question provenance ({test.questions.length}) — topics and source pages
          </summary>
          <ul className="max-h-64 space-y-1 overflow-y-auto px-4 pb-3">
            {test.questions.map(q => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 py-2 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={q.text}>
                  <span className="font-semibold text-foreground">Q{q.order}</span>{' '}
                  {CATEGORY_LABEL[q.category] ?? q.category}
                  {q.topic ? ` · ${q.topic}` : ''}
                  {' · '}
                  {q.difficulty.toLowerCase()}
                </span>
                {(q.pageRefs ?? []).length > 0 && (
                  <PageRefChips
                    pages={q.pageRefs ?? []}
                    onOpenPage={page => onOpenPage(page, q.documentId)}
                    compact
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Button
        className="mt-5 bg-gold text-primary-foreground hover:bg-gold-hover"
        disabled={starting}
        onClick={onStart}
      >
        {starting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Opening…
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" aria-hidden /> Start Test
          </>
        )}
      </Button>
    </div>
  )
}

export function SummaryItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm text-foreground">{value}</p>
      {sub && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ─── History row ───

export function TestHistoryRow({
  test,
  starting,
  onSelect,
  onStart,
}: {
  test: { id: string; title: string; status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'; questionCount: number; requestedCount: number; createdAt: string; stats?: { validated: number } | null }
  starting: boolean
  onSelect: () => void
  onStart: () => void
}) {
  return (
    <li className="rounded-lg border border-border bg-elevated p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onSelect}
            className="group block max-w-full overflow-hidden rounded text-left"
            aria-label={`Show details for ${test.title}`}
          >
            <span className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-gold">
              {test.title}
            </span>
          </button>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {test.questionCount} question{test.questionCount === 1 ? '' : 's'}
              {test.stats ? ` · ${test.stats.validated} validated` : ''}
            </span>
            <span aria-hidden>·</span>
            <span>Created {formatDate(test.createdAt)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TestHistoryBadge status={test.status} />
          {test.status === 'READY' && (
            <Button
              size="sm"
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              disabled={starting}
              onClick={onStart}
              aria-label={`Start ${test.title}`}
            >
              {starting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Start Test
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

export function TestHistoryBadge({ status }: { status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED' }) {
  if (status === 'READY') {
    return (
      <Badge variant="outline" className="gap-1 border-success/40 bg-success/10 text-success">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready
      </Badge>
    )
  }
  if (status === 'FAILED') {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-destructive">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1.5 border-gold/40 bg-gold/10 text-gold">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" aria-hidden />
      {status === 'QUEUED' ? 'Queued' : 'Generating…'}
    </Badge>
  )
}

// ═══ Generator panel (workspace + practice builder) ═══

export interface GeneratorDoc {
  id: string
  title: string
  topics: { name: string; pages: number[] }[]
}

const COUNT_PRESETS = [10, 25, 50, 100] as const
const ALL_CATEGORIES: QuestionCategoryDTO[] = ['FOUNDATION', 'APPLICATION', 'STATEMENT', 'MULTISTEP', 'MISCONCEPTION']
const MARKS_OPTIONS = [1, 2, 4, 5] as const
const NEGATIVE_OPTIONS = [0, 0.25, 0.5, 1] as const

/**
 * The configurable question-generation interface (Step D). Works locked to a
 * single document (workspace) or across several documents (Practice builder).
 * Scoring is always an explicit student choice — there is no hidden exam
 * rule anywhere.
 */
export function RiisheGeneratorPanel({
  guestId,
  docs,
  locked,
  initialDocIds,
  initialTopics,
  onGenerated,
}: {
  guestId: string
  docs: GeneratorDoc[]
  /** Workspace mode: the document selection is fixed. */
  locked?: boolean
  initialDocIds?: string[]
  initialTopics?: string[]
  onGenerated: (testId: string, primaryDocId: string) => void
}) {
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(() => {
    if (locked) return docs.map(d => d.id)
    const init = (initialDocIds ?? []).filter(id => docs.some(d => d.id === id))
    return init.length > 0 ? init : []
  })
  const [selectedFocus, setSelectedFocus] = useState<string[]>(() => (initialTopics ?? []).slice(0, 8))
  const [count, setCount] = useState<number>(50)
  const [customCount, setCustomCount] = useState<string>('')
  const [difficulty, setDifficulty] = useState<'MIXED' | 'FOUNDATIONAL' | 'INTERMEDIATE' | 'ADVANCED'>('MIXED')
  const [activeCats, setActiveCats] = useState<QuestionCategoryDTO[]>([...ALL_CATEGORIES])
  const [timed, setTimed] = useState(true)
  const [durationMin, setDurationMin] = useState<string>('')
  const [marksPerQuestion, setMarksPerQuestion] = useState<number>(1)
  const [negativeMark, setNegativeMark] = useState<number>(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Topics offered for the focus: from every currently selected document
  const availableTopics = useMemo(() => {
    const map = new Map<string, { name: string; pages: number[] }>()
    for (const d of docs) {
      if (locked || selectedDocIds.includes(d.id)) {
        for (const t of d.topics) if (!map.has(t.name)) map.set(t.name, t)
      }
    }
    return [...map.values()]
  }, [docs, locked, selectedDocIds])

  const effectiveCount = useMemo(() => {
    if (count === 0) {
      const n = Math.floor(Number(customCount))
      return Number.isFinite(n) ? Math.min(100, Math.max(4, n)) : 0
    }
    return count
  }, [count, customCount])

  const toggleDoc = (id: string) => {
    if (locked) return
    setSelectedDocIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
    // Topics from deselected documents no longer apply
    setSelectedFocus(prev => {
      const doc = docs.find(d => d.id === id)
      if (!doc) return prev
      const removed = new Set(doc.topics.map(t => t.name))
      return prev.filter(t => !removed.has(t))
    })
  }

  const toggleFocus = (name: string) => {
    setSelectedFocus(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : prev.length >= 8 ? prev : [...prev, name],
    )
  }

  const toggleCat = (cat: QuestionCategoryDTO) => {
    setActiveCats(prev => {
      if (prev.includes(cat)) return prev.length > 1 ? prev.filter(c => c !== cat) : prev
      return [...ALL_CATEGORIES.filter(c => prev.includes(c) || c === cat)] as QuestionCategoryDTO[]
    })
  }

  const generate = () => {
    if (generating || selectedDocIds.length === 0 || effectiveCount < 4) return
    setGenerating(true)
    setError(null)
    api
      .generateRiisheTest({
        guestId,
        documentIds: selectedDocIds,
        focusTopics: selectedFocus.length ? selectedFocus : undefined,
        timed,
        durationMin: timed && durationMin ? Math.min(240, Math.max(5, Math.floor(Number(durationMin) || 0))) || undefined : undefined,
        count: effectiveCount,
        difficultyFocus: difficulty,
        categories: activeCats.length < ALL_CATEGORIES.length ? activeCats : undefined,
        scoring: { marksPerQuestion, negativeMark },
      })
      .then(r => {
        if (r.existing) {
          // Identical generation already running — surface it honestly
          setError('An identical generation is already running for this selection — showing it below.')
        }
        onGenerated(r.testId, selectedDocIds[0])
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not start generation.')
      })
      .finally(() => setGenerating(false))
  }

  return (
    <section aria-label="Generate a practice set" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-gold" aria-hidden /> Generate a practice set
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Questions are drawn strictly from the selected documents. Leave the topic focus empty for a balanced mix.
      </p>

      {/* Source documents */}
      {!locked && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Source documents <span className="normal-case tracking-normal">(at least one)</span>
          </p>
          {docs.length === 0 ? (
            <p className="mt-2 rounded-lg border border-border bg-elevated px-4 py-3 text-xs text-muted-foreground">
              No analysed materials yet — upload a PDF in My Materials first.
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {docs.map(d => {
                const active = selectedDocIds.includes(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDoc(d.id)}
                    className={cn(
                      'flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'border-gold/60 bg-gold/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-gold/40 hover:text-foreground',
                    )}
                  >
                    <span className="min-w-0 truncate font-medium">{d.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{d.topics.length} topics</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Topic focus */}
      {availableTopics.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Topic focus <span className="normal-case tracking-normal">(up to 8, optional)</span>
          </p>
          <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1" role="group" aria-label="Topic focus selector">
            {availableTopics.map(t => {
              const active = selectedFocus.includes(t.name)
              return (
                <button
                  key={t.name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleFocus(t.name)}
                  title={t.pages.length ? formatPageRefs(t.pages) : undefined}
                  className={cn(
                    'min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors',
                    active
                      ? 'border-gold/60 bg-gold/15 text-gold'
                      : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                  )}
                >
                  {t.name}
                </button>
              )
            })}
          </div>
          {selectedFocus.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Balanced mix across the selected content.</p>
          )}
        </div>
      )}

      {/* Count + difficulty */}
      <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Questions</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Question count">
            {COUNT_PRESETS.map(n => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                className={cn(
                  'min-h-9 rounded-lg border px-4 py-1.5 text-sm transition-colors',
                  count === n
                    ? 'border-gold/60 bg-gold/15 text-gold'
                    : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={count === 0}
              onClick={() => setCount(0)}
              className={cn(
                'min-h-9 rounded-lg border px-4 py-1.5 text-sm transition-colors',
                count === 0
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
              )}
            >
              Custom
            </button>
          </div>
          {count === 0 && (
            <Input
              type="number"
              min={4}
              max={100}
              value={customCount}
              onChange={e => setCustomCount(e.target.value)}
              placeholder="4–100"
              aria-label="Custom question count"
              className="mt-2 h-9 w-28"
            />
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Difficulty</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Difficulty emphasis">
            {(['MIXED', 'FOUNDATIONAL', 'INTERMEDIATE', 'ADVANCED'] as const).map(d => (
              <button
                key={d}
                type="button"
                aria-pressed={difficulty === d}
                onClick={() => setDifficulty(d)}
                className={cn(
                  'min-h-9 rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                  difficulty === d
                    ? 'border-gold/60 bg-gold/15 text-gold'
                    : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                )}
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Question-type mix */}
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Question types</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Question type mix">
          {ALL_CATEGORIES.map(cat => {
            const active = activeCats.includes(cat)
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => toggleCat(cat)}
                className={cn(
                  'min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors',
                  active
                    ? 'border-gold/60 bg-gold/15 text-gold'
                    : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold line-through',
                )}
              >
                {CATEGORY_LABEL[cat]}
              </button>
            )
          })}
        </div>
        <p className="mt-2 rounded-lg border border-border bg-elevated px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Planned mix: </span>
          {distributionLine(effectiveCount || 50, activeCats)}
          {effectiveCount !== 50 ? ` — scaled to ${effectiveCount} questions` : ''}
        </p>
      </div>

      {/* Time + scoring */}
      <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Time</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Timing mode">
            <button
              type="button"
              aria-pressed={timed}
              onClick={() => setTimed(true)}
              className={cn(
                'min-h-9 rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                timed ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
              )}
            >
              Timed
            </button>
            <button
              type="button"
              aria-pressed={!timed}
              onClick={() => setTimed(false)}
              className={cn(
                'min-h-9 rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                !timed ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
              )}
            >
              Untimed
            </button>
          </div>
          {timed && (
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="riishe-duration" className="text-xs text-muted-foreground">
                Minutes
              </Label>
              <Input
                id="riishe-duration"
                type="number"
                min={5}
                max={240}
                value={durationMin}
                onChange={e => setDurationMin(e.target.value)}
                placeholder={`auto ≈ ${effectiveCount || 50}`}
                className="h-9 w-28"
              />
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Scoring <span className="normal-case tracking-normal">(your choice)</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Marks per correct answer">
              <span className="text-xs text-muted-foreground">Correct:</span>
              {MARKS_OPTIONS.map(m => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={marksPerQuestion === m}
                  onClick={() => setMarksPerQuestion(m)}
                  className={cn(
                    'min-h-8 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    marksPerQuestion === m
                      ? 'border-gold/60 bg-gold/15 text-gold'
                      : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                  )}
                >
                  +{m}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Negative marking">
              <span className="text-xs text-muted-foreground">Wrong:</span>
              {NEGATIVE_OPTIONS.map(n => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={negativeMark === n}
                  onClick={() => setNegativeMark(n)}
                  className={cn(
                    'min-h-8 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    negativeMark === n
                      ? 'border-gold/60 bg-gold/15 text-gold'
                      : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                  )}
                >
                  {n === 0 ? 'no penalty' : `−${n}`}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Practice scoring is exactly what you choose here — no exam-specific rules are applied implicitly.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button
        className="mt-4 bg-gold text-primary-foreground hover:bg-gold-hover"
        disabled={generating || selectedDocIds.length === 0 || effectiveCount < 4}
        onClick={generate}
      >
        {generating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Starting generation…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Generate {effectiveCount || '…'} Questions
          </>
        )}
      </Button>
      {!locked && selectedDocIds.length === 0 && docs.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 text-gold" aria-hidden /> Select at least one source document to generate.
        </p>
      )}
    </section>
  )
}

// ─── Active test states (progress / failure) ───

export function TestPendingCard({ status, statusDetail }: { status: 'QUEUED' | 'GENERATING'; statusDetail?: string | null }) {
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/5 p-5 sm:p-6" role="status">
      <p className="flex items-center gap-2 text-sm font-medium text-gold">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {status === 'QUEUED' ? 'Queued — waiting for the generator…' : 'Generating questions…'}
      </p>
      {/* Honest progress: a pulsing bar, never a fake percentage */}
      <div className="mt-3 h-2 overflow-hidden rounded bg-elevated" aria-hidden>
        <div className="h-full w-1/3 animate-pulse rounded bg-gold/60" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {statusDetail ??
          'Validated questions are generated in batches — this updates automatically. No percentage is shown because the remaining work is not predictable.'}
      </p>
    </div>
  )
}

export function TestFailedCard({ statusDetail, onRetry, disabled }: { statusDetail?: string | null; onRetry: () => void; disabled?: boolean }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 sm:p-6" role="alert">
      <p className="font-display text-lg font-semibold text-destructive">Generation failed</p>
      <p className="mt-2 text-sm leading-relaxed text-destructive/90">
        {statusDetail ?? 'Riishe could not produce enough validated questions from this selection.'}
      </p>
      <Button
        variant="outline"
        className="mt-4 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onRetry}
        disabled={disabled}
      >
        <RotateCcw className="mr-1.5 h-4 w-4" /> Try again
      </Button>
    </div>
  )
}

export function TestSkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-hidden>
      <Skeleton className="h-6 w-1/2 bg-elevated" />
      <Skeleton className="mt-4 h-24 bg-elevated" />
    </div>
  )
}

export function HistoryIcon() {
  return <ClipboardList className="h-4 w-4 text-gold" aria-hidden />
}
