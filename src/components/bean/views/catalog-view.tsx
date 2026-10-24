'use client'

// Catalogue view (Task 4-a): all examinations with debounced search + category filter chips.
// Data-fetching note: loading/error are DERIVED from keyed results instead of being set
// synchronously inside effects (react-hooks/set-state-in-effect compliant).

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { ExamListItem } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { SectionHeading } from '@/components/bean/section-heading'
import { ExamCard } from '@/components/bean/exam-card'
import { EmptyState } from '@/components/bean/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { RotateCcw, Search, X } from 'lucide-react'

interface CategoryInfo {
  slug: string
  name: string
  examCount: number
}

interface ExamResults {
  key: string
  exams: ExamListItem[]
  total: number
}

export function CatalogView() {
  const route = useAppStore(s => s.route)
  const navigate = useAppStore(s => s.navigate)

  // Category is fully derived from the hash route — chips navigate, the store syncs the route.
  const routeCategory = route.view === 'catalog' ? route.category || undefined : undefined
  const routeQuery = route.view === 'catalog' ? route.q ?? '' : ''

  // Search text is local; the applied search is debounced (350 ms).
  const [query, setQuery] = useState(routeQuery)
  const [search, setSearch] = useState(routeQuery.trim())
  const [retryToken, setRetryToken] = useState(0)

  // Adjust local search state when the route's q changes (deep links, back/forward, chip clicks).
  // Guarded render-time adjustment — the pattern documented at react.dev/learn/you-might-not-need-an-effect.
  const [lastRouteQuery, setLastRouteQuery] = useState(routeQuery)
  if (lastRouteQuery !== routeQuery) {
    setLastRouteQuery(routeQuery)
    setQuery(routeQuery)
    setSearch(routeQuery.trim())
  }

  // Debounce input text → applied search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(query.trim()), 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Keyed request state — each filter combination has its own result/failure slot
  const filterKey = `${routeCategory ?? ''}|${search}|${retryToken}`
  const [results, setResults] = useState<ExamResults | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    let alive = true
    api.exams({ search: search || undefined, category: routeCategory || undefined })
      .then(r => {
        if (!alive) return
        setResults({ key: filterKey, exams: r.exams, total: r.total })
        setFailure(null)
      })
      .catch(e => {
        if (alive) setFailure({ key: filterKey, message: e.message })
      })
    return () => {
      alive = false
    }
  }, [filterKey, search, routeCategory])

  // Category chips data
  const [categories, setCategories] = useState<CategoryInfo[] | null>(null)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.catalog()
      .then(c => {
        if (!alive) return
        setCategories(c.categories.map(cat => ({ slug: cat.slug, name: cat.name, examCount: cat.examCount })))
      })
      .catch(e => {
        if (alive) setCategoriesError(e.message)
      })
    return () => {
      alive = false
    }
  }, [])

  // Derived request state for the current filter combination
  const failed = Boolean(failure && failure.key === filterKey)
  const loading = !failed && (!results || results.key !== filterKey)
  const error = failure && failure.key === filterKey ? failure.message : null
  const currentExams = results && results.key === filterKey ? results.exams : []
  const total = results && results.key === filterKey ? results.total : 0

  const selectCategory = (slug: string | undefined) => {
    // Commit the current search text together with the category so deep links stay truthful
    const q = query.trim() || undefined
    navigate({ view: 'catalog', category: slug, q })
  }

  const resetFilters = () => {
    navigate({ view: 'catalog' })
    setQuery('')
    setSearch('')
    setResults(null)
    setFailure(null)
  }

  const activeCategoryName = categories?.find(c => c.slug === routeCategory)?.name ?? routeCategory
  const hasFilters = Boolean(routeCategory || search)

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <SectionHeading
        align="left"
        eyebrow="Examination catalogue"
        title="All examinations"
        description="Every examination we cover — with honest syllabus coverage, original study notes and real practice questions. Filter by category, or search by name, abbreviation, conducting authority, state or description."
      />

      {/* Search */}
      <div className="relative mt-8 max-w-2xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Try “TNPSC”, “SSC CGL”, “banking”, “NEET”, “defence”…"
          className="h-12 border-border bg-elevated pl-10 pr-12 text-base"
          aria-label="Search examinations"
          type="search"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Category filter chips */}
      <div className="mt-5">
        {categoriesError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            Could not load categories: {categoriesError}
          </p>
        )}
        {!categories && !categoriesError && (
          <div className="flex flex-wrap gap-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-28 rounded-full bg-elevated" />
            ))}
          </div>
        )}
        {categories && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter examinations by category">
            <CategoryChip
              label="All"
              count={categories.reduce((sum, c) => sum + c.examCount, 0)}
              active={!routeCategory}
              onClick={() => selectCategory(undefined)}
            />
            {categories.map(cat => (
              <CategoryChip
                key={cat.slug}
                label={cat.name}
                count={cat.examCount}
                active={routeCategory === cat.slug}
                onClick={() => selectCategory(cat.slug)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Result count + clear filters */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite" aria-atomic="true">
          {loading
            ? 'Searching the catalogue…'
            : `${total} ${total === 1 ? 'examination' : 'examinations'} found`}
          {!loading && activeCategoryName && ` in ${activeCategoryName}`}
          {!loading && search && ` for “${search}”`}
        </p>
        {hasFilters && !loading && (
          <Button
            variant="outline"
            size="sm"
            className="border-gold/40 text-gold hover:bg-gold/10"
            onClick={resetFilters}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>

      {/* Error alert */}
      {error && !loading && (
        <div className="mt-6" role="alert">
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 border-gold/40 text-gold hover:bg-gold/10"
            onClick={() => setRetryToken(t => t + 1)}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading examinations">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl bg-elevated" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && currentExams.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={Search}
            title="No examinations match your filters"
            description={
              search
                ? `Nothing in the catalogue matched “${search}”${routeCategory ? ' inside this category' : ''}. Try a different keyword, or clear the filters to browse everything.`
                : 'No examinations in this category yet — new examinations are added to the catalogue regularly.'
            }
            actionLabel="Reset filters"
            onAction={resetFilters}
          />
        </div>
      )}

      {/* Results grid */}
      {!loading && !error && currentExams.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {currentExams.map(exam => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors sm:text-sm',
        active
          ? 'border-gold/40 bg-gold/10 text-gold'
          : 'border-border bg-card text-muted-foreground hover:bg-elevated hover:text-foreground'
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
          active ? 'bg-gold/20 text-gold' : 'bg-elevated text-muted-foreground'
        )}
      >
        {count}
      </span>
    </button>
  )
}
