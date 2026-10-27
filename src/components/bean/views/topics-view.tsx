'use client'

// Topics — the chapters, subtopics and source references Riishe discovered
// across every analysed document in the library. Search, preview, and jump
// straight into practice or the exact source page.

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { RiisheTopicsResponseDTO } from '@/lib/types'
import { AnalysisStateBadge } from '@/components/bean/views/materials-view'
import { EmptyState } from '@/components/bean/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  ClipboardList,
  FileText,
  ListChecks,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'

export function TopicsView() {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)

  const [reloadTick, setReloadTick] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; data: RiisheTopicsResponseDTO } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadKey = guestId ? `${guestId}|${reloadTick}` : 'no-session'

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .riisheTopics(guestId)
      .then(d => {
        if (!alive) return
        setLoaded({ key: loadKey, data: d })
        setError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load your discovered topics.')
      })
    return () => {
      alive = false
    }
  }, [guestId, loadKey])

  const data = loaded && loaded.key === loadKey ? loaded.data : null
  const loading = !data && !error

  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  // Aggregate + filter topics across documents (topic name or subtopic match)
  const filtered = useMemo(() => {
    if (!data) return []
    return data.documents
      .map(doc => ({
        ...doc,
        topics: doc.topics.filter(t => {
          if (!q) return true
          if (t.name.toLowerCase().includes(q)) return true
          return t.subtopics.some(s => s.toLowerCase().includes(q))
        }),
      }))
      .filter(doc => doc.topics.length > 0 || (!q && true))
      .filter(doc => q ? doc.topics.length > 0 : true)
  }, [data, q])

  const totalShown = filtered.reduce((s, d) => s + d.topics.length, 0)

  const openDocAtPage = (docId: string, page?: number) => {
    navigate({ view: 'riishe', docId, page })
  }

  const practiceDoc = (docId: string, topicNames: string[]) => {
    navigate({ view: 'practice', doc: docId, topics: topicNames.join('||') })
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Discovered from your uploads</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Topics</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every chapter, topic and subtopic Riishe found in your analysed documents — with the exact page ranges.
          Select what you want to practise; no syllabus is assumed.
        </p>
      </header>

      {loading && (
        <div className="mt-8 space-y-6" aria-hidden>
          <Skeleton className="h-12 w-full bg-elevated" />
          <Skeleton className="h-64 w-full bg-elevated" />
          <Skeleton className="h-64 w-full bg-elevated" />
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

      {!loading && !error && data && (
        <>
          {/* Search */}
          <div className="relative mt-8">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search discovered topics and subtopics…"
              aria-label="Search discovered topics"
              type="search"
              className="h-12 border-border bg-elevated pl-10 pr-10 text-base"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                onClick={() => setQuery('')}
                aria-label="Clear topic search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {data.documents.length === 0 ? (
            <div className="mt-10">
              <EmptyState
                icon={FileText}
                title="No analysed documents yet"
                description="Upload a PDF in My Materials — Riishe reads it page by page and maps the chapters and topics it finds here."
                actionLabel="Go to My Materials"
                onAction={() => navigate({ view: 'materials' })}
              />
            </div>
          ) : (
            <>
              <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
                {q
                  ? `${totalShown} topic${totalShown === 1 ? '' : 's'} match “${query}” across ${filtered.length} document${filtered.length === 1 ? '' : 's'}.`
                  : `${data.totalTopics} topic${data.totalTopics === 1 ? '' : 's'} discovered across ${data.documents.length} document${data.documents.length === 1 ? '' : 's'}.`}
              </p>

              {totalShown === 0 && q && (
                <div className="mt-8">
                  <EmptyState
                    icon={Search}
                    title="Nothing matched"
                    description={`No discovered topic matches “${query}”. Try a shorter term, or upload material that covers it.`}
                  />
                </div>
              )}

              <div className="mt-6 space-y-8">
                {filtered.map(doc => (
                  <section key={doc.documentId} aria-label={`Topics from ${doc.documentTitle}`} className="rounded-xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-display text-lg font-semibold text-foreground" title={doc.documentTitle}>
                          {doc.documentTitle}
                        </h2>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {doc.pageCount != null ? `${doc.pageCount} pages · ` : ''}
                          {doc.definitions} definitions · {doc.formulas} formulas
                        </p>
                        {doc.summary && <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{doc.summary}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <AnalysisStateBadge state={doc.analysisState} pct={doc.analysisPct ?? undefined} />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border text-muted-foreground hover:bg-elevated"
                            onClick={() => openDocAtPage(doc.documentId)}
                            aria-label={`Open ${doc.documentTitle} in the workspace`}
                          >
                            <BookOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gold/40 text-gold hover:bg-gold/10"
                            onClick={() => practiceDoc(doc.documentId, doc.topics.slice(0, 8).map(t => t.name))}
                            aria-label={`Practise ${doc.documentTitle}`}
                          >
                            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Practise
                          </Button>
                        </div>
                      </div>
                    </div>

                    <ul className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
                      {doc.topics.map(topic => (
                        <li key={topic.name} className="rounded-lg border border-border bg-elevated p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="min-w-0 text-sm font-medium text-foreground">{topic.name}</p>
                            {topic.pages.length > 0 && (
                              <button
                                type="button"
                                onClick={() => openDocAtPage(doc.documentId, topic.pages[0])}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-card px-2 py-0.5 text-[11px] font-medium text-gold transition-colors hover:bg-gold/10"
                                aria-label={`Open ${doc.documentTitle} at page ${topic.pages[0]}`}
                                title={`Opens the reader at page ${topic.pages[0]}`}
                              >
                                <BookOpen className="h-3 w-3" aria-hidden />
                                {topic.pages.length === 1 ? `page ${topic.pages[0]}` : `pages ${topic.pages[0]}–${topic.pages[topic.pages.length - 1]}`}
                              </button>
                            )}
                          </div>
                          {topic.subtopics.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {topic.subtopics.slice(0, 6).map(sub => (
                                <Badge key={sub} variant="outline" className="max-w-full whitespace-normal break-words border-border text-[10px] text-muted-foreground">
                                  {sub}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => practiceDoc(doc.documentId, [topic.name])}
                              className={cn(
                                'inline-flex min-h-7 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-gold',
                                'hover:border-gold/40 hover:bg-gold/10',
                              )}
                              aria-label={`Practise ${topic.name} from ${doc.documentTitle}`}
                            >
                              <ClipboardList className="h-3 w-3" aria-hidden /> Practise this topic
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate({ view: 'riishe', topic: topic.name })}
                              className={cn(
                                'inline-flex min-h-7 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-gold',
                                'hover:border-gold/40 hover:bg-gold/10',
                              )}
                              aria-label={`Ask Riishe about ${topic.name}`}
                              title="Opens the Ask Riishe chat focused on this topic"
                            >
                              <Sparkles className="h-3 w-3" aria-hidden /> Ask Riishe
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {doc.questionPatterns.length > 0 && (
                      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                        <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                        <span>
                          Question styles detected in this document ({doc.questionPatterns.slice(0, 3).join('; ')}{doc.questionPatterns.length > 3 ? '…' : ''}) —
                          used as a style reference when Riishe writes your practice questions.
                        </span>
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
