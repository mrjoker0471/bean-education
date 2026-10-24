'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { CatalogResponse, ExamListItem } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { SectionHeading } from '@/components/bean/section-heading'
import { ExamCard } from '@/components/bean/exam-card'
import { CountPill } from '@/components/bean/count-pill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/bean/empty-state'
import { cn } from '@/lib/utils'
import {
  BookOpen, Brain, ChevronRight, ClipboardCheck, GraduationCap, LineChart,
  Lock, Search, Sparkles, X, RotateCcw,
} from 'lucide-react'

export function HomeView() {
  const navigate = useAppStore(s => s.navigate)
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.catalog()
      .then(c => { if (alive) setCatalog(c) })
      .catch(e => { if (alive) setCatalogError(e.message) })
    return () => { alive = false }
  }, [])

  return (
    <div className="flex flex-col">
      <Hero totals={catalog?.totals} />
      <ExamSearch />
      <CategoriesSection catalog={catalog} error={catalogError} />
      <FeaturedSection exams={catalog?.featured ?? null} error={catalogError} />
      <BrowseSection catalog={catalog} error={catalogError} />
      <BeanMethod />
      <FinalCta />
    </div>
  )
}

// ─── Hero ───
function Hero({ totals }: { totals?: CatalogResponse['totals'] }) {
  const navigate = useAppStore(s => s.navigate)
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(600px 300px at 20% 0%, rgba(214,165,20,0.10), transparent), radial-gradient(500px 260px at 85% 20%, rgba(214,165,20,0.06), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
            <Sparkles className="h-3.5 w-3.5" /> Premium preparation for Indian competitive examinations
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl lg:text-6xl">
            One syllabus. <span className="text-gold">Every topic.</span>
            <br />
            Honest availability on each exam.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Verified syllabus coverage, relevant learning materials, real practice tests, and topic-aware
            learning support — for TNPSC, UPSC, SSC, Banking, Railways, Defence, teaching, medical &amp;
            university entrances and State PSC examinations.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto" onClick={() => navigate({ view: 'catalog' })}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> Start practising
            </Button>
            <Button size="lg" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate({ view: 'catalog' })}>
              <BookOpen className="mr-2 h-4 w-4" /> Explore syllabus
            </Button>
          </div>
          {totals && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <CountPill label="examinations" value={totals.exams} />
              <CountPill label="syllabus topics" value={totals.topics} />
              <CountPill label="original study notes" value={totals.uniqueNotes} />
              <CountPill label="practice questions" value={totals.questions} />
              <CountPill label="ready tests" value={totals.tests} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Real catalogue search ───
function ExamSearch() {
  const navigate = useAppStore(s => s.navigate)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExamListItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const runSearch = (q: string) => {
    const trimmed = q.trim()
    setTouched(true)
    if (!trimmed) {
      setResults(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    api.exams({ search: trimmed })
      .then(r => setResults(r.exams))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(query), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const reset = () => {
    setQuery('')
    setResults(null)
    setTouched(false)
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <section className="border-b border-border/60 bg-card/40">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h2 className="text-center font-display text-xl font-semibold text-foreground sm:text-2xl">
          Find your examination
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Search by exam name, abbreviation, conducting authority, state or category — against the real catalogue.
        </p>
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Try “TNPSC”, “SSC CGL”, “RBI”, “NEET”, “police”…"
            className="h-12 border-border bg-elevated pl-10 pr-24 text-base"
            aria-label="Search examinations"
            type="search"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {query && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={reset} aria-label="Clear search">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {loading && (
          <div className="mt-5 space-y-2" aria-live="polite">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full bg-elevated" />)}
          </div>
        )}

        {error && !loading && (
          <p className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {results && !loading && (
          <div className="mt-5 overflow-hidden rounded-xl border border-border" aria-live="polite">
            {results.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-foreground">No examinations matched “{query}”.</p>
                <p className="mt-1 text-xs text-muted-foreground">Check the spelling, or try a broader term like the conducting board&apos;s name.</p>
                <Button variant="outline" size="sm" className="mt-4 border-gold/40 text-gold hover:bg-gold/10" onClick={reset}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset search
                </Button>
              </div>
            ) : (
              <ul className="max-h-80 divide-y divide-border/70 overflow-y-auto">
                {results.map(exam => (
                  <li key={exam.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'exam', slug: exam.slug })}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{exam.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{exam.authority}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!touched && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Popular right now: {['TNPSC', 'UPSC', 'SSC', 'IBPS', 'RRB', 'NEET'].map((term, i) => (
              <span key={term}>
                {i > 0 && ' · '}
                <button type="button" className="text-gold hover:underline" onClick={() => setQuery(term)}>{term}</button>
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Popular categories grid ───
function CategoriesSection({ catalog, error }: { catalog: CatalogResponse | null; error: string | null }) {
  const navigate = useAppStore(s => s.navigate)
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Popular categories"
        title="Browse by category"
        description="Ten wide families of Indian competitive examinations — every card opens the real, filterable catalogue."
      />
      {error && (
        <p className="mx-auto mt-8 max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive" role="alert">{error}</p>
      )}
      {!catalog && !error && (
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-36 bg-elevated" />)}
        </div>
      )}
      {catalog && (
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {catalog.categories.map(cat => (
            <button
              key={cat.slug}
              type="button"
              onClick={() => navigate({ view: 'catalog', category: cat.slug })}
              className="exam-card-hover group rounded-xl border border-border bg-card p-5 text-left"
              aria-label={`${cat.name} — ${cat.examCount} exams`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-2xl font-bold text-gold">{String(cat.examCount).padStart(2, '0')}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-gold" />
              </div>
              <h3 className="text-sm font-semibold leading-snug text-foreground">{cat.name}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{cat.description}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Featured examinations ───
function FeaturedSection({ exams, error }: { exams: ExamListItem[] | null; error: string | null }) {
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Featured examinations"
          title="Where students start"
          description="High-impact examinations from the live catalogue — with honest content-coverage status on every card."
        />
        {error && (
          <p className="mx-auto mt-8 max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive" role="alert">{error}</p>
        )}
        {!exams && !error && (
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 bg-elevated" />)}
          </div>
        )}
        {exams && (
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {exams.slice(0, 8).map(exam => <ExamCard key={exam.id} exam={exam} />)}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Browse examinations by category (expandable) ───
function BrowseSection({ catalog, error }: { catalog: CatalogResponse | null; error: string | null }) {
  const navigate = useAppStore(s => s.navigate)
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [catExams, setCatExams] = useState<Record<string, ExamListItem[]>>({})
  const [loadingCat, setLoadingCat] = useState<string | null>(null)
  const [catError, setCatError] = useState<string | null>(null)

  const loadCategory = (slug: string) => {
    if (catExams[slug] || loadingCat) return
    setLoadingCat(slug)
    setCatError(null)
    api.exams({ category: slug })
      .then(r => setCatExams(prev => ({ ...prev, [slug]: r.exams })))
      .catch(e => setCatError(e.message))
      .finally(() => setLoadingCat(null))
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Complete catalogue"
        title="All examinations, category by category"
        description="Expand a category to see every examination currently in the catalogue, with live counts."
      />
      {error && (
        <p className="mx-auto mt-8 max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive" role="alert">{error}</p>
      )}
      {catalog && (
        <Accordion
          type="single"
          collapsible
          className="mt-10"
          value={openCategory ?? undefined}
          onValueChange={v => {
            setOpenCategory(v || null)
            if (v) loadCategory(v)
          }}
        >
          {catalog.categories.map(cat => (
            <AccordionItem key={cat.slug} value={cat.slug} className="border-border">
              <AccordionTrigger className="rounded-lg px-4 py-4 hover:bg-elevated hover:no-underline">
                <span className="flex w-full items-center justify-between gap-3 pr-2 text-left">
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{cat.name}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{cat.description}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold">
                    {cat.examCount} exams
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-4">
                {loadingCat === cat.slug && (
                  <div className="space-y-2 px-2">
                    {[0, 1, 2].map(i => <Skeleton key={i} className="h-11 bg-elevated" />)}
                  </div>
                )}
                {catError && openCategory === cat.slug && (
                  <p className="px-2 text-sm text-destructive" role="alert">{catError}</p>
                )}
                {catExams[cat.slug] && openCategory === cat.slug && (
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {catExams[cat.slug].map(exam => (
                      <li key={exam.id}>
                        <button
                          type="button"
                          onClick={() => navigate({ view: 'exam', slug: exam.slug })}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-elevated"
                        >
                          <span className="min-w-0 truncate text-sm text-foreground">{exam.name}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{exam.counts.questions} Qs</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </section>
  )
}

// ─── The BEAN method ───
const METHOD_STEPS = [
  {
    icon: BookOpen,
    step: 'LEARN',
    title: 'Study the topic',
    description: 'Original BEAN EXAMS notes and honestly-verified external resources, tied to the exact syllabus topic you are working on.',
  },
  {
    icon: Lock,
    step: 'LOCK',
    title: 'Commit before you test',
    description: 'Read the revision summary, fix the key facts, then open a session with a clear mind — the question screen keeps answers hidden until you submit.',
  },
  {
    icon: Brain,
    step: 'TEST',
    title: 'Practise under real rules',
    description: 'Topic, subject and mixed tests with the exam’s own timing stance and negative-marking rules applied by the server, not the browser.',
  },
  {
    icon: LineChart,
    step: 'SCORE',
    title: 'Review every mistake',
    description: 'Accurate scoring, full answer review with explanations, and a per-topic breakdown that shows exactly where marks were lost.',
  },
  {
    icon: GraduationCap,
    step: 'REVISE',
    title: 'Return to weak topics',
    description: 'Weak-topic tracking built from your saved attempts, plus BEAN Intelligence to re-explain, quiz and plan your revision.',
  },
]

function BeanMethod() {
  return (
    <section className="border-t border-border/60 bg-card/40">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="The BEAN method"
          title="Learn. Lock. Test. Score. Revise."
          description="One connected loop across the same exam, subject and topic records — from first read to final revision."
        />
        <ol className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {METHOD_STEPS.map((s, i) => (
            <li key={s.step} className="relative rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                  <s.icon className="h-4 w-4 text-gold" />
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-gold">
                  {i + 1}. {s.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ─── Closing CTA ───
function FinalCta() {
  const navigate = useAppStore(s => s.navigate)
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className={cn('rounded-2xl border border-gold/25 bg-gradient-to-b from-gold/10 to-transparent p-8 text-center sm:p-12')}>
        <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          Pick an exam. Learn a topic. Prove it with a test.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Guest-friendly by design — your attempts and progress are saved on this device automatically.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto" onClick={() => navigate({ view: 'catalog' })}>
            Browse all examinations
          </Button>
          <Button size="lg" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate({ view: 'bean', seeded: false })}>
            <Sparkles className="mr-2 h-4 w-4" /> Meet BEAN Intelligence
          </Button>
        </div>
      </div>
    </section>
  )
}

// re-export for potential reuse
export { EmptyState }
