'use client'

// Riishe AI workspace — upload → analyse → test, applied to your own materials.
// HUB (#/riishe): the three-step flow, READY materials, weak areas, BEAN handoff.
// WORKSPACE (#/riishe/[docId]): one document — Material / Analysis / Tests tabs.
// All data comes from the backend pipeline; every state shown is honest.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  AnalyzedTopicDTO,
  DocStructureInfoDTO,
  DocumentAnalysisDTO,
  ListExtractionDTO,
  MaterialDetailDTO,
  MaterialListItemDTO,
  MaterialStatus,
  PageMappingStatusDTO,
  RiisheTestDetailDTO,
  RiisheWeakTopicDTO,
  SectionOutcomeDTO,
  StructureGroupDTO,
  TopicItemClassDTO,
} from '@/lib/types'
import { PageRefChips, formatPageRefs } from '@/components/bean/riishe-bits'
import { RiisheChatPanel } from '@/components/bean/riishe-chat'
import { MaterialStatusBadge } from '@/components/bean/views/materials-view'
import { MaterialPdfReader } from '@/components/bean/pdf-viewer'
import { EmptyState } from '@/components/bean/empty-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Compass,
  Download,
  FileText,
  FileWarning,
  Info,
  Lightbulb,
  ListTree,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  ScanSearch,
  Sigma,
  Sparkles,
  Trash2,
  TrendingDown,
  Upload,
  XCircle,
} from 'lucide-react'

const PROCESSING_STATUSES: MaterialStatus[] = ['QUEUED', 'EXTRACTING', 'ANALYSING']
const isProcessing = (s: MaterialStatus) => PROCESSING_STATUSES.includes(s)

// ─── Shared formatting helpers ───

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Same scaling the backend uses for the distribution preview. */
function distributionLine(count: number): string {
  const scale = count / 50
  const d = {
    f: Math.max(1, Math.round(10 * scale)),
    a: Math.max(1, Math.round(15 * scale)),
    s: Math.max(1, Math.round(10 * scale)),
    m: Math.max(1, Math.round(10 * scale)),
    x: Math.max(1, Math.round(5 * scale)),
  }
  return `${d.f} foundational · ${d.a} application · ${d.s} statement · ${d.m} multi-step · ${d.x} misconception`
}

// ═══ Router ═══

export function RiisheView({ docId, page, topic }: { docId?: string; page?: number; topic?: string }) {
  if (!docId) return <RiisheHub initialTopic={topic} />
  return <RiisheWorkspace docId={docId} initialPage={page} />
}

// ═══════════════════════════ HUB ═══════════════════════════

function RiisheHub({ initialTopic }: { initialTopic?: string }) {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)

  const [materialsLoaded, setMaterialsLoaded] = useState<{ key: string; data: MaterialListItemDTO[] } | null>(null)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [weakLoaded, setWeakLoaded] = useState<{ key: string; data: RiisheWeakTopicDTO[] } | null>(null)

  const loadKey = guestId ? `${guestId}|${reloadTick}` : 'no-session'

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .materials(guestId)
      .then(d => {
        if (!alive) return
        setMaterialsLoaded({ key: loadKey, data: d.materials })
        setMaterialsError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setMaterialsError(e instanceof Error ? e.message : 'Could not load your materials.')
      })
    return () => {
      alive = false
    }
  }, [guestId, loadKey])

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .riisheWeakTopics(guestId)
      .then(d => {
        if (alive) setWeakLoaded({ key: loadKey, data: d.weakTopics })
      })
      .catch(() => {
        if (alive) setWeakLoaded({ key: loadKey, data: [] }) // honest empty — never fake data
      })
    return () => {
      alive = false
    }
  }, [guestId, loadKey])

  const materialsReady = materialsLoaded && materialsLoaded.key === loadKey ? materialsLoaded.data : null
  const readyMaterials = (materialsReady ?? []).filter(m => m.status === 'READY')
  const processingCount = (materialsReady ?? []).filter(m => isProcessing(m.status)).length
  const weakTopics = weakLoaded && weakLoaded.key === loadKey ? weakLoaded.data : null
  const firstWeakWithDoc = weakTopics?.find(t => !!t.documentId) ?? null

  // Phase 3B — closes the weakFocus gap: the render sites existed, but nothing
  // ever SENT weakFocus. This producer generates a real weak-area-focused
  // test (focus topics = the weak labels for that document, weakFocus: true
  // marks it) and opens the workspace where the in-flight test is visible.
  const [weakFocusBusy, setWeakFocusBusy] = useState(false)
  const [weakFocusError, setWeakFocusError] = useState<string | null>(null)

  const startWeakFocusPractice = () => {
    const docId = firstWeakWithDoc?.documentId
    if (!guestId || !docId || weakFocusBusy) return
    setWeakFocusBusy(true)
    setWeakFocusError(null)
    const focusTopics = (weakTopics ?? []).filter(t => t.documentId === docId).map(t => t.topic)
    api
      .generateRiisheTest({
        guestId,
        documentId: docId,
        focusTopics: focusTopics.length > 0 ? focusTopics : undefined,
        weakFocus: true,
        timed: false,
        count: 8,
      })
      .then(() => {
        navigate({ view: 'riishe', docId })
      })
      .catch((e: unknown) => {
        setWeakFocusError(e instanceof Error ? e.message : 'Could not start the weak-area test.')
      })
      .finally(() => setWeakFocusBusy(false))
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">AI study workspace</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Riishe AI</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Turn your own PDFs into practice. Upload a material, let Riishe analyse its topics, definitions and
          misconceptions, then take a validated test built strictly from that content.
        </p>
      </header>

      {/* Three-step flow */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StepCard n="1" icon={Upload} title="Upload" text="Add any PDF study material — a chapter, class notes or an official document." />
        <StepCard n="2" icon={ScanSearch} title="Analyse" text="Riishe extracts the text page by page and maps topics, key facts, formulas and common misconceptions." />
        <StepCard n="3" icon={ClipboardList} title="Test" text="Generate up to 50 validated questions from the material — timed or untimed, with grounded explanations." />
      </div>

      {/* Primary actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'materials' })}>
          <Upload className="mr-2 h-4 w-4" aria-hidden /> Upload new material
        </Button>
        <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'riishe-research' })}>
          <Compass className="mr-2 h-4 w-4" aria-hidden /> Deep Research
        </Button>
        <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'bean' })}>
          <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Open BEAN Intelligence
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* READY materials */}
        <section aria-label="Analysed materials" className="rounded-xl border border-border bg-card p-5 sm:p-6 lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
              <BookOpen className="h-4 w-4 text-gold" aria-hidden /> Analysed materials
            </h2>
            {readyMaterials.length > 0 && (
              <Badge variant="outline" className="border-border text-muted-foreground">
                {readyMaterials.length} ready
              </Badge>
            )}
          </div>

          {!materialsReady && !materialsError && (
            <div className="mt-5 space-y-3" aria-hidden>
              <Skeleton className="h-14 bg-elevated" />
              <Skeleton className="h-14 bg-elevated" />
            </div>
          )}

          {materialsError && (
            <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3" role="alert">
              <p className="text-sm text-destructive">{materialsError}</p>
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

          {materialsReady && readyMaterials.length === 0 && (
            <p className="mt-5 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
              No analysed materials yet — upload a PDF to get started. Materials still processing appear here once
              they are ready.
            </p>
          )}

          {readyMaterials.length > 0 && (
            <ul className="mt-5 space-y-3">
              {readyMaterials.map(doc => (
                <li
                  key={doc.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {doc.pageCount != null ? `${doc.pageCount} pages · ` : ''}
                      {formatBytes(doc.fileSize)} · {doc.tests.filter(t => t.status === 'READY').length} test
                      {doc.tests.filter(t => t.status === 'READY').length === 1 ? '' : 's'} ready
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-gold/40 text-gold hover:bg-gold/10"
                    onClick={() => navigate({ view: 'riishe', docId: doc.id })}
                    aria-label={`Open ${doc.title} in the Riishe workspace`}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {processingCount > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {processingCount} material{processingCount === 1 ? ' is' : 's are'} still processing —
              follow live status in My Materials.
            </p>
          )}
        </section>

        <div className="space-y-6 lg:col-span-2">
          {/* Weak areas */}
          <section aria-label="Weak areas" className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
              <TrendingDown className="h-4 w-4 text-gold" aria-hidden /> Weak areas
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Topics from your Riishe tests where accuracy fell below 60% across at least three attempted questions.
            </p>

            {!weakTopics && (
              <div className="mt-5 space-y-3" aria-hidden>
                <Skeleton className="h-12 bg-elevated" />
                <Skeleton className="h-12 bg-elevated" />
              </div>
            )}

            {weakTopics && weakTopics.length === 0 && (
              <p className="mt-5 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
                No weak areas yet — take a Riishe test first.
              </p>
            )}

            {weakTopics && weakTopics.length > 0 && (
              <>
                <ul className="mt-5 space-y-3">
                  {weakTopics.slice(0, 5).map(t => (
                    <li key={t.topic} className="rounded-lg border border-border bg-elevated p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium text-foreground">{t.topic}</p>
                        <Badge variant="outline" className="shrink-0 border-destructive/40 bg-destructive/10 text-destructive">
                          {t.accuracy}%
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {t.correct}/{t.attempted} correct
                        {t.documentTitle ? ` · ${t.documentTitle}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                {firstWeakWithDoc?.documentId && (
                  <Button
                    className="mt-4 w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto"
                    disabled={weakFocusBusy}
                    onClick={startWeakFocusPractice}
                  >
                    {weakFocusBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Play className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Practice weak areas
                  </Button>
                )}
                {weakFocusError && (
                  <p className="mt-2 text-xs text-destructive" role="alert">{weakFocusError}</p>
                )}
              </>
            )}
          </section>

          {/* BEAN Intelligence (preserved handoff) */}
          <section aria-label="BEAN Intelligence" className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-gold" aria-hidden /> BEAN Intelligence
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The AI tutor knows your exam context. Ask it to explain a concept from your material or plan what to
              revise next.
            </p>
            <Button
              variant="outline"
              className="mt-4 w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto"
              onClick={() => navigate({ view: 'bean' })}
            >
              Chat with BEAN
            </Button>
          </section>
        </div>
      </div>

      {/* Ask Riishe — grounded follow-up chat over the analysed library.
          Replies cite real pages from the student's own uploads; anything
          outside the material is labelled. */}
      {readyMaterials.length > 0 && (
        <section aria-label="Ask Riishe" className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden /> Ask Riishe
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Answers come from your analysed materials with page citations. Anything not supported by them is labelled
            as general knowledge — Riishe never presents an outside fact as coming from your documents.
          </p>
          <div className="mt-4">
            <RiisheChatPanel
              guestId={guestId}
              scope={{}}
              topicFocus={initialTopic}
              greeting="Ask anything about your uploaded material — Riishe cites the exact pages it used."
              materials={readyMaterials.map(m => ({ id: m.id, title: m.title }))}
              onOpenPage={(page, docId) => {
                if (docId) navigate({ view: 'riishe', docId, page })
              }}
            />
          </div>
        </section>
      )}
    </div>
  )
}

function StepCard({ n, icon: Icon, title, text }: { n: string; icon: typeof Upload; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="font-display text-3xl font-bold text-gold">{n}</span>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="mt-3 font-display text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}

// ═══════════════════════ WORKSPACE ═══════════════════════

type WorkspaceTab = 'material' | 'analysis' | 'tests'

function RiisheWorkspace({ docId, initialPage }: { docId: string; initialPage?: number }) {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)

  const [reloadTick, setReloadTick] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; data: MaterialDetailDTO } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  const loadKey = guestId ? `${guestId}|${docId}|${reloadTick}` : 'no-session'

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .material(docId, guestId)
      .then(d => {
        if (!alive) return
        setLoaded({ key: loadKey, data: d })
        setFailure(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setFailure({ key: loadKey, message: e instanceof Error ? e.message : 'Could not load this material.' })
      })
    return () => {
      alive = false
    }
  }, [guestId, docId, loadKey])

  const doc = loaded && loaded.key === loadKey ? loaded.data : null
  const error = failure && failure.key === loadKey ? failure.message : null
  const loading = !doc && !error
  const notFound = !!error && /not found/i.test(error)

  // Poll the material every 5s ONLY while it (or one of its tests) is in flight.
  const shouldPoll =
    !!doc && (isProcessing(doc.status) || doc.tests.some(t => t.status === 'QUEUED' || t.status === 'GENERATING'))
  useEffect(() => {
    if (!shouldPoll || !guestId || !docId) return
    const timer = setInterval(() => {
      api
        .material(docId, guestId)
        .then(d => setLoaded({ key: loadKey, data: d }))
        .catch(() => {
          /* keep the last honest state; the next tick retries */
        })
    }, 5000)
    return () => clearInterval(timer)
  }, [shouldPoll, guestId, docId, loadKey])

  // Default tab: land on Tests when the document already has a READY test to take.
  const [tab, setTab] = useState<WorkspaceTab>('material')
  const docKey = loaded?.key ?? null
  const [appliedKey, setAppliedKey] = useState<string | null>(null)
  if (doc && docKey && docKey !== appliedKey) {
    setAppliedKey(docKey)
    setTab(doc.status === 'READY' && doc.tests.some(t => t.status === 'READY') ? 'tests' : 'material')
  }

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Integrated reader overlay — lifted to the workspace so page chips in the
  // Analysis tab can deep-link to the exact page, and "Open in reader" in the
  // Material tab opens without one.
  const [reader, setReader] = useState<{ startPage?: number } | null>(
    // Page deep-links ("explain this page", practice provenance chips) land
    // directly in the integrated reader at that physical page.
    initialPage && Number.isFinite(initialPage) && initialPage >= 1 ? { startPage: initialPage } : null,
  )
  const openReaderAt = (page?: number) => setReader({ startPage: page })

  const refresh = () => setReloadTick(t => t + 1)

  // ── Not found ──
  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          icon={FileWarning}
          title="Material not found"
          description="This material does not exist in your library — it may have been removed from this device, or the link is stale."
          actionLabel="Back to My Materials"
          onAction={() => navigate({ view: 'materials' })}
        />
      </div>
    )
  }

  // ── Load error ──
  if (!loading && error && doc === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
          <p className="font-display text-lg font-semibold text-destructive">Could not load this material</p>
          <p className="mt-2 text-sm text-destructive/90">{error}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={refresh}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Try again
            </Button>
            <Button
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              onClick={() => navigate({ view: 'materials' })}
            >
              Back to My Materials
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ──
  if (loading || !doc) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8" aria-hidden>
        <Skeleton className="h-8 w-40 bg-elevated" />
        <Skeleton className="mt-4 h-10 w-2/3 bg-elevated" />
        <Skeleton className="mt-3 h-6 w-1/2 bg-elevated" />
        <Skeleton className="mt-8 h-10 bg-elevated" />
        <Skeleton className="mt-4 h-96 bg-elevated" />
      </div>
    )
  }

  const hasAnalysis = doc.status === 'READY' && !!doc.analysis
  const metaLabels = [doc.examLabel, doc.subjectLabel, doc.topicLabel].filter((v): v is string => !!v)

  const doRename = () => {
    const next = renameValue.trim()
    if (!next || renaming) return
    setRenaming(true)
    api
      .renameMaterial(doc.id, guestId, { title: next })
      .then(() => {
        // Update locally — no full reload, so the active tab is preserved.
        setLoaded(prev => (prev && prev.key === loadKey ? { key: prev.key, data: { ...prev.data, title: next } } : prev))
        toast({ title: 'Renamed', description: `This material is now “${next}”.` })
        setRenameOpen(false)
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not rename', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
      .finally(() => setRenaming(false))
  }

  const doRemove = () => {
    api
      .deleteMaterial(doc.id, guestId)
      .then(() => {
        toast({
          title: 'Material removed',
          description: 'The uploaded file, its analysis and every test generated from it were deleted.',
        })
        navigate({ view: 'materials' })
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not remove material', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
  }

  const doRetry = () => {
    api
      .retryMaterial(doc.id, guestId)
      .then(() => {
        toast({ title: 'Reprocessing started', description: 'Riishe is reading the document again.' })
        refresh()
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not start reprocessing', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
  }

  const doReanalyse = (force: boolean) => {
    api
      .reanalyseMaterial(doc.id, guestId, force)
      .then(() => {
        toast({
          title: force ? 'Re-analysis started' : 'Retry started',
          description: force
            ? 'Riishe will re-read and re-analyse the whole document.'
            : 'Riishe will retry the sections that failed — completed sections are kept.',
        })
        refresh()
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not start re-analysis', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground hover:text-gold"
          onClick={() => navigate({ view: 'materials' })}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> My Materials
        </Button>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold text-foreground sm:text-3xl" title={doc.title}>
              {doc.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <MaterialStatusBadge status={doc.status} />
              <span className="truncate">
                PDF · {formatBytes(doc.fileSize)}
                {doc.pageCount != null ? ` · ${doc.pageCount} pages` : ''}
              </span>
              {metaLabels.map(label => (
                <Badge key={label} variant="outline" className="border-gold/30 text-gold/90">
                  {label}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {doc.status === 'READY' && (
              <Button
                variant="outline"
                size="sm"
                className="border-gold/40 text-gold hover:bg-gold/10"
                onClick={() => {
                  setRenameValue(doc.title)
                  setRenameOpen(true)
                }}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Rename
              </Button>
            )}
            {doc.status === 'FAILED' && (
              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={doRetry}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Retry processing
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove ${doc.title}`}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-display">Remove this material?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes “{doc.title}” — the uploaded file, its analysis, and every test
                    generated from it. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-primary-foreground hover:bg-destructive/90"
                    onClick={doRemove}
                  >
                    Remove material
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={v => setTab(v as WorkspaceTab)} className="mt-6">
        <TabsList className="flex w-full overflow-x-auto sm:w-fit" aria-label="Workspace sections">
          <TabsTrigger value="material" className="flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5">
            Material
          </TabsTrigger>
          {hasAnalysis && (
            <TabsTrigger value="analysis" className="flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5">
              Analysis
            </TabsTrigger>
          )}
          <TabsTrigger value="tests" className="flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5">
            Tests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="material" className="mt-4">
          {doc.status === 'READY' ? (
            <MaterialReadyPanel doc={doc} onOpenReader={openReaderAt} />
          ) : (
            <MaterialPendingPanel doc={doc} />
          )}
        </TabsContent>

        {hasAnalysis && doc.analysis && (
          <TabsContent value="analysis" className="mt-4">
            <AnalysisPanel analysis={doc.analysis} onOpenPage={openReaderAt} onReanalyse={doReanalyse} />
          </TabsContent>
        )}

        <TabsContent value="tests" className="mt-4">
          <TestsPanel doc={doc} guestId={guestId} onDocRefresh={refresh} />
        </TabsContent>
      </Tabs>

      {/* Integrated reader overlay (Material tab trigger + Analysis page deep-links) */}
      {reader && (
        <MaterialPdfReader
          documentId={doc.id}
          title={doc.title}
          guestId={guestId}
          startPage={reader.startPage}
          onBack={() => setReader(null)}
        />
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Rename material</DialogTitle>
            <DialogDescription>Give this document a name you will recognise in your library.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="riishe-workspace-rename" className="text-xs text-muted-foreground">
              Title
            </Label>
            <Input
              id="riishe-workspace-rename"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              maxLength={160}
              className="mt-1.5"
              onKeyDown={e => {
                if (e.key === 'Enter') doRename()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              disabled={!renameValue.trim() || renaming}
              onClick={doRename}
            >
              {renaming && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Material tab: READY → document panel (+ integrated reader, lifted overlay) ───

function MaterialReadyPanel({ doc, onOpenReader }: { doc: MaterialDetailDTO; onOpenReader: (page?: number) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
          <FileText className="h-5 w-5 text-gold" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground">{doc.title}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {doc.originalName} · PDF · {formatBytes(doc.fileSize)}
            {doc.pageCount != null ? ` · ${doc.pageCount} pages` : ''}
          </p>
        </div>
      </div>

      {/*
        Reader trigger — opens the integrated full-viewport reader (pdf.js) over
        the workspace; Back returns here. Same reader used for official PDFs.
      */}
      <div className="mt-5 flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-elevated/50 px-4 py-10 text-center">
        <BookOpen className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Read your document inside BEAN EXAMS — the integrated reader has page navigation, zoom, rotation,
          text search and full-screen mode, and remembers where you stopped.
        </p>
        <Button
          className="mt-4 bg-gold text-primary-foreground hover:bg-gold-hover"
          onClick={() => onOpenReader()}
        >
          <BookOpen className="mr-2 h-4 w-4" aria-hidden /> Open in reader
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <DownloadButton doc={doc} />
        <p className="text-xs text-muted-foreground">Served from your own session — only you can open this file.</p>
      </div>
    </div>
  )
}

function DownloadButton({ doc }: { doc: MaterialDetailDTO }) {
  const guestId = useAppStore(s => s.guestId)
  if (!guestId) return null
  return (
    <Button asChild className="bg-gold text-primary-foreground hover:bg-gold-hover">
      <a
        href={api.materialFileUrl(doc.id, true, guestId)}
        download={doc.originalName}
        aria-label={`Download ${doc.title} as PDF`}
      >
        <Download className="mr-2 h-4 w-4" aria-hidden /> Download PDF
      </a>
    </Button>
  )
}

// ─── Material tab: honest status card while not READY ───

function MaterialPendingPanel({ doc }: { doc: MaterialDetailDTO }) {
  const fallback: Record<MaterialStatus, string> = {
    QUEUED: 'This document is waiting in the processing queue.',
    EXTRACTING: 'Riishe is extracting the page text right now.',
    ANALYSING: 'Riishe is analysing topics, definitions and structure.',
    READY: '',
    NEEDS_OCR:
      'These pages look like scanned images — no readable text was found and OCR is unavailable, so the document cannot be analysed.',
    FAILED: 'Processing failed. You can retry it from here or from My Materials.',
  }
  return (
    <div className="rounded-xl border border-border bg-card p-6 sm:p-8" role="status">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
          {doc.status === 'FAILED' ? (
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          ) : (
            <Loader2 className={cn('h-5 w-5 text-gold', isProcessing(doc.status) && 'animate-spin')} aria-hidden />
          )}
        </div>
        <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
          {doc.status === 'FAILED' ? 'Processing failed' : doc.status === 'NEEDS_OCR' ? 'Needs OCR' : 'Analysis in progress'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {doc.statusDetail ?? fallback[doc.status]}
        </p>
        {isProcessing(doc.status) && (
          <p className="mt-2 text-xs text-muted-foreground">This page updates automatically while processing runs.</p>
        )}
      </div>
    </div>
  )
}

// ═══ Analysis tab ═══
//
// Three honestly-labelled layers, always in this order:
//   A — DOCUMENT STRUCTURE: the document's own headings (origin
//       SOURCE_HEADING), word for word, with numbering and page ranges.
//   B — AI STUDY TOPICS: what Riishe inferred inside those sections (origin
//       AI_INFERRED) — always badged, never mixed into layer A.
//   C — RIISHE'S STUDY NOTES: key facts, definitions, formulas and
//       misconceptions written by Riishe — not part of the original text.
// A coverage & honesty panel at the end accounts for every page and section.

/** "SOURCE_HEADING" | "AI_INFERRED" — what a topic title represents. */
type TopicOrigin = NonNullable<AnalyzedTopicDTO['origin']>

/** Old (v3) analyses carry no `origin` — the backend default maps level-2
 *  topics to AI_INFERRED and level-1 topics to SOURCE_HEADING. Mirror that
 *  here so the previous analysis shape still renders sensibly. */
function topicOrigin(topic: AnalyzedTopicDTO): TopicOrigin {
  return topic.origin ?? (topic.level === 2 ? 'AI_INFERRED' : 'SOURCE_HEADING')
}

function AnalysisPanel({ analysis, onOpenPage, onReanalyse }: {
  analysis: DocumentAnalysisDTO
  onOpenPage: (page: number) => void
  onReanalyse: (force: boolean) => void
}) {
  const cov = analysis.coverage
  const structure = analysis.structure
  const printedOffset = structure?.printedPageOffset ?? null

  // Layer partition — defensive for analyses without `origin` (see topicOrigin).
  const structureTopics = analysis.topics.filter(t => topicOrigin(t) === 'SOURCE_HEADING')
  const inferredTopics = analysis.topics.filter(t => topicOrigin(t) === 'AI_INFERRED')
  // v5: the document's own organisation splits into major headings and their
  // numbered subsections, and groups into front matter / main chapters /
  // appendices — mirroring the source, never a flat keyword soup.
  const majorHeadings = structureTopics.filter(t => t.itemClass !== 'SOURCE_SUBSECTION')
  const subsectionTopics = structureTopics.filter(t => t.itemClass === 'SOURCE_SUBSECTION')
  const subsByParent = new Map<string, AnalyzedTopicDTO[]>()
  for (const s of subsectionTopics) {
    if (!s.parentId) continue
    const list = subsByParent.get(s.parentId)
    if (list) list.push(s)
    else subsByParent.set(s.parentId, [s])
  }
  const groupOrder: StructureGroupDTO[] = ['FRONT', 'CHAPTER', 'APPENDIX', 'OTHER']
  const groupsPresent = groupOrder.filter(g => majorHeadings.some(t => (t.group ?? 'OTHER') === g))
  const headingsInGroup = (g: StructureGroupDTO) => majorHeadings.filter(t => (t.group ?? 'OTHER') === g)

  // Layer B grouping: inferred topics sit under their parent section's own
  // heading; level-1 inferred topics (heading-less documents) and orphans
  // render as a plain list. Groups follow document order.
  const topicById = new Map(analysis.topics.map(t => [t.id, t]))
  const childrenByParent = new Map<string, AnalyzedTopicDTO[]>()
  const looseInferred: AnalyzedTopicDTO[] = []
  for (const t of inferredTopics) {
    const parent = t.parentId ? topicById.get(t.parentId) : undefined
    if (parent && topicOrigin(parent) === 'SOURCE_HEADING') {
      const list = childrenByParent.get(parent.id)
      if (list) list.push(t)
      else childrenByParent.set(parent.id, [t])
    } else {
      looseInferred.push(t)
    }
  }
  const inferredGroups = structureTopics
    .map(parent => ({ parent, children: childrenByParent.get(parent.id) ?? [] }))
    .filter(g => g.children.length > 0)

  // v5: the note says exactly what was verified — matching counts come from
  // the coverage accounting, never a single blended "validated" number.
  const matchedCount = cov?.tocMatchedHeadings ?? structure?.tocMatched ?? null
  const discoveredCount = cov?.tocDiscovered ?? structure?.tocEntries ?? null
  const verifiedStarts = cov?.tocVerifiedStarts ?? null
  const inferredStarts = cov?.tocInferredStarts ?? null
  const unresolvedStarts = cov?.tocUnresolved ?? null
  const structureNote = structure?.tocValidated
    ? `Structure read from the document's own contents table — ${discoveredCount ?? structure.tocEntries} entries discovered, ${matchedCount ?? '?'} matched to the body${verifiedStarts != null ? `, ${verifiedStarts} with a body-verified start page` : ''}. Titles below are the document's own section titles, kept word for word.`
    : structure && structure.kind !== 'UNSTRUCTURED'
      ? `Structure read from ${structure.headingCount} heading${structure.headingCount === 1 ? '' : 's'} in the document itself. Titles below are the document's own section titles, kept word for word.`
      : 'No contents page or section headings were detected in the document itself.'

  const tocUnmatched =
    structure?.tocUnmatched ?? (structure?.toc ? structure.toc.filter(e => !e.matched).length : 0)

  // v5/v6 — honest page accounting: every physical page sits in exactly one bucket.
  const contentlessCount = cov?.contentlessPages ?? 0
  const contentPages = cov ? Math.max(0, cov.readablePages - contentlessCount) : 0
  const groupStats = structure?.groupStats ?? null
  const imageContentCount = structure?.imageContentPages?.length ?? (cov ? contentlessCount : 0)
  const nonContentCount = structure?.nonContentPages?.length ?? 0
  const pageAccounting: { label: string; count: number; pct: number }[] | null = cov
    ? [
        { label: 'pages with text, analysed', count: cov.analysedPages - (cov.deterministicPages ?? 0) },
        ...(cov.deterministicPages ?? 0) > 0
          ? [{ label: 'pages analysed by deterministic list extraction (provider refused the text)', count: cov.deterministicPages ?? 0 }]
          : [],
        { label: 'pages with text, pending (failed sections)', count: cov.unanalysedPages },
        { label: 'pages with text, skipped with reason', count: cov.skippedPages },
        { label: 'image-content pages (only headers/footers in the text layer — content is an image, needs OCR)', count: imageContentCount },
        ...(nonContentCount > 0
          ? [{ label: 'verified non-content pages (no text, no images — blank/decorative)', count: nonContentCount }]
          : []),
        { label: 'image-only pages needing OCR', count: cov.scannedPages },
        { label: 'pages the extractor could not read', count: cov.failedExtractionPages ?? 0 },
        { label: 'pages never read (beyond the processing cap)', count: cov.notExtractedPages ?? 0 },
      ]
        .filter(r => r.count > 0)
        .map(r => ({ ...r, pct: cov.totalPages > 0 ? Math.round((r.count / cov.totalPages) * 100) : 0 }))
    : null

  const failedOutcomes = analysis.sectionOutcomes?.filter(o => o.status === 'FAILED') ?? []
  const skippedOutcomes = analysis.sectionOutcomes?.filter(o => o.status === 'SKIPPED') ?? []
  const recoveredOutcomes = analysis.sectionOutcomes?.filter(o => o.status === 'OK' && o.method === 'DETERMINISTIC') ?? []
  const incomplete = !!cov && !cov.complete

  // v6 — the exact pages and sections still requiring processing, each with
  // its reason. Nothing is summarised away: every page number is listed.
  const pendingGroups: { reason: string; pages: number[] }[] = cov
    ? [
        ...skippedOutcomes.map(o => ({
          reason: o.error
            ? `in skipped section "${o.title ?? o.label}" — ${o.error}`
            : `in skipped section "${o.title ?? o.label}"`,
          pages: cov.skippedPageNumbers?.filter(p => p >= o.fromPage && p <= o.toPage) ?? [],
        })),
        ...failedOutcomes.map(o => ({
          reason: `failed section "${o.title ?? o.label}" (retryable)`,
          pages: Array.from({ length: Math.max(0, o.toPage - o.fromPage + 1) }, (_, k) => o.fromPage + k),
        })),
        // spread, not nested: a non-spread conditional here would push an
        // ARRAY into this list and crash the panel on `g.pages.length`
        ...((cov.scannedPageNumbers ?? []).length > 0
          ? [{ reason: 'image-only page(s) awaiting OCR', pages: cov.scannedPageNumbers ?? [] }]
          : []),
        ...((structure?.imageContentPages ?? []).length > 0
          ? [{ reason: 'image-content page(s) awaiting OCR (only headers/footers in the text layer)', pages: structure?.imageContentPages ?? [] }]
          : []),
      ].filter(g => g.pages.length > 0)
    : []

  const hasNotes =
    analysis.keyFacts.length > 0 ||
    analysis.definitions.length > 0 ||
    analysis.formulas.length > 0 ||
    analysis.misconceptions.length > 0

  return (
    <div className="space-y-6">
      {/* Golden rule */}
      <div className="flex items-start gap-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-semibold text-gold">The golden rule:</span> every question is generated FROM this
          material — answers and page references point back to the document itself, never to outside knowledge.
        </p>
      </div>

      {/* Summary */}
      <section aria-label="Summary" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-foreground">Summary</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{analysis.summary}</p>
      </section>

      {/* Layer A — the document's own organisation */}
      <section aria-label="Document structure" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <ListTree className="h-4 w-4 text-gold" aria-hidden /> Document structure
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{structureNote}</p>

        {structureTopics.length > 0 ? (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Page chips open the integrated reader at that exact page.
            </p>
            <div className="mt-4 max-h-[36rem] space-y-5 overflow-y-auto pr-2">
              {groupsPresent.length > 1
                ? groupsPresent.map(g => (
                    <div key={g}>
                      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {GROUP_LABELS[g]}
                        <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] tracking-normal normal-case">
                          {headingsInGroup(g).length}
                        </span>
                      </p>
                      <ul className="mt-2 space-y-3">
                        {headingsInGroup(g).map((topic, i) => (
                          <SourceHeadingRow
                            key={topic.id}
                            topic={topic}
                            index={i + 1}
                            structure={structure}
                            subsections={subsByParent.get(topic.id) ?? []}
                            onOpenPage={onOpenPage}
                          />
                        ))}
                      </ul>
                    </div>
                  ))
                : (
                    <ul className="space-y-3">
                      {majorHeadings.map((topic, i) => (
                        <SourceHeadingRow
                          key={topic.id}
                          topic={topic}
                          index={i + 1}
                          structure={structure}
                          subsections={subsByParent.get(topic.id) ?? []}
                          onOpenPage={onOpenPage}
                        />
                      ))}
                    </ul>
                  )}
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
            No section headings were identified in the document — its own organisation could not be mapped.
          </p>
        )}

        {/* The "TOC vs body" honesty surface — collapsed by default so a long
            contents table never dominates the layer. */}
        {structure?.toc && structure.toc.length > 0 && <TocDisclosure structure={structure} />}
      </section>

      {/* Layer B — what Riishe identified (never mixed with the layer above) */}
      <section aria-label="AI study topics" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-gold" aria-hidden /> AI study topics
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Study topics Riishe identified inside the document. These are inferred by Riishe — the document itself does
          not contain them as headings.
        </p>

        {inferredTopics.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
            No additional study topics were inferred for this document.
          </p>
        ) : (
          <div className="mt-4 max-h-[32rem] space-y-4 overflow-y-auto pr-2">
            {inferredGroups.map(g => (
              <div key={g.parent.id}>
                <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden />
                  <span className="min-w-0 truncate font-medium text-foreground/80" title={g.parent.name}>
                    {g.parent.name}
                  </span>
                  <span className="text-muted-foreground/70">— inferred inside this section</span>
                </p>
                <ul className="mt-2 space-y-2 border-l border-gold/25 pl-3">
                  {g.children.map(child => (
                    <InferredTopicRow key={child.id} topic={child} onOpenPage={onOpenPage} printedOffset={printedOffset} />
                  ))}
                </ul>
              </div>
            ))}
            {looseInferred.length > 0 && (
              <ul className="space-y-2">
                {looseInferred.map(t => (
                  <InferredTopicRow key={t.id} topic={t} onOpenPage={onOpenPage} printedOffset={printedOffset} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Layer C — Riishe's study notes (clearly separated from the document's
          own structure above) */}
      {hasNotes && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Riishe's study notes
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Written by Riishe from this material — none of it is part of the original document.
            </p>
          </div>

      {/* Key facts — every claim page-grounded and verification-statused (v6) */}
      {analysis.keyFacts.length > 0 && (
        <section aria-label="Key facts" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-gold" aria-hidden /> Key facts
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each fact cites the page it was read from and says whether it is an exact source statement or a summary.
            Facts Riishe could not verify against any page are flagged — check them before relying on them.
          </p>
          <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-2">
            {analysis.keyFacts.map((fact, i) => (
              <li
                key={i}
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-relaxed',
                  fact.status === 'UNVERIFIED'
                    ? 'border-gold/30 bg-gold/5 text-foreground/90'
                    : 'border-transparent bg-elevated/60 text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    fact.status === 'UNVERIFIED' ? 'bg-gold' : 'bg-gold/70',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  {fact.text}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {fact.kind && (
                      <span
                        title={fact.kind === 'verbatim' ? 'Exact source statement — wording/numbers copied from the document.' : 'Condensed by Riishe from the source text — not a verbatim quote.'}
                        className="inline-flex cursor-help items-center rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground"
                      >
                        {fact.kind === 'verbatim' ? 'exact source statement' : 'summary'}
                      </span>
                    )}
                    {fact.status === 'UNVERIFIED' && (
                      <span
                        title={fact.note ?? 'No page of the extracted text supports this claim.'}
                        className="inline-flex cursor-help items-center gap-1 rounded-full border border-gold/40 px-1.5 py-px text-[10px] text-gold"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> not verified
                      </span>
                    )}
                    {fact.note && fact.status === 'VERIFIED' && fact.note.startsWith('page reference corrected') && (
                      <span title={fact.note} className="inline-flex cursor-help items-center gap-1 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                        <Info className="h-2.5 w-2.5" aria-hidden /> page corrected
                      </span>
                    )}
                    {fact.page != null && fact.page >= 1 && (
                      <PageRefChips
                        pages={[fact.page]}
                        onOpenPage={onOpenPage}
                        printedOffset={structure?.printedPageOffset ?? null}
                        compact
                      />
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Definitions */}
      {analysis.definitions.length > 0 && (
        <section aria-label="Definitions" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Lightbulb className="h-4 w-4 text-gold" aria-hidden /> Definitions
          </h2>
          <dl className="mt-4 grid max-h-96 grid-cols-1 gap-3 overflow-y-auto pr-2 sm:grid-cols-2">
            {analysis.definitions.map((def, i) => (
              <div key={i} className="rounded-lg border border-border bg-elevated p-4">
                <dt className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{def.term}</span>
                  {def.page >= 1 && (
                    <PageRefChips
                      pages={[def.page]}
                      onOpenPage={onOpenPage}
                      printedOffset={structure?.printedPageOffset ?? null}
                    />
                  )}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{def.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Formulas — verbatim transcriptions, page-cited, verification-statused (v6) */}
      {analysis.formulas.length > 0 && (
        <section aria-label="Formulas" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Sigma className="h-4 w-4 text-gold" aria-hidden /> Formulas
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Transcribed exactly as the document prints them (its own symbols and typos preserved), each with its source
            page. Formulas Riishe could not verify against the extracted text — typically equations printed as images —
            are flagged for review instead of being trusted.
          </p>
          <ul className="mt-4 space-y-2">
            {analysis.formulas.map((f, i) => (
              <li
                key={i}
                className={cn(
                  'rounded-lg border px-4 py-2.5',
                  f.status === 'NEEDS_REVIEW' ? 'border-gold/30 bg-gold/5' : 'border-border bg-elevated',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <p className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-gold" title={f.note ?? (f.status === 'NEEDS_REVIEW' ? 'Could not be verified against the extracted text.' : undefined)}>
                    {f.text}
                  </p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {f.status === 'VERIFIED' ? (
                      <span
                        title={f.note ?? 'The transcription was found on the cited page of the extracted text.'}
                        className="inline-flex cursor-help items-center gap-1 rounded-full border border-success/40 px-1.5 py-px text-[10px] text-success"
                      >
                        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden /> verified
                      </span>
                    ) : (
                      <span
                        title={f.note ?? 'Could not be verified against the extracted text — review before relying on it.'}
                        className="inline-flex cursor-help items-center gap-1 rounded-full border border-gold/40 px-1.5 py-px text-[10px] text-gold"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> needs review
                      </span>
                    )}
                    {f.page != null && f.page >= 1 && (
                      <PageRefChips
                        pages={[f.page]}
                        onOpenPage={onOpenPage}
                        printedOffset={structure?.printedPageOffset ?? null}
                        compact
                      />
                    )}
                  </span>
                </div>
                {f.note && f.status === 'NEEDS_REVIEW' && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{f.note}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Misconceptions */}
      {analysis.misconceptions.length > 0 && (
        <section aria-label="Common misconceptions" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <XCircle className="h-4 w-4 text-destructive" aria-hidden /> Common misconceptions
          </h2>
          <ul className="mt-4 space-y-3">
            {analysis.misconceptions.map((m, i) => (
              <li key={i} className="rounded-lg border border-border bg-elevated p-4">
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  <span>
                    <span className="font-medium text-destructive/90">Misconception: </span>
                    {m.misconception}
                  </span>
                </p>
                <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  <span>
                    <span className="font-medium text-success">Correction: </span>
                    {m.correction}
                    {m.page != null && m.page >= 1 && (
                      <PageRefChips
                        pages={[m.page]}
                        onOpenPage={onOpenPage}
                        printedOffset={structure?.printedPageOffset ?? null}
                      />
                    )}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

        </div>
      )}

      {/* Coverage & honesty — real accounting, never "complete" when it isn't */}
      <section aria-label="Coverage and honesty" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Info className="h-4 w-4 text-gold" aria-hidden /> Coverage &amp; honesty
        </h2>

        {cov ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  cov.complete
                    ? 'border-success/40 text-success'
                    : 'border-gold/50 bg-gold/10 text-gold'
                }
              >
                {cov.complete ? 'Fully analysed' : 'Partially analysed'}
              </Badge>
              {cov.pageAccountingComplete != null && (
                <Badge
                  variant="outline"
                  className={
                    cov.pageAccountingComplete
                      ? 'border-border text-muted-foreground'
                      : 'border-destructive/40 text-destructive'
                  }
                >
                  {cov.pageAccountingComplete
                    ? 'Every page accounted for'
                    : 'Page accounting incomplete'}
                </Badge>
              )}
              {!cov.complete && cov.pageAccountingComplete && (
                <span className="text-xs text-muted-foreground">
                  every page has an explicit disposition — but meaningful content remains unanalysed (below)
                </span>
              )}
              {structure?.kind && (
                <Badge variant="outline" className="border-border text-muted-foreground">
                  {STRUCTURE_KIND_LABEL[structure.kind]}
                </Badge>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CoverageStat
                label="Analysed pages"
                value={cov.analysedPages}
                sub={
                  [
                    cov.unanalysedPages > 0 ? `${cov.unanalysedPages} pending` : null,
                    cov.skippedPages > 0 ? `${cov.skippedPages} skipped` : null,
                  ]
                    .filter((s): s is string => !!s)
                    .join(' · ') || `of ${contentPages} content pages`
                }
              />
              <CoverageStat
                label="Scanned pages"
                value={cov.scannedPages}
                sub={cov.scannedPages > 0 ? 'image-only, need OCR' : 'none'}
              />
              {imageContentCount > 0 && (
                <CoverageStat
                  label="Image-content pages"
                  value={imageContentCount}
                  sub="text layer is only headers/footers — content is an image, needs OCR"
                />
              )}
              {nonContentCount > 0 && (
                <CoverageStat
                  label="Verified non-content"
                  value={nonContentCount}
                  sub="no text, no images — blank/decorative"
                />
              )}
              <CoverageStat
                label="Sections"
                value={cov.unitsOk}
                sub={
                  cov.unitsFailed > 0 || cov.unitsSkipped > 0
                    ? `${[cov.unitsFailed > 0 ? `${cov.unitsFailed} failed` : null, cov.unitsSkipped > 0 ? `${cov.unitsSkipped} skipped` : null]
                        .filter((s): s is string => !!s)
                        .join(' · ')} of ${cov.unitsTotal}`
                    : `${cov.unitsTotal} analysed`
                }
              />
              {(cov.failedExtractionPages ?? 0) > 0 && (
                <CoverageStat
                  label="Extraction failures"
                  value={cov.failedExtractionPages ?? 0}
                  sub="unreadable pages, excluded"
                />
              )}
              {(cov.notExtractedPages ?? 0) > 0 && (
                <CoverageStat
                  label="Never read"
                  value={cov.notExtractedPages ?? 0}
                  sub="beyond the processing cap"
                />
              )}
            </dl>

            {/* v5 — every physical page accounted for, in one bucket each */}
            {pageAccounting && (
              <div className="mt-4 rounded-lg border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-foreground">
                  Page accounting — all {cov.totalPages} physical pages
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-2">
                  {pageAccounting.map(row => (
                    <li key={row.label} className="flex items-baseline gap-1.5">
                      <span className="w-10 shrink-0 text-right font-mono text-foreground/80">
                        {row.count}
                      </span>
                      <span className="font-mono text-muted-foreground/60">({row.pct}%)</span>
                      <span>{row.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                  Percentages are of the {cov.totalPages}-page PDF. A page sits in exactly one bucket.
                </p>
              </div>
            )}

            {/* v5 — contents-entry matching accounting: a matched count is NOT
                evidence that pages or analysis are complete */}
            {discoveredCount != null && discoveredCount > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-foreground">Contents-table entries</p>
                <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-2">
                  <li><span className="font-mono text-foreground/80">{discoveredCount}</span> discovered in the document's own contents table</li>
                  {matchedCount != null && (
                    <li><span className="font-mono text-foreground/80">{matchedCount}</span> matched to a heading in the body</li>
                  )}
                  {verifiedStarts != null && (
                    <li><span className="font-mono text-foreground/80">{verifiedStarts}</span> with a body-verified start page</li>
                  )}
                  {inferredStarts != null && inferredStarts > 0 && (
                    <li><span className="font-mono text-foreground/80">{inferredStarts}</span> with only an inferred start page</li>
                  )}
                  {unresolvedStarts != null && unresolvedStarts > 0 && (
                    <li><span className="font-mono text-foreground/80">{unresolvedStarts}</span> unresolved (no plausible page)</li>
                  )}
                  {tocUnmatched > 0 && (
                    <li><span className="font-mono text-gold">{tocUnmatched}</span> not matched to the body at all</li>
                  )}
                </ul>
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                  Matching says where sections start — it is separate from page-extraction and section-analysis coverage above.
                </p>
              </div>
            )}

            {/* v6 — the exact pages still requiring processing, each with its
                reason. Click a chip to see the page itself. */}
            {pendingGroups.length > 0 && (
              <div className="mt-4 rounded-lg border border-gold/30 bg-gold/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Pages still requiring processing
                </p>
                <ul className="mt-2 space-y-1.5">
                  {pendingGroups.map((g, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] leading-relaxed text-muted-foreground">
                      <PageRefChips pages={g.pages} onOpenPage={onOpenPage} printedOffset={structure?.printedPageOffset ?? null} compact />
                      <span className="min-w-0 flex-1">{g.reason}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                  These pages carry meaningful content that was not analysed — the document is intentionally not labelled
                  fully analysed while they remain.
                </p>
              </div>
            )}

            {/* v6 — deterministic recovery is honest about its method */}
            {recoveredOutcomes.length > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-foreground">Recovered without the AI provider</p>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                  {recoveredOutcomes.map(o => (
                    <li key={`r-${o.index}`}>
                      <span className="font-medium text-foreground/80">{o.label}</span> — {o.note ?? 'entries extracted deterministically from the PDF text layer'}.{o.note && /gaps|could not be parsed/i.test(o.note) ? ' See the study gaps below.' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* v5 — per-group processing (chapters / appendices / front matter) */}
            {groupStats && groupStats.length > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-foreground">Processing by part of the document</p>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                  {groupStats.map(gs => (
                    <li key={gs.group}>
                      <span className="font-medium text-foreground/80">{GROUP_LABELS[gs.group]}:</span>{' '}
                      <span className="font-mono text-foreground/80">{gs.total}</span> entries —{' '}
                      <span className="text-success">{gs.ok} fully processed</span>
                      {gs.partial > 0 && <span>, <span className="text-gold">{gs.partial} partial</span></span>}
                      {gs.failed > 0 && <span>, <span className="text-destructive">{gs.failed} not processed</span></span>}
                      {gs.notAnalysable > 0 && (
                        <span>
                          , {gs.notAnalysable} with nothing analysable (image-only content)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cov.skippedPages > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {cov.skippedPages} readable page{cov.skippedPages === 1 ? ' sits' : 's sit'} in{' '}
                {cov.unitsSkipped} skipped section{cov.unitsSkipped === 1 ? '' : 's'} — readable, but never analysed.
              </p>
            )}
            {structure?.printedPageOffset != null && (
              <p className="mt-3 text-xs text-muted-foreground">
                This document prints its own page numbers — PDF page {structure.printedPageOffset + 1} is printed page 1
                (offset {structure.printedPageOffset}). Chips show both when known.
                {structure.printedRomanFrontMatter ? ' Front matter uses roman numerals.' : ''}
              </p>
            )}
            {tocUnmatched > 0 && (
              <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                <span>
                  {tocUnmatched} contents entr{tocUnmatched === 1 ? 'y' : 'ies'} could not be matched to the document
                  body — see the contents table above.
                </span>
              </p>
            )}
          </>
        ) : null}

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{analysis.coverageNote}</p>

        {/* Amber honesty panel: the analysis is incomplete — every failed
            (retryable) and skipped (terminal) section, with its reason. */}
        {incomplete && (
          <div className="mt-4 rounded-lg border border-gold/40 bg-gold/5 p-4" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-gold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Analysis is incomplete
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {[
                failedOutcomes.length > 0
                  ? `${failedOutcomes.length} section${failedOutcomes.length === 1 ? '' : 's'} failed`
                  : null,
                skippedOutcomes.length > 0
                  ? `${skippedOutcomes.length} skipped with a recorded reason`
                  : null,
                (cov?.failedExtractionPages ?? 0) > 0
                  ? `${cov?.failedExtractionPages} page${(cov?.failedExtractionPages ?? 0) === 1 ? ' could not be read' : 's could not be read'} by the extractor`
                  : null,
                (cov?.notExtractedPages ?? 0) > 0
                  ? `${cov?.notExtractedPages} page${(cov?.notExtractedPages ?? 0) === 1 ? ' was' : 's were'} never read (beyond the processing cap)`
                  : null,
              ]
                .filter((s): s is string => !!s)
                .join(' · ') || 'Some sections were not analysed'}
              . The counts above cover only what was actually analysed — retrying keeps every completed section.
            </p>
            <SectionOutcomeRows failed={failedOutcomes} skipped={skippedOutcomes} />
            <div className="mt-3 flex flex-wrap gap-2">
              {(failedOutcomes.length > 0 || skippedOutcomes.length > 0) && (
                <Button
                  size="sm"
                  className="bg-gold text-primary-foreground hover:bg-gold-hover"
                  onClick={() => onReanalyse(false)}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Retry unprocessed sections
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-border text-muted-foreground hover:bg-elevated"
                onClick={() => onReanalyse(true)}
              >
                Re-analyse from scratch
              </Button>
            </div>
          </div>
        )}

        {/* Quieter accounting when the analysis counts as complete but some
            sections were skipped with a recorded reason. */}
        {!incomplete && (failedOutcomes.length > 0 || skippedOutcomes.length > 0) && (
          <SectionOutcomeRows failed={failedOutcomes} skipped={skippedOutcomes} />
        )}

        {analysis.studyGaps.length > 0 && (
          <>
            <Separator className="my-4" />
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-gold" aria-hidden /> Study gaps noticed by Riishe
            </h3>
            <ul className="mt-2 space-y-1.5">
              {analysis.studyGaps.map((gap, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold/70" aria-hidden />
                  {gap}
                </li>
              ))}
            </ul>
          </>
        )}

        {analysis.unreadableSections.length > 0 && (
          <>
            <Separator className="my-4" />
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileWarning className="h-3.5 w-3.5 text-gold" aria-hidden /> Sections Riishe could not read
            </h3>
            <ul className="mt-2 space-y-1.5">
              {analysis.unreadableSections.map((s, i) => (
                <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                  {s}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

const STRUCTURE_KIND_LABEL: Record<NonNullable<DocumentAnalysisDTO['structure']>['kind'], string> = {
  TOC_GUIDED: 'Contents-page structure',
  HEADING_GUIDED: 'Heading structure',
  QUESTION_PAPER: 'Question paper',
  UNSTRUCTURED: 'Free-form document',
}

/** At most `max` distinct sorted pages; the rest are summarised as "+N more". */
function capPages(pages: number[], max: number): { pages: number[]; hidden: number; rest: number[] } {
  const sorted = [...new Set(pages)].filter(p => Number.isFinite(p) && p >= 1).sort((a, b) => a - b)
  return { pages: sorted.slice(0, max), hidden: Math.max(0, sorted.length - max), rest: sorted.slice(max) }
}

// ─── Layer A: the document's own section headings ───

/** Labels for the document's own organisation groups (shown only when the
 *  document actually HAS more than one group — never forced on other docs). */
const GROUP_LABELS: Record<StructureGroupDTO, string> = {
  FRONT: 'Front matter & preliminary information',
  CHAPTER: 'Main chapters',
  APPENDIX: 'Appendices & annexures',
  OTHER: 'Other sections',
}

/** Page-mapping honesty badge: how this section's page references were established. */
function PageMappingBadge({ topic }: { topic: AnalyzedTopicDTO }) {
  const mapping = topic.pageMapping
  if (!mapping || mapping === 'VERIFIED') return null
  const tip =
    mapping === 'INFERRED'
      ? topic.boundaryEvidence
        ? `Page references follow from the document's own contents claim — the body could not confirm them directly. ${topic.boundaryEvidence}`
        : 'Page references follow from the document\'s own contents claim — the body could not confirm them directly.'
      : 'No reliable page could be established for this section from the document itself.'
  return (
    <span
      title={tip}
      className={cn(
        'inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
        mapping === 'INFERRED' ? 'border-gold/40 text-gold' : 'border-destructive/40 text-destructive',
      )}
    >
      <Info className="h-3 w-3" aria-hidden /> {mapping === 'INFERRED' ? 'pages inferred' : 'pages unresolved'}
    </span>
  )
}

/** Expandable page-chip row: at most `max` chips, "+N more" reveals the rest. */
function ExpandablePageChips({ pages, onOpenPage, printedOffset, max }: {
  pages: number[]
  onOpenPage: (page: number) => void
  printedOffset?: number | null
  max: number
}) {
  const [expanded, setExpanded] = useState(false)
  const capped = capPages(pages, max)
  if (capped.pages.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <PageRefChips pages={expanded ? [...capped.pages, ...capped.rest] : capped.pages} onOpenPage={onOpenPage} printedOffset={printedOffset} compact />
      {capped.hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-[11px] text-muted-foreground/70 underline decoration-dotted underline-offset-2 transition-colors hover:text-gold"
          aria-expanded={expanded}
        >
          {expanded ? 'show less' : `+${capped.hidden} more`}
        </button>
      )}
    </span>
  )
}

/**
 * One SOURCE_HEADING topic — the document's own section. The exact original
 * wording is rendered verbatim (never rewritten); `numbering` is shown as a
 * small mono/gold chip when the document prints one. No origin badge here:
 * these rows ARE the document. Numbered source subsections render nested
 * beneath their section, clearly smaller — they are part of the original
 * structure, never mixed into the AI-inferred layer.
 */
function SourceHeadingRow({ topic, index, structure, subsections, onOpenPage }: {
  topic: AnalyzedTopicDTO
  index: number
  structure?: DocStructureInfoDTO
  subsections: AnalyzedTopicDTO[]
  onOpenPage: (page: number) => void
}) {
  return (
    <li className="rounded-lg border border-border bg-elevated p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground/50" aria-hidden>
            {index}
          </span>
          {topic.numbering && (
            <Badge variant="outline" className="shrink-0 border-gold/30 font-mono text-[11px] text-gold/90">
              {topic.numbering}
            </Badge>
          )}
          <p className="min-w-0 text-sm font-semibold text-foreground" title={topic.name}>
            {topic.name}
          </p>
          <StructureUnverifiedBadge topic={topic} structure={structure} />
          <PageMappingBadge topic={topic} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ExpandablePageChips pages={topic.pages} onOpenPage={onOpenPage} printedOffset={structure?.printedPageOffset ?? null} max={10} />
        </div>
      </div>
      {topic.aliases.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground/70">also found as: {topic.aliases.join(' · ')}</p>
      )}
      {topic.list && <RecoveredListBlock list={topic.list} onOpenPage={onOpenPage} topicPages={topic.pages} />}
      {!topic.list && topic.subtopics.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/60">
            Keywords &amp; entities — extracted terms, not document sections
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {topic.subtopics.map(sub => (
              <Badge key={sub} variant="outline" className="border-border/70 text-muted-foreground">
                {sub}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {subsections.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-l border-gold/20 pl-3">
          {subsections.map(sub => (
            <SubsectionRow key={sub.id} topic={sub} structure={structure} onOpenPage={onOpenPage} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * A reference list recovered DETERMINISTICALLY from the PDF text layer (the
 * AI provider refused the raw text). Entries are verbatim, in source order,
 * grouped exactly as the source groups them; unreadable rows and serial gaps
 * are disclosed — never hidden.
 */
function RecoveredListBlock({ list, onOpenPage, topicPages }: {
  list: ListExtractionDTO
  onOpenPage: (page: number) => void
  topicPages: number[]
}) {
  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
          <ListTree className="h-3 w-3" aria-hidden /> Extracted from the PDF text layer
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {list.totalEntries} {list.totalEntries === 1 ? 'entry' : 'entries'}
          {list.groups.filter(g => g.label).length > 0
            ? ` in ${list.groups.filter(g => g.label).length} group${list.groups.filter(g => g.label).length === 1 ? '' : 's'} (as the document groups them)`
            : ''}
          {' — '}read directly from {' '}
          <PageRefChips pages={topicPages.slice(0, 6)} onOpenPage={onOpenPage} compact />
        </span>
      </div>
      {list.header && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">header row: {list.header}</p>
      )}
      {list.unreadableRows.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-gold">
          {list.unreadableRows.length} row{list.unreadableRows.length === 1 ? '' : 's'} could not be parsed and are
          reported rather than dropped: {list.unreadableRows.join(' · ')}
        </p>
      )}
      {list.serialGaps.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-gold">
          Serial-number gaps detected (possible missed rows): {list.serialGaps.join('; ')}
        </p>
      )}
      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
        {list.groups.map((g, gi) => (
          <div key={gi}>
            {g.label && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                {g.label} <span className="font-mono text-[10px] font-normal text-muted-foreground/60">({g.entries.length})</span>
              </p>
            )}
            <ul className={cn('mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-foreground/90 sm:grid-cols-2', g.label && 'border-l border-gold/20 pl-2.5')}>
              {g.entries.map((e, ei) => (
                <li key={`${gi}-${ei}`} className="truncate" title={e}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One numbered source subsection ("4.1 Reservations") — original wording,
 *  its own verified page chips, visually a child of its section. */
function SubsectionRow({ topic, structure, onOpenPage }: {
  topic: AnalyzedTopicDTO
  structure?: DocStructureInfoDTO
  onOpenPage: (page: number) => void
}) {
  return (
    <li className="rounded border border-border/60 bg-card/60 px-2.5 py-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {topic.numbering && (
            <Badge variant="outline" className="shrink-0 border-gold/20 font-mono text-[10px] text-gold/80">
              {topic.numbering}
            </Badge>
          )}
          <p className="min-w-0 text-xs font-medium text-foreground/90" title={topic.name}>
            {topic.name}
          </p>
          <PageMappingBadge topic={topic} />
        </div>
        <ExpandablePageChips pages={topic.pages} onOpenPage={onOpenPage} printedOffset={structure?.printedPageOffset ?? null} max={6} />
      </div>
    </li>
  )
}

/** Leading numbering token, mirrored from the backend's contents-table parser
 *  so topic ↔ contents-entry matching still works when one side keeps the
 *  number and the other does not. */
const NUMBER_PREFIX_RE =
  /^(?:(?:chapter|appendix|annexure|annex|unit|part|section|paper|lesson|module)\s*[-–—:]?\s*(?:[0-9]{1,3}|[ivxlcdm]{1,7}|[a-z])|\d{1,2}(?:\.\d{1,2})?|[ivxlcdm]{1,7})\b[\s.:—–-]*/i

function normalizeTitleLoose(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Honest "unverified" marker: with a validated contents table, a section is
 *  unverified when the pipeline could not confirm it in the body (or no
 *  contents entry matched it). Tooltip carries the recorded note when known. */
function StructureUnverifiedBadge({ topic, structure }: {
  topic: AnalyzedTopicDTO
  structure?: DocStructureInfoDTO
}) {
  if (!structure?.tocValidated) return null
  if (topic.structureVerified !== false && topic.tocMatchPage != null) return null
  return (
    <span
      title={structureNoteForTopic(topic, structure)}
      className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
    >
      <Info className="h-3 w-3" aria-hidden /> unverified
    </span>
  )
}

function structureNoteForTopic(topic: AnalyzedTopicDTO, structure: DocStructureInfoDTO): string {
  const name = normalizeTitleLoose(topic.name)
  const bare = name.replace(NUMBER_PREFIX_RE, '')
  const entry = (structure.toc ?? []).find(e => {
    const title = normalizeTitleLoose(e.title)
    return title === name || (title.replace(NUMBER_PREFIX_RE, '') === bare && bare.length > 0)
  })
  if (entry?.note) return entry.note
  return topic.structureVerified === false
    ? 'Listed in the contents table, but the section could not be confirmed at the expected place in the document body.'
    : 'This heading was read from the document body; no matching entry was found in the contents table, so it was not cross-checked.'
}

// ─── Layer A: the original contents table, honestly reconciled with the body ───

/**
 * Collapsed-by-default disclosure of the document's own contents entries —
 * original wording kept, each entry checked against where it actually appears
 * in the body, with its printed range, physical span and how the boundaries
 * were established. This is the "TOC vs body" honesty surface.
 */
function TocDisclosure({ structure }: { structure: DocStructureInfoDTO }) {
  const entries = structure.toc ?? []
  if (entries.length === 0) return null
  const matched = structure.tocMatched ?? entries.filter(e => e.matched).length
  const unmatched = structure.tocUnmatched ?? entries.filter(e => !e.matched).length
  return (
    <Collapsible className="group mt-4">
      <CollapsibleTrigger
        className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated px-4 py-2.5 text-left transition-colors hover:border-gold/40"
        aria-label={`Toggle the document's contents table (${entries.length} entries)`}
      >
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
        <span className="text-sm font-medium text-foreground">
          Contents table ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-success">{matched} matched</span>
          {unmatched > 0 && <span className="text-gold">{unmatched} not matched</span>}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-elevated/50 p-2">
          {entries.map((e, i) => (
            <li
              key={`${i}-${e.title}`}
              className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-border/50 bg-card px-2.5 py-1.5', e.level === 2 && 'ml-4')}
            >
              {e.number && (
                <span className="shrink-0 rounded border border-gold/30 px-1.5 py-0.5 font-mono text-[10px] text-gold/90">
                  {e.number}
                </span>
              )}
              {e.group && entries.length > 1 && e.level === 1 && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                  {TOC_GROUP_SHORT[e.group]}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/90" title={e.title}>
                {e.title}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {e.printedPage != null
                  ? `printed p. ${e.printedPage}${e.printedPageEnd != null ? `–${e.printedPageEnd}` : ''}`
                  : 'no printed page'}
                {e.startPage != null ? ` → PDF p. ${e.startPage}${e.endPage != null && e.endPage > e.startPage ? `–${e.endPage}` : ''}` : e.matchPage != null ? ` → PDF p. ${e.matchPage}` : ''}
              </span>
              {e.matched ? (
                <span
                  className="shrink-0"
                  title={[
                    e.startStatus === 'VERIFIED' ? 'Start page confirmed in the document body.' : e.startStatus === 'INFERRED' ? 'Start page follows from the contents claim (not body-confirmed).' : 'No plausible page could be established.',
                    e.boundaryEvidence ? `Boundaries: ${e.boundaryEvidence}.` : null,
                  ].filter(Boolean).join(' ')}
                >
                  <CheckCircle2
                    className={cn('h-3.5 w-3.5', e.startStatus === 'VERIFIED' ? 'text-success' : 'text-gold')}
                    aria-label={e.startStatus === 'VERIFIED' ? 'Matched in the document body, start verified' : 'Matched, start inferred from the contents claim'}
                  />
                </span>
              ) : (
                <span
                  className="shrink-0"
                  title={e.note ?? 'This contents entry could not be located in the document body.'}
                >
                  <AlertTriangle
                    className="h-3.5 w-3.5 text-gold"
                    aria-label="Could not be matched in the document body"
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          The document's own contents list, exactly as printed, checked against where each entry actually appears in
          the body. Original wording is kept — nothing is rewritten. Green: start page confirmed in the body; amber
          check: matched but the start could only be inferred from the contents claim.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

const TOC_GROUP_SHORT: Record<StructureGroupDTO, string> = {
  FRONT: 'front',
  CHAPTER: 'chapter',
  APPENDIX: 'appendix',
  OTHER: 'section',
}

// ─── Layer B: what Riishe inferred ───

/** Item-class label for inferred topics (kept short; tooltip explains). */
const ITEM_CLASS_LABEL: Record<TopicItemClassDTO, string> = {
  ORIGINAL_HEADING: 'original heading',
  SOURCE_SUBSECTION: 'source subsection',
  LEARNING_TOPIC: 'inferred topic',
  KEYWORD: 'keyword / entity',
  TABLE_OR_LIST: 'from a table or list',
  QUESTION_GROUP: 'question group',
  UNCLASSIFIED: 'needs review',
}

function itemClassTip(cls: TopicItemClassDTO): string {
  switch (cls) {
    case 'LEARNING_TOPIC': return 'A study topic Riishe identified in the content — the document does not contain it as a heading.'
    case 'TABLE_OR_LIST': return 'Extracted from a table or reference list in the document.'
    case 'QUESTION_GROUP': return 'Covers a question or question group in the document.'
    case 'UNCLASSIFIED': return 'Riishe could not verify this topic against the document pages — treat with care.'
    default: return 'Part of the document\'s own structure.'
  }
}

/**
 * One focus chip in the generator — sections and inferred topics look
 * different on purpose: an inferred topic must never pass for a chapter.
 */
function FocusChip({ topic, active, onToggle, tone }: {
  topic: AnalyzedTopicDTO
  active: boolean
  onToggle: (name: string) => void
  tone: 'section' | 'inferred'
}) {
  const cls = topic.itemClass ?? (tone === 'inferred' ? 'LEARNING_TOPIC' : 'ORIGINAL_HEADING')
  const special = tone === 'inferred' && cls !== 'LEARNING_TOPIC'
  return (
    <button
      type="button"
      aria-pressed={active}
      title={`${topic.name} — ${itemClassTip(cls)}`}
      onClick={() => onToggle(topic.name)}
      className={cn(
        'min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors',
        active
          ? 'border-gold/60 bg-gold/15 text-gold'
          : tone === 'section'
            ? 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold'
            : 'border-dashed border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
      )}
    >
      {tone === 'section' ? topic.name : <span className="italic">{topic.name}</span>}
      {special && <span className="ml-1.5 text-[10px] text-muted-foreground/70">({ITEM_CLASS_LABEL[cls]})</span>}
    </button>
  )
}

/**
 * One AI_INFERRED study topic — always badged so it can never be mistaken for
 * the document's own headings. Subtopics render as small chips, page refs as
 * the shared page chips.
 */
function InferredTopicRow({ topic, onOpenPage, printedOffset }: {
  topic: AnalyzedTopicDTO
  onOpenPage: (page: number) => void
  printedOffset?: number | null
}) {
  const capped = capPages(topic.pages, 6)
  const cls = topic.itemClass ?? 'LEARNING_TOPIC'
  const needsClassLabel = cls !== 'LEARNING_TOPIC'
  return (
    <li className="rounded border border-border/60 bg-card/60 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Badge variant="outline" className="mt-0.5 shrink-0 gap-1 border-border text-muted-foreground">
            <Sparkles className="h-3 w-3" aria-hidden /> Inferred
          </Badge>
          <p className="min-w-0 text-xs font-medium text-foreground/90" title={topic.name}>
            {topic.name}
          </p>
          {needsClassLabel && (
            <span
              title={itemClassTip(cls)}
              className={cn(
                'mt-0.5 inline-flex shrink-0 cursor-help items-center rounded-full border px-2 py-0.5 text-[10px]',
                cls === 'UNCLASSIFIED' ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground',
              )}
            >
              {ITEM_CLASS_LABEL[cls]}
            </span>
          )}
          {cls === 'UNCLASSIFIED' && <PageMappingBadge topic={topic} />}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {capped.pages.length > 0 && (
            <ExpandablePageChips pages={capped.pages} onOpenPage={onOpenPage} printedOffset={printedOffset} max={6} />
          )}
        </div>
      </div>
      {topic.aliases.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground/70">also found as: {topic.aliases.join(' · ')}</p>
      )}
      {topic.subtopics.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {topic.subtopics.map(sub => (
            <Badge key={sub} variant="outline" className="border-border text-muted-foreground">
              {sub}
            </Badge>
          ))}
        </div>
      )}
    </li>
  )
}

// ─── Coverage: section-by-section accounting ───

/** Every failed (retryable) and skipped (terminal) section, always with the
 *  recorded reason — never a bare count. */
function SectionOutcomeRows({ failed, skipped }: {
  failed: SectionOutcomeDTO[]
  skipped: SectionOutcomeDTO[]
}) {
  if (failed.length === 0 && skipped.length === 0) return null
  return (
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
      {failed.map(o => (
        <div key={`f-${o.index}`} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
            <span>
              <span className="font-medium text-destructive/90">Not analysed (retryable): </span>
              {o.label}
            </span>
          </p>
          {o.error && <p className="ml-5 text-[11px] text-muted-foreground">{o.error}</p>}
        </div>
      ))}
      {skipped.map(o => (
        <div key={`s-${o.index}`} className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
            <span>
              <span className="font-medium text-gold">Skipped with reason: </span>
              {o.label}
            </span>
          </p>
          {o.error && <p className="ml-5 text-[11px] leading-relaxed text-muted-foreground">{o.error}</p>}
        </div>
      ))}
    </div>
  )
}

function CoverageStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-lg font-semibold text-foreground">{value}</dd>
      {sub && <p className="text-[11px] text-muted-foreground/80">{sub}</p>}
    </div>
  )
}

// ═══ Tests tab ═══

function TestsPanel({
  doc,
  guestId,
  onDocRefresh,
}: {
  doc: MaterialDetailDTO
  guestId: string
  onDocRefresh: () => void
}) {
  const navigate = useAppStore(s => s.navigate)

  // Generator options — topic records keep their stable unique ids even when two
  // sections of the document share a display name (e.g. "Required Documents").
  const analysisTopics = doc.analysis?.topics ?? []
  // Focus chips split by what the title IS: the document's own sections and
  // subsections vs study topics Riishe inferred inside them.
  const focusSections = analysisTopics.filter(t => topicOrigin(t) === 'SOURCE_HEADING')
  const focusInferred = analysisTopics.filter(t => topicOrigin(t) === 'AI_INFERRED')
  const [selectedFocus, setSelectedFocus] = useState<string[]>([])
  const [timed, setTimed] = useState(true)
  const [count, setCount] = useState<100 | 50 | 30 | 20>(50)
  const [generating, setGenerating] = useState(false)

  // Active test detail (fetched + polled separately from the material)
  const [activeTestId, setActiveTestId] = useState<string | null>(null)
  const [testLoaded, setTestLoaded] = useState<{ key: string; data: RiisheTestDetailDTO } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)

  const sortedTests = [...doc.tests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  // Auto-pick: an in-flight test first, otherwise the newest READY test.
  const inflight = doc.tests.find(t => t.status === 'QUEUED' || t.status === 'GENERATING')
  const latestReady = sortedTests.find(t => t.status === 'READY')
  const activeId = activeTestId ?? inflight?.id ?? latestReady?.id ?? null
  const activeTest = testLoaded && testLoaded.key === activeId ? testLoaded.data : null

  // Fetch + poll the active test every 4s until it settles (READY / FAILED).
  useEffect(() => {
    if (!guestId || !activeId) return
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const fetchOnce = () => {
      api
        .riisheTest(activeId, guestId)
        .then(d => {
          if (!alive) return
          setTestLoaded({ key: activeId, data: d })
          setTestError(null)
          if (timer && d.status !== 'QUEUED' && d.status !== 'GENERATING') {
            clearInterval(timer)
            timer = null
          }
        })
        .catch((e: unknown) => {
          if (!alive) return
          setTestError(e instanceof Error ? e.message : 'Could not load the test status.')
        })
    }
    fetchOnce()
    timer = setInterval(fetchOnce, 4000)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [guestId, activeId])

  const toggleFocus = (name: string) => {
    setSelectedFocus(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : prev.length >= 3 ? prev : [...prev, name],
    )
  }

  const generate = () => {
    if (generating || doc.status !== 'READY') return
    setGenerating(true)
    setTestError(null)
    api
      .generateRiisheTest({
        guestId,
        documentId: doc.id,
        focusTopics: selectedFocus.length ? selectedFocus : undefined,
        timed,
        count,
      })
      .then(r => {
        setActiveTestId(r.testId)
        if (r.existing) {
          toast({
            title: 'Identical test already prepared',
            description: 'Riishe reused the matching in-flight test instead of generating a duplicate.',
          })
        }
        onDocRefresh()
      })
      .catch((e: unknown) => {
        setTestError(e instanceof Error ? e.message : 'Could not start generation.')
      })
      .finally(() => setGenerating(false))
  }

  const startTest = (testId: string) => {
    if (startingId) return
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

  const canGenerate = doc.status === 'READY'

  const generateNote =
    doc.status === 'NEEDS_OCR'
      ? 'Questions cannot be generated — this document could not be analysed (scanned pages, OCR unavailable).'
      : doc.status === 'FAILED'
        ? 'Processing failed — retry it from the Material tab before generating a test.'
        : !canGenerate
          ? 'Generation unlocks once the document analysis completes.'
          : null

  return (
    <div className="space-y-6">
      {/* Generate section */}
      <section aria-label="Generate a test" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-gold" aria-hidden /> Generate a test
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Questions are drawn strictly from this document. Leave the focus empty for a balanced mix across it.
        </p>

        {/* Topic focus — official sections and Riishe-inferred topics are two
            clearly separated groups so an inferred topic can never pass for a
            chapter of the document. */}
        {analysisTopics.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Topic focus <span className="normal-case tracking-normal">(up to 3, optional)</span>
            </p>
            <div className="mt-2 max-h-72 space-y-3 overflow-y-auto pr-1" role="group" aria-label="Topic focus selector">
              {focusSections.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70">
                    Document sections &amp; subsections
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {focusSections.map(topic => (
                      <FocusChip key={topic.id} topic={topic} active={selectedFocus.includes(topic.name)} onToggle={toggleFocus} tone="section" />
                    ))}
                  </div>
                </div>
              )}
              {focusInferred.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70">
                    Riishe-inferred topics
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {focusInferred.map(topic => (
                      <FocusChip key={topic.id} topic={topic} active={selectedFocus.includes(topic.name)} onToggle={toggleFocus} tone="inferred" />
                    ))}
                  </div>
                </div>
              )}
            </div>
            {selectedFocus.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Balanced mix across the document.</p>
            )}
          </div>
        ) : (
          canGenerate && (
            <p className="mt-4 text-xs text-muted-foreground">Balanced mix across the document.</p>
          )
        )}

        {/* Timed / untimed + count */}
        <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Time</p>
            <RadioGroup
              value={timed ? 'timed' : 'untimed'}
              onValueChange={v => setTimed(v === 'timed')}
              className="mt-2 flex flex-wrap gap-4"
            >
              <div className="flex min-h-9 items-center gap-2">
                <RadioGroupItem value="timed" id="riishe-timed" />
                <Label htmlFor="riishe-timed" className="cursor-pointer text-sm font-normal">
                  Timed — about {Math.max(10, count)} min
                </Label>
              </div>
              <div className="flex min-h-9 items-center gap-2">
                <RadioGroupItem value="untimed" id="riishe-untimed" />
                <Label htmlFor="riishe-untimed" className="cursor-pointer text-sm font-normal">
                  Untimed — no time limit
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Questions</p>
            <div className="mt-2 flex gap-2" role="group" aria-label="Question count">
              {([100, 50, 30, 20] as const).map(n => (
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
            </div>
          </div>
        </div>

        {/* Distribution preview */}
        <p className="mt-4 rounded-lg border border-border bg-elevated px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Planned mix: </span>
          {distributionLine(count)}
          {count !== 50 ? ` — scaled to ${count} questions` : ''}
        </p>

        {generateNote && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
            {generateNote}
          </p>
        )}

        {testError && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive" role="alert">
            {testError}
          </p>
        )}

        <Button
          className="mt-4 bg-gold text-primary-foreground hover:bg-gold-hover"
          disabled={!canGenerate || generating}
          onClick={generate}
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Starting generation…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Generate {count} Questions
            </>
          )}
        </Button>
      </section>

      {/* Active test: live progress / failure / pre-test summary */}
      {activeId && (
        <section aria-label="Selected test">
          {!activeTest && (
            <div className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-hidden>
              <Skeleton className="h-6 w-1/2 bg-elevated" />
              <Skeleton className="mt-4 h-24 bg-elevated" />
            </div>
          )}

          {activeTest && (activeTest.status === 'QUEUED' || activeTest.status === 'GENERATING') && (
            <div className="rounded-xl border border-gold/40 bg-gold/5 p-5 sm:p-6" role="status">
              <p className="flex items-center gap-2 text-sm font-medium text-gold">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {activeTest.status === 'QUEUED' ? 'Queued — waiting for the generator…' : 'Generating questions…'}
              </p>
              {/* Honest progress: a pulsing bar, never a fake percentage */}
              <div className="mt-3 h-2 overflow-hidden rounded bg-elevated" aria-hidden>
                <div className="h-full w-1/3 animate-pulse rounded bg-gold/60" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {activeTest.statusDetail ??
                  'Validated questions are generated in batches — this updates automatically. No percentage is shown because the remaining work is not predictable.'}
              </p>
            </div>
          )}

          {activeTest && activeTest.status === 'FAILED' && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 sm:p-6" role="alert">
              <p className="font-display text-lg font-semibold text-destructive">Generation failed</p>
              <p className="mt-2 text-sm leading-relaxed text-destructive/90">
                {activeTest.statusDetail ?? 'Riishe could not produce enough validated questions from this document.'}
              </p>
              <Button
                variant="outline"
                className="mt-4 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={generate}
                disabled={!canGenerate || generating}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" /> Try again
              </Button>
            </div>
          )}

          {activeTest && activeTest.status === 'READY' && (
            <PreTestSummaryCard
              test={activeTest}
              starting={startingId === activeTest.id}
              onStart={() => startTest(activeTest.id)}
            />
          )}
        </section>
      )}

      {/* History */}
      <section aria-label="Test history" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <ClipboardList className="h-4 w-4 text-gold" aria-hidden /> Test history
        </h2>

        {sortedTests.length === 0 ? (
          <p className="mt-5 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted-foreground">
            No tests generated for this document yet.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {sortedTests.map(t => (
              <TestHistoryRow
                key={t.id}
                test={t}
                starting={startingId === t.id}
                onSelect={() => setActiveTestId(t.id)}
                onStart={() => startTest(t.id)}
              />
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Completed attempts and their scores appear in My Progress.
        </p>
      </section>
    </div>
  )
}

// ─── Pre-test summary ───

function PreTestSummaryCard({
  test,
  starting,
  onStart,
}: {
  test: RiisheTestDetailDTO
  starting: boolean
  onStart: () => void
}) {
  const stats = test.stats
  const difficulty = stats?.byDifficulty
  const scoring = `+${test.config.marksPerQuestion} per correct${
    test.config.negativeMark > 0 ? `, −${test.config.negativeMark} per wrong answer` : ', no negative marking'
  }`

  return (
    <div className="rounded-xl border border-gold/40 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground" title={test.title}>
            {test.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Source document: {test.documentTitle}
            {test.weakFocus ? ' · weak-area focus' : ''}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 border-success/40 bg-success/10 text-success">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryItem label="Focus" value={test.focusTopics.length ? test.focusTopics.join(' · ') : 'Balanced mix across the document'} />
        <SummaryItem
          label="Questions"
          value={
            stats
              ? `${test.questionCount} (validated ${stats.validated} of ${stats.generated} generated)`
              : String(test.questionCount)
          }
        />
        <SummaryItem label="Scoring" value={scoring} />
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm text-foreground">{value}</p>
    </div>
  )
}

// ─── History row ───

function TestHistoryRow({
  test,
  starting,
  onSelect,
  onStart,
}: {
  test: MaterialDetailDTO['tests'][number]
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
            className="group rounded text-left"
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
            {test.weakFocus && (
              <Badge variant="outline" className="border-destructive/40 text-destructive">Weak-area focus</Badge>
            )}
          </p>
          {test.focusTopics.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {test.focusTopics.map(topic => (
                <Badge key={topic} variant="outline" className="border-border text-muted-foreground">
                  {topic}
                </Badge>
              ))}
            </div>
          )}
          {test.status === 'FAILED' && test.statusDetail && (
            <p className="mt-1.5 text-xs leading-relaxed text-destructive/90">{test.statusDetail}</p>
          )}
          {(test.status === 'QUEUED' || test.status === 'GENERATING') && (
            <p className="mt-1.5 text-xs text-gold">Generation in progress — this row updates automatically.</p>
          )}
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

function TestHistoryBadge({ status }: { status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED' }) {
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
