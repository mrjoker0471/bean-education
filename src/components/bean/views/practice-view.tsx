'use client'

// Practice — configure and generate validated question sets from the student's
// own analysed documents. Multiple documents and topics can be combined; the
// count, difficulty, question mix, timing and scoring are all explicit
// student choices. In-flight sets are polled; READY sets show provenance
// (topics + source pages) before the attempt starts.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { MaterialListItemDTO, MaterialStatus } from '@/lib/types'
import {
  PreTestSummaryCard,
  RiisheGeneratorPanel,
  TestFailedCard,
  TestHistoryRow,
  TestPendingCard,
  TestSkeletonCard,
  useRiisheTestPoll,
} from '@/components/bean/riishe-bits'
import { EmptyState } from '@/components/bean/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { ClipboardList, FileUp, Loader2, RotateCcw } from 'lucide-react'

const PROCESSING_STATUSES: MaterialStatus[] = ['QUEUED', 'EXTRACTING', 'ANALYSING']
const isProcessing = (s: MaterialStatus) => PROCESSING_STATUSES.includes(s)

export function PracticeView({ doc, topics }: { doc?: string; topics?: string }) {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)

  const [reloadTick, setReloadTick] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; data: MaterialListItemDTO[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadKey = guestId ? `${guestId}|${reloadTick}` : 'no-session'

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .materials(guestId)
      .then(d => {
        if (!alive) return
        setLoaded({ key: loadKey, data: d.materials })
        setError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load your materials.')
      })
    return () => {
      alive = false
    }
  }, [guestId, loadKey])

  const materials = loaded && loaded.key === loadKey ? loaded.data : null
  const loading = !materials && !error
  const readyDocs = (materials ?? []).filter(m => m.status === 'READY')

  // Any in-flight set across the library is polled so the student can follow
  // generation from here.
  const inflight = (materials ?? []).flatMap(m => m.tests).find(t => t.status === 'QUEUED' || t.status === 'GENERATING')
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const activeId = selectedTestId ?? inflight?.id ?? null
  const { test: activeTest, error: testError } = useRiisheTestPoll(activeId, guestId)
  const [startingId, setStartingId] = useState<string | null>(null)

  // Keep polling the library while something is in flight
  const anyProcessing = (materials ?? []).some(m => isProcessing(m.status))
  useEffect(() => {
    if (!anyProcessing || !guestId) return
    const timer = setInterval(() => setReloadTick(t => t + 1), 6000)
    return () => clearInterval(timer)
  }, [anyProcessing, guestId])

  const startTest = (testId: string) => {
    if (startingId || !guestId) return
    setStartingId(testId)
    api
      .startRiisheTest(testId, guestId)
      .then(r => {
        if (r.resumed) {
          toast({ title: 'Resuming your saved attempt', description: 'Your earlier answers were restored.' })
        }
        navigate({ view: 'test', attemptId: r.attemptId })
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not start the test', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
      .finally(() => setStartingId(null))
  }

  const initialTopics = (topics ?? '').split('||').map(t => t.trim()).filter(Boolean).slice(0, 8)
  const initialDocIds = doc ? [doc] : undefined

  const recentReady = (materials ?? [])
    .flatMap(m => m.tests.filter(t => t.status === 'READY').map(t => ({ ...t, docId: m.id, docTitle: m.title })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">From your own material</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Practice</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Choose what to practise — one document or several, whole documents or specific topics — then set the count,
          difficulty, question mix, timing and scoring. Every question is validated against your sources before the
          set is published.
        </p>
      </header>

      {loading && (
        <div className="mt-8 space-y-4" aria-hidden>
          <Skeleton className="h-72 w-full bg-elevated" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setReloadTick(t => t + 1)}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      )}

      {!loading && !error && (
        <div className="mt-8 space-y-6">
          {readyDocs.length === 0 ? (
            <EmptyState
              icon={FileUp}
              title="Nothing ready to practise yet"
              description="Upload a study PDF in My Materials and wait for Riishe's analysis — then build practice sets from it here."
              actionLabel="Go to My Materials"
              onAction={() => navigate({ view: 'materials' })}
            />
          ) : (
            <RiisheGeneratorPanel
              guestId={guestId}
              docs={readyDocs.map(d => ({ id: d.id, title: d.title, topics: (d.topics ?? []).map(name => ({ name, pages: [] })) }))}
              initialDocIds={initialDocIds}
              initialTopics={initialTopics.length > 0 ? initialTopics : undefined}
              onGenerated={testId => {
                setSelectedTestId(testId)
                setReloadTick(t => t + 1)
              }}
            />
          )}

          {/* Active set */}
          {activeId && (
            <section aria-label="Selected practice set">
              {!activeTest && !testError && <TestSkeletonCard />}
              {testError && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 sm:p-6" role="alert">
                  <p className="text-sm text-destructive">{testError}</p>
                </div>
              )}
              {activeTest && (activeTest.status === 'QUEUED' || activeTest.status === 'GENERATING') && (
                <TestPendingCard status={activeTest.status} statusDetail={activeTest.statusDetail} />
              )}
              {activeTest && activeTest.status === 'FAILED' && (
                <TestFailedCard
                  statusDetail={activeTest.statusDetail}
                  onRetry={() => setSelectedTestId(activeTest.id)}
                />
              )}
              {activeTest && activeTest.status === 'READY' && (
                <PreTestSummaryCard
                  test={activeTest}
                  starting={startingId === activeTest.id}
                  onStart={() => startTest(activeTest.id)}
                  // Multi-document provenance: page chips deep-link into the
                  // source document's workspace reader at that page.
                  onOpenPage={(page, docId) => {
                    const target = docId ?? activeTest.documentId
                    navigate({ view: 'riishe', docId: target, page })
                  }}
                />
              )}
            </section>
          )}

          {/* Recent ready sets across the library */}
          {recentReady.length > 0 && (
            <section aria-label="Recent practice sets" className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
                <ClipboardList className="h-4 w-4 text-gold" aria-hidden /> Recent practice sets
              </h2>
              <ul className="mt-5 space-y-3">
                {recentReady.map(t => (
                  <li key={t.id} className="rounded-lg border border-border bg-elevated p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground" title={t.title}>{t.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.docTitle}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border text-muted-foreground hover:bg-elevated"
                          onClick={() => setSelectedTestId(t.id)}
                        >
                          Details
                        </Button>
                        <Button
                          size="sm"
                          className="bg-gold text-primary-foreground hover:bg-gold-hover"
                          disabled={startingId === t.id}
                          onClick={() => startTest(t.id)}
                        >
                          {startingId === t.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : null}
                          Start
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// TestHistoryRow is re-exported for potential reuse
export { TestHistoryRow }
