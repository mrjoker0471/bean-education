'use client'

// My Materials — the Riishe library. Upload a PDF, watch honest processing
// status, and jump into the Riishe AI workspace once the analysis is READY.
// Every status shown here comes from the backend pipeline — nothing is faked.

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { MaterialListItemDTO, MaterialStatus, MaterialsResponseDTO } from '@/lib/types'
import { CountPill } from '@/components/bean/count-pill'
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
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

const PROCESSING_STATUSES: MaterialStatus[] = ['QUEUED', 'EXTRACTING', 'ANALYSING']

function isProcessing(status: MaterialStatus): boolean {
  return PROCESSING_STATUSES.includes(status)
}

// ─── Formatting helpers ───

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

// ─── Status badge (honest labels only) ───

export function MaterialStatusBadge({ status }: { status: MaterialStatus }) {
  if (isProcessing(status)) {
    return (
      <Badge variant="outline" className="shrink-0 gap-1.5 border-gold/40 bg-gold/10 text-gold">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" aria-hidden />
        Processing…
      </Badge>
    )
  }
  if (status === 'READY') {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-success/40 bg-success/10 text-success">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready
      </Badge>
    )
  }
  if (status === 'NEEDS_OCR') {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-gold/40 bg-gold/10 text-gold">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Needs OCR
      </Badge>
    )
  }
  if (status === 'FAILED') {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-destructive/40 bg-destructive/10 text-destructive">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Failed
      </Badge>
    )
  }
  return null
}

// ═══ Main view ═══

export function MaterialsView() {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)

  const [reloadTick, setReloadTick] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; data: MaterialsResponseDTO } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  const loadKey = guestId ? `${guestId}|${reloadTick}` : 'no-session'

  // Derived-loading pattern: settle state inside promise callbacks only.
  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .materials(guestId)
      .then(d => {
        if (!alive) return
        setLoaded({ key: loadKey, data: d })
        setFailure(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setFailure({ key: loadKey, message: e instanceof Error ? e.message : 'Could not load your materials.' })
      })
    return () => {
      alive = false
    }
  }, [guestId, loadKey])

  const data = loaded && loaded.key === loadKey ? loaded.data : null
  const error = failure && failure.key === loadKey ? failure.message : null
  const loading = !data && !error

  // One shared 4s refresh while ANY material is still processing.
  const anyProcessing = !!data?.materials.some(m => isProcessing(m.status))
  useEffect(() => {
    if (!anyProcessing || !guestId) return
    const timer = setInterval(() => {
      api
        .materials(guestId)
        .then(d => setLoaded({ key: loadKey, data: d }))
        .catch(() => {
          /* keep the last honest list; the next tick retries */
        })
    }, 4000)
    return () => clearInterval(timer)
  }, [anyProcessing, guestId, loadKey])

  const refresh = () => setReloadTick(t => t + 1)

  const focusUploadZone = () => {
    const zone = document.getElementById('riishe-upload-zone')
    zone?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      zone?.querySelector<HTMLButtonElement>('[data-upload-trigger]')?.focus()
    }, 400)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Riishe AI · library</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Materials</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Riishe turns your own uploads into analysed study material — and builds validated practice tests strictly
          from their content. Upload a PDF, follow the honest processing status, then open the workspace.
        </p>
      </header>

      {loading && <ListSkeleton />}

      {!loading && error && (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={refresh}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="mt-8 space-y-8">
          <UploadPanel guestId={guestId} maxUploadMB={data.limits.maxUploadMB} onUploaded={refresh} />

          {data.materials.length === 0 ? (
            <EmptyState
              icon={FileUp}
              title="No materials yet"
              description="Upload a PDF above — Riishe reads it page by page, maps the topics, and builds a validated test from the content."
              actionLabel="Upload your first PDF"
              onAction={focusUploadZone}
            />
          ) : (
            <section aria-label="Your material library">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold text-foreground">Library</h2>
                <CountPill label={data.materials.length === 1 ? 'material' : 'materials'} value={data.materials.length} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.materials.map(doc => (
                  <MaterialCard key={doc.id} doc={doc} guestId={guestId} onChanged={refresh} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ═══ Upload panel ═══

function UploadPanel({
  guestId,
  maxUploadMB,
  onUploaded,
}: {
  guestId: string
  maxUploadMB: number
  onUploaded: () => void
}) {
  const navigate = useAppStore(s => s.navigate)
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [examLabel, setExamLabel] = useState('')
  const [subjectLabel, setSubjectLabel] = useState('')
  const [topicLabel, setTopicLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progressPct, setProgressPct] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<{ docId: string; duplicate: boolean } | null>(null)

  // Client-side pre-validation BEFORE any bytes leave the device.
  const acceptFile = (candidate: File | null | undefined) => {
    setErrorMsg(null)
    if (!candidate) return
    if (!/\.pdf$/i.test(candidate.name)) {
      setErrorMsg('Only PDF files are supported — please choose a .pdf file.')
      return
    }
    if (candidate.size > maxUploadMB * 1024 * 1024) {
      setErrorMsg(
        `“${candidate.name}” is ${formatBytes(candidate.size)} — the upload limit is ${maxUploadMB} MB.`,
      )
      return
    }
    setUploaded(null)
    setFile(candidate)
  }

  const clearFile = () => {
    setFile(null)
    setErrorMsg(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const startUpload = () => {
    if (!file || uploading || !guestId) return
    setUploading(true)
    setErrorMsg(null)
    setProgressPct(0)
    api
      .uploadMaterial(
        guestId,
        file,
        {
          examLabel: examLabel.trim() || undefined,
          subjectLabel: subjectLabel.trim() || undefined,
          topicLabel: topicLabel.trim() || undefined,
        },
        pct => setProgressPct(pct),
      )
      .then(r => {
        setUploaded({ docId: r.documentId, duplicate: !!r.duplicate })
        toast({
          title: r.duplicate ? 'Duplicate upload — existing analysis reused' : 'Material uploaded',
          description: r.duplicate
            ? 'Riishe recognised this exact file and reattached its earlier analysis.'
            : 'Riishe is reading and analysing it now — status updates automatically.',
        })
        setFile(null)
        setProgressPct(null)
        setExamLabel('')
        setSubjectLabel('')
        setTopicLabel('')
        if (inputRef.current) inputRef.current.value = ''
        onUploaded()
      })
      .catch((e: unknown) => {
        setProgressPct(null)
        setErrorMsg(e instanceof Error ? e.message : 'Upload failed.')
      })
      .finally(() => setUploading(false))
  }

  return (
    <section id="riishe-upload-zone" aria-label="Upload a material" className="scroll-mt-6">
      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Upload className="h-4 w-4 text-gold" aria-hidden /> Upload a material
          </h2>
          <p className="text-xs text-muted-foreground">
            PDF only · up to {maxUploadMB} MB · text-based PDFs analyse best
          </p>
        </div>

        {/* Drop zone + picker */}
        <div
          onDragOver={e => {
            e.preventDefault()
            if (!uploading) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault()
            setDragOver(false)
            if (!uploading) acceptFile(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'mt-4 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
            dragOver ? 'border-gold/60 bg-gold/10' : 'border-border bg-elevated/40',
          )}
          aria-label="Drag and drop a PDF here, or choose a file"
        >
          <FileUp className="mx-auto h-6 w-6 text-gold" aria-hidden />
          <p className="mt-2 text-sm text-muted-foreground">
            Drag &amp; drop your PDF here, or
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            aria-label="Choose a PDF file to upload"
            onChange={e => acceptFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-upload-trigger
            disabled={uploading}
            className="mt-3 min-h-9 border-gold/40 text-gold hover:bg-gold/10"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </Button>
        </div>

        {/* Chosen file */}
        {file && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-4 w-4 shrink-0 text-gold" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${file.name} from selection`}
              disabled={uploading}
              onClick={clearFile}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Optional association labels */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="riishe-exam-label" className="text-xs text-muted-foreground">
              Exam <span className="normal-case">(optional)</span>
            </Label>
            <Input
              id="riishe-exam-label"
              value={examLabel}
              onChange={e => setExamLabel(e.target.value)}
              placeholder="e.g. UPSC CSE Prelims"
              disabled={uploading}
              className="mt-1.5"
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor="riishe-subject-label" className="text-xs text-muted-foreground">
              Subject <span className="normal-case">(optional)</span>
            </Label>
            <Input
              id="riishe-subject-label"
              value={subjectLabel}
              onChange={e => setSubjectLabel(e.target.value)}
              placeholder="e.g. Indian Polity"
              disabled={uploading}
              className="mt-1.5"
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor="riishe-topic-label" className="text-xs text-muted-foreground">
              Topic <span className="normal-case">(optional)</span>
            </Label>
            <Input
              id="riishe-topic-label"
              value={topicLabel}
              onChange={e => setTopicLabel(e.target.value)}
              placeholder="e.g. Fundamental Rights"
              disabled={uploading}
              className="mt-1.5"
              maxLength={80}
            />
          </div>
        </div>

        {/* Progress / errors / actions */}
        {uploading && progressPct !== null && (
          <div className="mt-4" role="status" aria-label={`Uploading, ${progressPct}% complete`}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-gold" aria-hidden /> Uploading…
              </span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="mt-1.5 h-2" aria-hidden />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Keep this tab open until the upload finishes.
            </p>
          </div>
        )}

        {errorMsg && (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive" role="alert">
            {errorMsg}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            className="bg-gold text-primary-foreground hover:bg-gold-hover"
            disabled={!file || uploading || !guestId}
            onClick={startUpload}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Uploading…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" aria-hidden /> Upload material
              </>
            )}
          </Button>
          {!guestId && <p className="text-xs text-muted-foreground">Initialising your session…</p>}
        </div>

        {/* Post-upload callout — processing continues in the background */}
        {uploaded && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-gold/40 bg-gold/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-gold">
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                {uploaded.duplicate ? 'Already analysed — opened from the archive' : 'Material uploaded — analysis is running'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Processing continues in the background and the status updates automatically. You can open the
                workspace now and follow it there.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                className="bg-gold text-primary-foreground hover:bg-gold-hover"
                onClick={() => navigate({ view: 'riishe', docId: uploaded.docId })}
              >
                <BookOpenCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open in Riishe
              </Button>
              <Button size="sm" variant="ghost" aria-label="Dismiss upload confirmation" onClick={() => setUploaded(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ═══ Material card ═══

function MaterialCard({
  doc,
  guestId,
  onChanged,
}: {
  doc: MaterialListItemDTO
  guestId: string
  onChanged: () => void
}) {
  const navigate = useAppStore(s => s.navigate)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(doc.title)
  const [busy, setBusy] = useState<'rename' | 'retry' | null>(null)

  const readyTests = doc.tests.filter(t => t.status === 'READY')
  const hasReadyTest = readyTests.length > 0
  const visibleTopics = doc.topics.slice(0, 4)
  const extraTopics = doc.topics.length - visibleTopics.length

  const metaLabels = [doc.examLabel, doc.subjectLabel, doc.topicLabel].filter((v): v is string => !!v)

  const doRename = () => {
    const next = renameValue.trim()
    if (!next || busy) return
    setBusy('rename')
    api
      .renameMaterial(doc.id, guestId, { title: next })
      .then(() => {
        toast({ title: 'Renamed', description: `This material is now “${next}”.` })
        setRenameOpen(false)
        onChanged()
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not rename', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
      .finally(() => setBusy(null))
  }

  const doRemove = () => {
    api
      .deleteMaterial(doc.id, guestId)
      .then(() => {
        toast({
          title: 'Material removed',
          description: 'The uploaded file, its analysis and every test generated from it were deleted.',
        })
        onChanged()
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not remove material', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
  }

  const doRetry = () => {
    if (busy) return
    setBusy('retry')
    api
      .retryMaterial(doc.id, guestId)
      .then(() => {
        toast({ title: 'Reprocessing started', description: 'Riishe is reading the document again.' })
        onChanged()
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not start reprocessing', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
      .finally(() => setBusy(null))
  }

  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 exam-card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-semibold text-foreground" title={doc.title}>
            {doc.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={doc.originalName}>
            {doc.originalName}
          </p>
        </div>
        <MaterialStatusBadge status={doc.status} />
      </div>

      {/* File meta */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="border-border text-muted-foreground">PDF</Badge>
        <span>{formatBytes(doc.fileSize)}</span>
        {doc.pageCount != null && (
          <>
            <span aria-hidden>·</span>
            <span>{doc.pageCount} pages</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>Added {formatDate(doc.createdAt)}</span>
      </div>

      {/* Association labels */}
      {metaLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {metaLabels.map(label => (
            <Badge key={label} variant="outline" className="border-gold/30 text-gold/90">
              {label}
            </Badge>
          ))}
        </div>
      )}

      {/* Honest status detail */}
      {isProcessing(doc.status) && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {doc.statusDetail ?? 'Riishe is reading and analysing this document — this updates automatically.'}
        </p>
      )}
      {doc.status === 'NEEDS_OCR' && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {doc.statusDetail ??
            'These pages look like scanned images — no readable text was found and OCR is unavailable, so the document cannot be analysed.'}
        </p>
      )}
      {doc.status === 'FAILED' && (
        <p className="mt-3 text-xs leading-relaxed text-destructive/90">
          {doc.statusDetail ?? 'Processing failed. You can retry below.'}
        </p>
      )}

      {/* READY: topics + test count */}
      {doc.status === 'READY' && (
        <div className="mt-3">
          {doc.topics.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {visibleTopics.map(topic => (
                <Badge key={topic} variant="outline" className="border-border text-muted-foreground">
                  {topic}
                </Badge>
              ))}
              {extraTopics > 0 && <span className="text-xs text-muted-foreground">+{extraTopics} more</span>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No topics identified in this document.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {hasReadyTest
              ? `${readyTests.length} test${readyTests.length === 1 ? '' : 's'} ready to take.`
              : 'No tests generated yet — open the workspace to create one.'}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button
          size="sm"
          variant="outline"
          className="min-h-9 border-gold/40 text-gold hover:bg-gold/10"
          onClick={() => navigate({ view: 'riishe', docId: doc.id })}
          aria-label={`Open the Riishe workspace for ${doc.title}`}
        >
          <BookOpenCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open workspace
        </Button>

        {hasReadyTest && (
          <Button
            size="sm"
            className="min-h-9 bg-gold text-primary-foreground hover:bg-gold-hover"
            onClick={() => navigate({ view: 'riishe', docId: doc.id })}
            aria-label={`Start a test from ${doc.title}`}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Start test
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="min-h-9 text-muted-foreground hover:text-gold"
          onClick={() => {
            setRenameValue(doc.title)
            setRenameOpen(true)
          }}
          aria-label={`Rename ${doc.title}`}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Rename
        </Button>

        {doc.status === 'FAILED' && (
          <Button
            size="sm"
            variant="outline"
            className="min-h-9 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy === 'retry'}
            onClick={doRetry}
          >
            {busy === 'retry' ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            Retry processing
          </Button>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${doc.title}`}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display">Remove this material?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes “{doc.title}” — the uploaded file, its analysis, and every test generated
                from it. Past attempts stay in My Progress, but the tests themselves are removed. This cannot be
                undone.
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

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Rename material</DialogTitle>
            <DialogDescription>Give this document a name you will recognise in your library.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor={`rename-${doc.id}`} className="text-xs text-muted-foreground">
              Title
            </Label>
            <Input
              id={`rename-${doc.id}`}
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
              disabled={!renameValue.trim() || busy === 'rename'}
              onClick={doRename}
            >
              {busy === 'rename' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

// ─── Loading skeleton ───

function ListSkeleton() {
  return (
    <div className="mt-8 space-y-8" aria-hidden>
      <Skeleton className="h-72 bg-elevated" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-56 bg-elevated" />
        ))}
      </div>
    </div>
  )
}
