'use client'

// Riishe AI workspace — upload → analyse → test, applied to your own materials.
// HUB (#/riishe): the three-step flow, READY materials, weak areas, BEAN handoff.
// WORKSPACE (#/riishe/[docId]): one document — Material / Analysis / Tests tabs.
// All data comes from the backend pipeline; every state shown is honest.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  DocumentAnalysisDTO,
  MaterialDetailDTO,
  MaterialListItemDTO,
  MaterialStatus,
  RiisheTestDetailDTO,
  RiisheWeakTopicDTO,
} from '@/lib/types'
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
  ClipboardList,
  Download,
  FileText,
  FileWarning,
  Info,
  Lightbulb,
  ListChecks,
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

/** [1,2,3,7] → "pages 1–3, 7" · [5] → "page 5" */
function formatPageRefs(pages: number[]): string {
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

export function RiisheView({ docId }: { docId?: string }) {
  if (!docId) return <RiisheHub />
  return <RiisheWorkspace docId={docId} />
}

// ═══════════════════════════ HUB ═══════════════════════════

function RiisheHub() {
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
                    onClick={() => navigate({ view: 'riishe', docId: firstWeakWithDoc.documentId as string })}
                  >
                    <Play className="mr-2 h-4 w-4" aria-hidden /> Practice weak areas
                  </Button>
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

function RiisheWorkspace({ docId }: { docId: string }) {
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
            <MaterialReadyPanel doc={doc} guestId={guestId} />
          ) : (
            <MaterialPendingPanel doc={doc} />
          )}
        </TabsContent>

        {hasAnalysis && doc.analysis && (
          <TabsContent value="analysis" className="mt-4">
            <AnalysisPanel analysis={doc.analysis} />
          </TabsContent>
        )}

        <TabsContent value="tests" className="mt-4">
          <TestsPanel doc={doc} guestId={guestId} onDocRefresh={refresh} />
        </TabsContent>
      </Tabs>

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

// ─── Material tab: READY → document panel + integrated reader (full-viewport overlay) ───

function MaterialReadyPanel({ doc, guestId }: { doc: MaterialDetailDTO; guestId: string }) {
  const [readerOpen, setReaderOpen] = useState(false)
  const navigate = useAppStore(s => s.navigate)
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
          onClick={() => setReaderOpen(true)}
        >
          <BookOpen className="mr-2 h-4 w-4" aria-hidden /> Open in reader
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button asChild className="bg-gold text-primary-foreground hover:bg-gold-hover">
          <a
            href={api.materialFileUrl(doc.id, true, guestId)}
            download={doc.originalName}
            aria-label={`Download ${doc.title} as PDF`}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden /> Download PDF
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">Served from your own session — only you can open this file.</p>
      </div>

      {readerOpen && (
        <MaterialPdfReader
          documentId={doc.id}
          title={doc.title}
          guestId={guestId}
          onBack={() => setReaderOpen(false)}
        />
      )}
    </div>
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

function AnalysisPanel({ analysis }: { analysis: DocumentAnalysisDTO }) {
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

      {/* Topics */}
      {analysis.topics.length > 0 && (
        <section aria-label="Topics" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <ListChecks className="h-4 w-4 text-gold" aria-hidden /> Topics
          </h2>
          <ul className="mt-4 space-y-4">
            {analysis.topics.map(topic => (
              <li key={topic.name} className="rounded-lg border border-border bg-elevated p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{topic.name}</p>
                  {topic.pages.length > 0 && (
                    <Badge variant="outline" className="border-border text-xs text-muted-foreground">
                      {formatPageRefs(topic.pages)}
                    </Badge>
                  )}
                </div>
                {topic.subtopics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {topic.subtopics.map(sub => (
                      <Badge key={sub} variant="outline" className="border-border text-muted-foreground">
                        {sub}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Key facts */}
      {analysis.keyFacts.length > 0 && (
        <section aria-label="Key facts" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-gold" aria-hidden /> Key facts
          </h2>
          <ul className="mt-4 space-y-2">
            {analysis.keyFacts.map((fact, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
                {fact}
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
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {analysis.definitions.map((def, i) => (
              <div key={i} className="rounded-lg border border-border bg-elevated p-4">
                <dt className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{def.term}</span>
                  <Badge variant="outline" className="shrink-0 border-gold/30 text-xs text-gold">
                    {formatPageRefs([def.page])}
                  </Badge>
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{def.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Formulas */}
      {analysis.formulas.length > 0 && (
        <section aria-label="Formulas" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Sigma className="h-4 w-4 text-gold" aria-hidden /> Formulas
          </h2>
          <ul className="mt-4 space-y-2">
            {analysis.formulas.map((f, i) => (
              <li
                key={i}
                className="overflow-x-auto rounded-lg border border-border bg-elevated px-4 py-2.5 font-mono text-sm text-gold"
              >
                {f}
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
                    {m.page != null && (
                      <Badge variant="outline" className="ml-2 border-border text-xs text-muted-foreground">
                        {formatPageRefs([m.page])}
                      </Badge>
                    )}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Coverage note + honest gaps */}
      <section aria-label="Coverage and gaps" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Info className="h-4 w-4 text-gold" aria-hidden /> Coverage &amp; gaps
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{analysis.coverageNote}</p>

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

  // Generator options
  const analysisTopics = doc.analysis?.topics.map(t => t.name) ?? []
  const [selectedFocus, setSelectedFocus] = useState<string[]>([])
  const [timed, setTimed] = useState(true)
  const [count, setCount] = useState<50 | 30 | 20>(50)
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

        {/* Topic focus */}
        {analysisTopics.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Topic focus <span className="normal-case tracking-normal">(up to 3, optional)</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Topic focus selector">
              {analysisTopics.map(name => {
                const active = selectedFocus.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleFocus(name)}
                    className={cn(
                      'min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors',
                      active
                        ? 'border-gold/60 bg-gold/15 text-gold'
                        : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                    )}
                  >
                    {name}
                  </button>
                )
              })}
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
              {([50, 30, 20] as const).map(n => (
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
