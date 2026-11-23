'use client'

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATED PDF READER — Layer 1 (Study Material + Official PDFs)
//
// A real pdf.js-based reader that opens verified official documents inside
// BEAN Education. Progressive page rendering (only pages near the viewport are
// drawn), in-document text search with highlighted matches, zoom / fit /
// rotate, fullscreen, keyboard shortcuts, honest error + fallback states,
// and per-guest per-document reading progress.
//
// Documents are streamed same-origin through /api/pdf — a registry-whitelisted
// proxy, so only URLs registered as real PDFs can ever be opened here.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { api } from '@/lib/api'
import type { ResourceMetaDTO } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { loadReadingProgress, saveReadingProgress } from '@/lib/reading-progress'
import { ResourceStatusBadge } from '@/components/bean/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/bean/empty-state'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Compass,
  Download, ExternalLink, FileQuestion, Loader2, Maximize2, Minimize2,
  RotateCw, Search, Sparkles, X, ZoomIn, ZoomOut,
} from 'lucide-react'

// ─── pdf.js loader (client-only; worker served from /public) ────────────────
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(lib => {
      // The worker file in /public is copied from the installed pdfjs-dist
      // version (scripts/copy-pdf-worker.mjs runs on postinstall) — serving it
      // as a static asset keeps dev and production builds bundler-independent.
      lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      return lib
    })
  }
  return pdfjsPromise
}

// ─── Shared types & helpers ─────────────────────────────────────────────────
interface SearchMatch {
  page: number
  start: number
  end: number
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 6
const ZOOM_STEP = 1.2
const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(s) ? s : 1))

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

// ═════════════════════════════════════════════════════════════════════════════
// Route-level wrapper: loads resource metadata, guards non-PDF links.
// ═════════════════════════════════════════════════════════════════════════════
export function PdfViewerPage({ resourceId }: { resourceId: string }) {
  const navigate = useAppStore(s => s.navigate)

  const [loaded, setLoaded] = useState<{ key: string; data: ResourceMetaDTO } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let alive = true
    api.resource(resourceId)
      .then(d => { if (alive) setLoaded({ key: resourceId, data: d }) })
      .catch(e => { if (alive) setFailure({ key: resourceId, message: e.message }) })
    return () => { alive = false }
  }, [resourceId, retryToken])

  const data = loaded && loaded.key === resourceId ? loaded.data : null
  const error = failure && failure.key === resourceId ? failure.message : null
  const loading = !data && !error

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-16" aria-busy="true" aria-label="Preparing document reader">
        <Skeleton className="h-10 w-2/3 bg-elevated" />
        <Skeleton className="h-4 w-1/2 bg-elevated" />
        <Skeleton className="h-96 w-full bg-elevated" />
      </div>
    )
  }

  if (error || !data) {
    const notFound = /not found/i.test(error ?? '')
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <EmptyState
          icon={notFound ? Compass : FileQuestion}
          title={notFound ? 'Document not found' : 'Could not load this document'}
          description={notFound
            ? 'That document link does not match anything in the BEAN Education registry.'
            : error ?? 'Something went wrong.'}
          actionLabel="Back to home"
          onAction={() => navigate({ view: 'home' })}
        />
      </div>
    )
  }

  // Honest guard: ordinary webpages and portals are never rendered as PDFs.
  if (data.resource.fileKind !== 'PDF') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <EmptyState
          icon={ExternalLink}
          title="This resource is a webpage, not a PDF"
          description={`“${data.resource.title}” is registered as an interactive ${data.resource.fileKind === 'PORTAL' ? 'portal' : 'webpage'}, so it opens directly on the official site instead of the reader. We never render ordinary pages as if they were documents.`}
          actionLabel="Open the original page"
          onAction={() => window.open(data.resource.url, '_blank', 'noopener,noreferrer')}
        />
        <div className="mt-4 text-center">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => navigate({ view: 'home' })}>
            Back to home
          </Button>
        </div>
      </div>
    )
  }

  // The key includes the retry token so "Try again" fully remounts the reader.
  return (
    <PdfReader
      key={`${data.resource.id}|${retryToken}`}
      meta={data}
      onRetry={() => setRetryToken(t => t + 1)}
    />
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// The reader itself.
// ═════════════════════════════════════════════════════════════════════════════
type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

function PdfReader({ meta, onRetry, srcOverride, backOverride }: {
  meta: ResourceMetaDTO
  onRetry: () => void
  /** Overrides for Riishe uploads (owner-streamed files) — keeps the tested reader intact. */
  srcOverride?: {
    streamUrl: string
    downloadUrl: string
    progressKey: string
    openOriginalUrl: string | null
    /** Open directly at this physical page (deep link from analysis page chips).
     * Takes priority over saved reading progress. */
    startPage?: number
  }
  backOverride?: { label: string; go: () => void }
}) {
  const { resource, context } = meta
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)
  const setBeanContext = useAppStore(s => s.setBeanContext)

  // ─── refs ───
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const ratiosRef = useRef<Map<number, number>>(new Map())
  const maxPageRef = useRef(1)
  const currentPageRef = useRef(1)
  const pendingScrollRef = useRef<number | null>(null)
  const searchSessionRef = useRef(0)
  const textCacheRef = useRef<Map<number, string>>(new Map())
  const loadingTaskRef = useRef<{ destroy: () => void } | null>(null)
  const pageInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const inputFocusedRef = useRef(false)

  // ─── document state ───
  const [pdfjsLib, setPdfjsLib] = useState<typeof import('pdfjs-dist') | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page1Size, setPage1Size] = useState<{ w: number; h: number } | null>(null)
  const [loadError, setLoadError] = useState<{ title: string; detail: string } | null>(null)
  const [loadKb, setLoadKb] = useState<{ loaded: number; total: number } | null>(null)

  // ─── view state ───
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width')
  const [customScale, setCustomScale] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [maxPageReached, setMaxPageReached] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [lastSyncedPage, setLastSyncedPage] = useState(1)
  const [pageRatios, setPageRatios] = useState<Record<number, number>>({})
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ─── search state ───
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [searchState, setSearchState] = useState<'idle' | 'indexing' | 'done'>('idle')
  const [indexedCount, setIndexedCount] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [activeMatchIdx, setActiveMatchIdx] = useState(-1)

  const docReady = !!doc && !loadError

  // ─── Back / close target (context-aware, overridable for Riishe workspace) ───
  const backLabel = backOverride?.label ?? (context.origin === 'topic' ? 'Back to topic' : context.origin === 'exam' ? 'Back to Study Material' : 'Back')
  const goBack = useCallback(() => {
    if (backOverride) {
      backOverride.go()
      return
    }
    if (context.origin === 'topic' && context.topicId) {
      navigate({ view: 'topic', topicId: context.topicId })
    } else if (context.origin === 'exam' && context.examSlug) {
      navigate({ view: 'exam', slug: context.examSlug, tab: 'study' })
    } else {
      navigate({ view: 'home' })
    }
  }, [backOverride, context, navigate])

  // ─── Load the document ───
  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const lib = await loadPdfjs()
        if (!alive) return
        setPdfjsLib(lib)

        const task = lib.getDocument({
          url: srcOverride?.streamUrl ?? api.pdfStreamUrl(resource.url),
          rangeChunkSize: 262144,
        })
        loadingTaskRef.current = task
        task.onProgress = (p: { loaded: number; total: number }) => {
          if (alive) setLoadKb({ loaded: p.loaded, total: p.total })
        }
        const pdfDoc = await task.promise
        if (!alive) return

        const p1 = await pdfDoc.getPage(1)
        if (!alive) return
        const vp1 = p1.getViewport({ scale: 1 })

        // Restore this guest's reading progress for THIS document.
        const progressKey = srcOverride?.progressKey ?? resource.id
        const saved = guestId ? loadReadingProgress(guestId, progressKey) : null
        // A page deep-link (analysis chip) beats saved progress.
        const deepLink = srcOverride?.startPage && srcOverride.startPage >= 1 && srcOverride.startPage <= pdfDoc.numPages
          ? srcOverride.startPage
          : null
        let resumePage = 1
        if (deepLink) {
          resumePage = deepLink
          pendingScrollRef.current = resumePage
        } else if (saved && saved.lastPage > 1 && saved.lastPage <= pdfDoc.numPages) {
          resumePage = saved.lastPage
          pendingScrollRef.current = resumePage
          maxPageRef.current = Math.max(1, Math.min(saved.maxPage || resumePage, pdfDoc.numPages))
          setMaxPageReached(maxPageRef.current)
          if (saved.zoomMode === 'custom' && saved.zoomScale && saved.zoomScale >= ZOOM_MIN && saved.zoomScale <= ZOOM_MAX) {
            setZoomMode('custom')
            setCustomScale(saved.zoomScale)
          } else if (saved.zoomMode === 'fit-page') {
            setZoomMode('fit-page')
          }
          if (saved.rotation % 90 === 0 && saved.rotation !== 0) setRotation(saved.rotation)
        }

        setDoc(pdfDoc)
        setNumPages(pdfDoc.numPages)
        setPage1Size({ w: vp1.width, h: vp1.height })
        currentPageRef.current = resumePage
        setCurrentPage(resumePage)
        setLastSyncedPage(resumePage)
        setPageInput(String(resumePage))
        if (resumePage > 1) {
          toast({
            title: 'Reading progress restored',
            description: `Continuing “${resource.title}” at page ${resumePage} of ${pdfDoc.numPages}.`,
          })
        }
      } catch (err) {
        if (!alive) return
        const e = err as { name?: string; message?: string }
        const name = e?.name ?? ''
        let title = 'The document could not be opened'
        let detail = e?.message ?? 'Unknown error while loading the PDF.'
        if (name === 'PasswordException') {
          title = 'This PDF is password-protected'
          detail = 'The official document requires a password, so it cannot be displayed in the reader.'
        } else if (name === 'InvalidPDFException') {
          title = 'This file is not a valid PDF'
          detail = 'The source did not return a readable PDF document.'
        } else if (name === 'MissingPDFException') {
          title = 'The document was not found at the official source'
          detail = 'The file may have been moved or renamed by the issuing authority.'
        } else if (name === 'UnexpectedResponseException') {
          const statusMatch = /response \((\d+)\)/i.exec(e?.message ?? '')
          title = statusMatch
            ? `The official source responded with HTTP ${statusMatch[1]}`
            : 'The official source responded with an error'
          detail = 'The document could not be retrieved from the issuing authority’s server right now. It may have been moved — try the original source below, or check back later.'
        }
        setLoadError({ title, detail })
      }
    })()

    return () => {
      alive = false
      searchSessionRef.current++
      try { loadingTaskRef.current?.destroy() } catch { /* already destroyed */ }
      loadingTaskRef.current = null
    }
  }, [resource.id, resource.url, resource.title, guestId, srcOverride?.streamUrl, srcOverride?.progressKey])

  // Lock body scroll while the reader overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ─── Container size (ResizeObserver; fit scales are derived in render) ───
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = Math.max(220, el.clientWidth - 32)
      const h = Math.max(220, el.clientHeight - 32)
      setAvail(a => (a && a.w === w && a.h === h ? a : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Base page box in CSS px at scale 1 (from page 1; official docs are uniform).
  const swapped = rotation % 180 !== 0
  const p1 = page1Size ?? { w: 612, h: 792 }
  const pageBoxW = swapped ? p1.h : p1.w
  const pageBoxH = swapped ? p1.w : p1.h

  const fitWidthScale = useMemo(
    () => (avail ? clampScale(avail.w / pageBoxW) : 1),
    [avail, pageBoxW],
  )
  const fitPageScale = useMemo(
    () => (avail ? clampScale(Math.min(avail.w / pageBoxW, avail.h / pageBoxH)) : 1),
    [avail, pageBoxW, pageBoxH],
  )
  const effectiveScale = clampScale(
    zoomMode === 'fit-width' ? fitWidthScale
      : zoomMode === 'fit-page' ? fitPageScale
        : (customScale ?? fitWidthScale),
  )
  const scaleKey = effectiveScale.toFixed(3)

  // Placeholder geometry for not-yet-rendered pages.
  const p1RenderedRatio = swapped ? p1.w / p1.h : p1.h / p1.w // rendered h/w after rotation
  const placeholderW = Math.round(pageBoxW * effectiveScale)

  // ─── Scroll to a page ───
  const scrollToPage = useCallback((n: number) => {
    const sc = scrollRef.current
    const wrap = pageRefs.current.get(n)
    if (!sc || !wrap) return
    sc.scrollTo({ top: Math.max(0, wrap.offsetTop - 12), behavior: 'auto' })
  }, [])

  // Re-anchor the current page after scale/rotation changes and after load.
  // Page heights settle over a few frames (canvas re-renders are async), so
  // anchor immediately, next frame, and once more after rendering settles.
  useEffect(() => {
    if (!docReady) return
    let cancelled = false
    const anchor = () => {
      if (cancelled) return
      scrollToPage(pendingScrollRef.current ?? currentPageRef.current)
    }
    anchor()
    const raf = requestAnimationFrame(anchor)
    const timer = window.setTimeout(() => {
      pendingScrollRef.current = null
      anchor()
    }, 400)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [docReady, scaleKey, rotation, scrollToPage])

  // ─── Visible-page tracking (IntersectionObserver) ───
  useEffect(() => {
    if (!docReady || !scrollRef.current) return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page)
          if (n) ratiosRef.current.set(n, entry.intersectionRatio)
        }
        let bestPage = currentPageRef.current
        let bestRatio = 0.04
        for (const [n, r] of ratiosRef.current) {
          if (r > bestRatio) { bestRatio = r; bestPage = n }
        }
        if (bestPage > maxPageRef.current) {
          maxPageRef.current = bestPage
          setMaxPageReached(bestPage)
        }
        if (bestPage !== currentPageRef.current) {
          currentPageRef.current = bestPage
          setCurrentPage(bestPage)
        }
      },
      { root: scrollRef.current, threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1] },
    )
    for (const el of pageRefs.current.values()) observer.observe(el)
    return () => observer.disconnect()
  }, [docReady, numPages])

  // ─── Persist reading progress (localStorage write only) ───
  const progressKey = srcOverride?.progressKey ?? resource.id
  useEffect(() => {
    if (!docReady || !currentPage) return
    saveReadingProgress(guestId, progressKey, {
      lastPage: currentPage,
      maxPage: currentPage,
      totalPages: numPages,
      zoomMode,
      zoomScale: zoomMode === 'custom' ? effectiveScale : null,
      rotation,
    })
  }, [docReady, currentPage, numPages, zoomMode, rotation, scaleKey, effectiveScale, guestId, progressKey])

  // ─── Fullscreen ───
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === overlayRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    overlayRef.current?.requestFullscreen?.().catch(() => {
      toast({
        title: 'Full screen was blocked',
        description: 'This browser view does not allow full screen — the reader stays embedded, which still works normally.',
        variant: 'destructive',
      })
    })
  }, [])

  // ─── Page navigation ───
  const goToPage = useCallback((n: number) => {
    const target = Math.min(Math.max(1, Math.round(n)), Math.max(1, numPages))
    currentPageRef.current = target
    setCurrentPage(target)
    scrollToPage(target)
  }, [numPages, scrollToPage])

  const stepPage = useCallback((delta: number) => {
    goToPage(currentPageRef.current + delta)
  }, [goToPage])

  // Keep the editable page input in sync (render-time adjustment pattern).
  if (lastSyncedPage !== currentPage && !inputFocusedRef.current) {
    setLastSyncedPage(currentPage)
    setPageInput(String(currentPage))
  }

  const commitPageInput = () => {
    const parsed = parseInt(pageInput, 10)
    if (!Number.isNaN(parsed)) goToPage(parsed)
    else setPageInput(String(currentPageRef.current))
  }

  // ─── Zoom actions ───
  const zoomIn = useCallback(() => {
    setZoomMode('custom')
    setCustomScale(s => clampScale((s ?? effectiveScale) * ZOOM_STEP))
  }, [effectiveScale])
  const zoomOut = useCallback(() => {
    setZoomMode('custom')
    setCustomScale(s => clampScale((s ?? effectiveScale) / ZOOM_STEP))
  }, [effectiveScale])
  const actualSize = useCallback(() => { setZoomMode('custom'); setCustomScale(1) }, [])

  // ─── Text extraction (shared by search and the BEAN handoff) ───
  const getPageRawText = useCallback(async (pdf: PDFDocumentProxy, n: number): Promise<string> => {
    const cached = textCacheRef.current.get(n)
    if (cached !== undefined) return cached
    const page = await pdf.getPage(n)
    const tc = await page.getTextContent()
    let raw = ''
    for (const item of tc.items) {
      if ('str' in item) raw += item.str
    }
    textCacheRef.current.set(n, raw)
    return raw
  }, [])

  // ─── Search ───
  const clearSearch = useCallback(() => {
    searchSessionRef.current++
    setMatches([])
    setActiveMatchIdx(-1)
    setSearchState('idle')
    setIndexedCount(0)
  }, [])

  const runSearch = useCallback((rawQuery: string) => {
    const q = rawQuery.trim()
    setSearchQuery(q)
    if (!doc || q.length < 2) { clearSearch(); return }
    const session = ++searchSessionRef.current
    setSearchState('indexing')
    setIndexedCount(0)
    setMatches([])
    setActiveMatchIdx(-1)
    const lower = q.toLowerCase()
    ;(async () => {
      const found: SearchMatch[] = []
      for (let n = 1; n <= numPages; n++) {
        if (searchSessionRef.current !== session) return
        let raw = ''
        try { raw = await getPageRawText(doc, n) } catch { raw = '' }
        if (searchSessionRef.current !== session) return
        const low = raw.toLowerCase()
        let idx = low.indexOf(lower)
        while (idx !== -1) {
          found.push({ page: n, start: idx, end: idx + lower.length })
          idx = low.indexOf(lower, idx + Math.max(1, lower.length))
        }
        setIndexedCount(n)
        setMatches([...found])
      }
      if (searchSessionRef.current !== session) return
      setSearchState('done')
      if (found.length > 0) {
        setActiveMatchIdx(0)
        const first = found[0]
        currentPageRef.current = first.page
        setCurrentPage(first.page)
        scrollToPage(first.page)
      }
    })()
  }, [doc, numPages, clearSearch, getPageRawText, scrollToPage])

  const gotoMatch = useCallback((idx: number) => {
    if (idx < 0 || idx >= matches.length) return
    setActiveMatchIdx(idx)
    const m = matches[idx]
    if (m.page !== currentPageRef.current) {
      currentPageRef.current = m.page
      setCurrentPage(m.page)
    }
    scrollToPage(m.page)
  }, [matches, scrollToPage])

  const toggleSearch = useCallback(() => {
    setSearchOpen(open => {
      if (!open) clearSearch()
      return !open
    })
  }, [clearSearch])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
        return
      }
      if (inField) {
        if (e.key === 'Escape' && target === searchInputRef.current) {
          setSearchOpen(false)
          clearSearch()
        }
        return
      }
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': e.preventDefault(); stepPage(1); break
        case 'ArrowLeft': case 'PageUp': e.preventDefault(); stepPage(-1); break
        case '+': case '=': e.preventDefault(); zoomIn(); break
        case '-': e.preventDefault(); zoomOut(); break
        case '0': e.preventDefault(); actualSize(); break
        case 'r': case 'R': setRotation(r => (r + 90) % 360); break
        case 'w': case 'W': setZoomMode('fit-width'); break
        case 'p': case 'P': setZoomMode('fit-page'); break
        case 'f': case 'F': toggleFullscreen(); break
        case '/': e.preventDefault(); setSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); break
        case 'Escape':
          if (searchOpen) { setSearchOpen(false); clearSearch() }
          else goBack()
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [stepPage, zoomIn, zoomOut, actualSize, toggleFullscreen, searchOpen, clearSearch, goBack])

  // ─── Ask BEAN about this document (real extracted text only) ───
  const [extractingForBean, setExtractingForBean] = useState(false)
  const askBeanAboutDocument = useCallback(() => {
    if (!doc || extractingForBean) return
    setExtractingForBean(true)
    ;(async () => {
      try {
        const upto = Math.min(Math.max(maxPageRef.current, currentPageRef.current, 1), 10)
        let raw = ''
        for (let n = 1; n <= upto; n++) {
          try { raw += (await getPageRawText(doc, n)) + '\n\n' } catch { /* skip unreadable page */ }
        }
        const excerpt = raw.replace(/[ \t]+/g, ' ').trim().slice(0, 4500)
        if (excerpt.length < 40) {
          toast({
            title: 'No readable text in this PDF',
            description: 'This document appears to be scanned images without a text layer, so BEAN cannot read it directly. Ask about the topic from its study notes instead.',
            variant: 'destructive',
          })
          return
        }
        setBeanContext({
          ...(context.examSlug ? { examSlug: context.examSlug } : {}),
          ...(context.examName ? { examName: context.examName } : {}),
          ...(context.stageName ? { stageName: context.stageName } : {}),
          ...(context.subjectName ? { subjectName: context.subjectName } : {}),
          ...(context.topicId ? { topicId: context.topicId } : {}),
          ...(context.topicName ? { topicName: context.topicName } : {}),
          documentTitle: resource.title,
          documentUrl: resource.url,
          documentPagesRead: `pages 1–${upto} of ${numPages}`,
          documentExcerpt: excerpt,
        })
        navigate({ view: 'bean' })
      } finally {
        setExtractingForBean(false)
      }
    })()
  }, [doc, extractingForBean, getPageRawText, context, resource.title, resource.url, numPages, setBeanContext, navigate])

  // ─── Download / original URLs ───
  const downloadUrl = srcOverride?.downloadUrl ?? api.pdfStreamUrl(resource.url, '1')
  const openOriginalUrl = srcOverride ? srcOverride.openOriginalUrl : resource.url

  // ─── Matches grouped per page ───
  const matchesByPage = useMemo(() => {
    const map = new Map<number, SearchMatch[]>()
    for (const m of matches) {
      const list = map.get(m.page)
      if (list) list.push(m)
      else map.set(m.page, [m])
    }
    return map
  }, [matches])
  const pagesWithMatches = useMemo(() => new Set(matchesByPage.keys()), [matchesByPage])
  const activeMatch = activeMatchIdx >= 0 && activeMatchIdx < matches.length ? matches[activeMatchIdx] : null

  const readPct = numPages > 0 ? Math.round((Math.min(maxPageReached, numPages) / numPages) * 100) : 0
  const scrollPct = numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0

  // Stable helpers passed to PageView.
  const registerPageRef = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(n, el)
    else pageRefs.current.delete(n)
  }, [])
  const handleMeasured = useCallback((n: number, r: number) => {
    setPageRatios(prev => (Math.abs((prev[n] ?? 0) - r) < 0.002 ? prev : { ...prev, [n]: r }))
  }, [])
  const isNearPage = useCallback(
    (n: number) => Math.abs(n - currentPage) <= 2,
    [currentPage],
  )

  // ═══ Render ═══
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex flex-col bg-page"
      role="region"
      aria-label={`Document reader — ${resource.title}`}
    >
      {/* ─── Header toolbar ─── */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-2 py-2 sm:px-4">
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-gold/40 text-gold hover:bg-gold/10"
            onClick={goBack}
            autoFocus
          >
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{backLabel}</span>
            <span className="sm:hidden">Back</span>
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground" title={resource.title}>
              {resource.title}
            </p>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <span className="truncate">{context.authority ?? resource.provider}</span>
              {resource.docDate && <span aria-hidden>·</span>}
              {resource.docDate && <span className="shrink-0">{resource.docDate}</span>}
              {!srcOverride && <span aria-hidden>·</span>}
              {!srcOverride && <ResourceStatusBadge status={resource.verificationStatus} />}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="border-gold/40 text-gold hover:bg-gold/10"
              onClick={askBeanAboutDocument}
              disabled={!docReady || extractingForBean}
              title="Ask BEAN about this document — an excerpt of the pages you have read is extracted and supplied; BEAN cannot open the PDF itself."
            >
              {extractingForBean
                ? <Loader2 className="h-4 w-4 animate-spin md:mr-1.5" aria-hidden />
                : <Sparkles className="h-4 w-4 md:mr-1.5" aria-hidden />}
              <span className="hidden md:inline">Ask BEAN</span>
            </Button>
            <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground" asChild>
              <a href={downloadUrl} download aria-label={`Download PDF: ${resource.title}`}>
                <Download className="h-4 w-4 lg:mr-1.5" aria-hidden />
                <span className="hidden lg:inline">Download PDF</span>
              </a>
            </Button>
            {openOriginalUrl && (
              <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground" asChild>
                <a href={openOriginalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open the original source in a new tab: ${resource.title}`}>
                  <ExternalLink className="h-4 w-4 lg:mr-1.5" aria-hidden />
                  <span className="hidden lg:inline">Open original</span>
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground"
              onClick={toggleFullscreen}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              title="Full screen (F)"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground"
              onClick={goBack}
              aria-label="Close the reader"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* ─── Controls bar ─── */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-border/60 px-2 py-1.5 sm:px-4">
          {/* Page navigation */}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-foreground hover:bg-elevated hover:text-gold" onClick={() => stepPage(-1)} disabled={currentPage <= 1} aria-label="Previous page">
              <ChevronUp className="h-4 w-4" aria-hidden />
            </Button>
            <form
              className="flex items-center gap-1"
              onSubmit={e => { e.preventDefault(); commitPageInput(); pageInputRef.current?.blur() }}
            >
              <label htmlFor="pdf-page-input" className="sr-only">Go to page</label>
              <input
                id="pdf-page-input"
                ref={pageInputRef}
                value={pageInput}
                inputMode="numeric"
                className="h-8 w-12 rounded-md border border-border bg-elevated px-1.5 text-center text-sm text-foreground focus:border-gold/50 focus:outline-none"
                onFocus={() => { inputFocusedRef.current = true }}
                onBlur={() => { inputFocusedRef.current = false; commitPageInput() }}
                onChange={e => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
                aria-describedby="pdf-page-total"
              />
              <span id="pdf-page-total" className="whitespace-nowrap text-xs text-muted-foreground">of {numPages || '…'}</span>
            </form>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-foreground hover:bg-elevated hover:text-gold" onClick={() => stepPage(1)} disabled={currentPage >= numPages} aria-label="Next page">
              <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-foreground hover:bg-elevated hover:text-gold" onClick={zoomOut} disabled={!docReady} aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" aria-hidden />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground" aria-label={`Zoom level ${Math.round(effectiveScale * 100)} percent`}>
              {Math.round(effectiveScale * 100)}%
            </span>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-foreground hover:bg-elevated hover:text-gold" onClick={zoomIn} disabled={!docReady} aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" className={cn('h-8 px-2 text-xs', zoomMode === 'fit-width' ? 'bg-gold/15 text-gold' : 'text-muted-foreground hover:bg-elevated hover:text-foreground')} onClick={() => setZoomMode('fit-width')} aria-pressed={zoomMode === 'fit-width'} title="Fit to width (W)">
              Fit width
            </Button>
            <Button size="sm" variant="ghost" className={cn('h-8 px-2 text-xs', zoomMode === 'fit-page' ? 'bg-gold/15 text-gold' : 'text-muted-foreground hover:bg-elevated hover:text-foreground')} onClick={() => setZoomMode('fit-page')} aria-pressed={zoomMode === 'fit-page'} title="Fit page (P)">
              Fit page
            </Button>
            <Button size="sm" variant="ghost" className={cn('h-8 px-2 text-xs', zoomMode === 'custom' && customScale === 1 ? 'text-gold' : 'text-muted-foreground hover:bg-elevated hover:text-foreground')} onClick={actualSize} title="Actual size (0)">
              100%
            </Button>
          </div>

          <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />

          {/* Rotate */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-foreground hover:bg-elevated hover:text-gold"
            onClick={() => setRotation(r => (r + 90) % 360)}
            disabled={!docReady}
            aria-label="Rotate clockwise"
            title="Rotate clockwise (R)"
          >
            <RotateCw className="h-4 w-4" aria-hidden />
          </Button>

          <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />

          {/* Search */}
          <div className="flex min-w-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-8 w-8 p-0', searchOpen ? 'text-gold' : 'text-foreground hover:bg-elevated hover:text-gold')}
              onClick={toggleSearch}
              aria-pressed={searchOpen}
              aria-label="Search text in the document"
              title="Search (Ctrl+F or /)"
            >
              <Search className="h-4 w-4" aria-hidden />
            </Button>
            {searchOpen && (
              <>
                <input
                  ref={searchInputRef}
                  value={searchDraft}
                  onChange={e => setSearchDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); runSearch(searchDraft) }
                  }}
                  placeholder="Search in document…"
                  className="h-8 w-32 rounded-md border border-border bg-elevated px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-gold/50 focus:outline-none sm:w-44"
                  aria-label="Search text in the document"
                />
                <Button size="sm" variant="ghost" className="h-8 px-1.5 text-xs text-foreground hover:bg-elevated hover:text-gold" onClick={() => runSearch(searchDraft)}>
                  Find
                </Button>
                <span className="min-w-16 text-center text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
                  {searchState === 'indexing'
                    ? `${indexedCount}/${numPages}`
                    : matches.length > 0
                      ? `${activeMatchIdx + 1} of ${matches.length}`
                      : searchState === 'done' && searchQuery
                        ? 'No matches'
                        : ''}
                </span>
                <Button size="sm" variant="ghost" className="h-8 w-7 p-0 text-foreground hover:bg-elevated hover:text-gold" onClick={() => gotoMatch(activeMatchIdx - 1)} disabled={activeMatchIdx <= 0} aria-label="Previous search result">
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-7 p-0 text-foreground hover:bg-elevated hover:text-gold" onClick={() => gotoMatch(activeMatchIdx + 1)} disabled={activeMatchIdx < 0 || activeMatchIdx >= matches.length - 1} aria-label="Next search result">
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-7 p-0 text-muted-foreground hover:bg-elevated" onClick={() => { setSearchOpen(false); clearSearch() }} aria-label="Close search">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </>
            )}
          </div>

          {/* Reading progress */}
          <span className="ml-auto hidden shrink-0 whitespace-nowrap text-[11px] text-muted-foreground md:inline" aria-live="polite">
            Page {currentPage || '–'} of {numPages || '–'} · {readPct}% read
          </span>
        </div>

        {/* Reading-position bar */}
        <div className="h-0.5 w-full bg-border/60" aria-hidden>
          <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${scrollPct}%` }} />
        </div>
      </header>

      {/* ─── Document area ─── */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        {loadError ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-destructive/40 bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold text-foreground">{loadError.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{loadError.detail}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={onRetry}>
                <RotateCw className="mr-1.5 h-4 w-4" aria-hidden /> Try again
              </Button>
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground" asChild>
                <a href={downloadUrl} download><Download className="mr-1.5 h-4 w-4" aria-hidden /> Download PDF</a>
              </Button>
              {openOriginalUrl && (
                <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated hover:text-foreground" asChild>
                  <a href={openOriginalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Open original source</a>
                </Button>
              )}
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={goBack}>
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> {backLabel}
              </Button>
            </div>
          </div>
        ) : !docReady ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center" role="status" aria-label="Loading document">
            <Loader2 className="h-8 w-8 animate-spin text-gold" aria-hidden />
            <div>
              <p className="text-sm font-medium text-foreground">Loading document…</p>
              {loadKb && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(loadKb.loaded)}{loadKb.total ? ` of ${formatBytes(loadKb.total)}` : ''} streamed
                </p>
              )}
            </div>
            {loadKb?.total ? (
              <div className="h-1 w-56 overflow-hidden rounded-full bg-elevated">
                <div className="h-full bg-gold transition-[width]" style={{ width: `${Math.min(100, Math.round((loadKb.loaded / loadKb.total) * 100))}%` }} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto flex flex-col items-center gap-4 px-3 py-4 sm:px-6 sm:py-6" style={{ width: 'max-content', maxWidth: '100%' }}>
            {resource.verificationStatus === 'UNREACHABLE' && (
              <p className="mx-auto max-w-xl rounded-lg border border-border bg-card px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
                Our last automated check could not reach this official site — we are trying to load it anyway. If nothing appears, use
                {openOriginalUrl && <a href={openOriginalUrl} target="_blank" rel="noopener noreferrer" className="mx-1 text-gold hover:underline">Open original</a>}
                from your own network.
              </p>
            )}
            {Array.from({ length: numPages }, (_, i) => i + 1).map(n => {
              const ownRatio = pageRatios[n] ?? p1RenderedRatio
              return (
                <PageView
                  key={n}
                  pdf={doc}
                  pdfjsLib={pdfjsLib!}
                  pageNumber={n}
                  scale={effectiveScale}
                  rotation={rotation}
                  near={isNearPage(n)}
                  registerRef={registerPageRef}
                  placeholderW={placeholderW}
                  placeholderH={Math.round(placeholderW * ownRatio)}
                  onMeasured={handleMeasured}
                  hasMatches={pagesWithMatches.has(n)}
                  query={searchQuery.trim().toLowerCase()}
                  activeOccurrence={
                    activeMatch && activeMatch.page === n
                      ? Math.max(0, (matchesByPage.get(n) ?? []).indexOf(activeMatch))
                      : null
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// One page: progressively-rendered canvas + optional highlightable text layer.
// ═════════════════════════════════════════════════════════════════════════════
interface PageViewProps {
  pdf: PDFDocumentProxy
  pdfjsLib: typeof import('pdfjs-dist')
  pageNumber: number
  scale: number
  rotation: number
  near: boolean
  registerRef: (n: number, el: HTMLDivElement | null) => void
  placeholderW: number
  placeholderH: number
  onMeasured: (n: number, ratio: number) => void
  hasMatches: boolean
  query: string
  activeOccurrence: number | null
}

function PageView({
  pdf, pdfjsLib, pageNumber, scale, rotation, near,
  registerRef, placeholderW, placeholderH, onMeasured,
  hasMatches, query, activeOccurrence,
}: PageViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const pageProxyRef = useRef<PDFPageProxy | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const textLayerRef = useRef<{ cancel: () => void } | null>(null)
  const lastActiveRef = useRef<number | null>(null)

  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [rendered, setRendered] = useState(false)
  const [renderError, setRenderError] = useState(false)
  const [textBuilt, setTextBuilt] = useState(0)

  // Register the wrapper for scroll-jumps + the visibility observer.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    registerRef(pageNumber, el)
    return () => registerRef(pageNumber, null)
  }, [pageNumber, registerRef])

  // ─── Canvas render (progressive: only when near the viewport) ───
  useEffect(() => {
    if (!near) return
    let cancelled = false
    ;(async () => {
      try {
        const page = pageProxyRef.current?.pageNumber === pageNumber
          ? pageProxyRef.current
          : await pdf.getPage(pageNumber)
        if (cancelled) return
        pageProxyRef.current = page

        const rot = (page.rotate + rotation) % 360
        const viewport = page.getViewport({ scale, rotation: rot })
        setSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) })
        const vp1 = page.getViewport({ scale: 1 })
        onMeasured(pageNumber, vp1.width / vp1.height)

        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return

        renderTaskRef.current?.cancel()
        const task = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        })
        renderTaskRef.current = task
        await task.promise
        if (cancelled) return
        setRendered(true)
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error && err.name === 'RenderingCancelledException') return
        setRenderError(true)
      }
    })()
    return () => {
      cancelled = true
      try { renderTaskRef.current?.cancel() } catch { /* noop */ }
      // Free the page's canvas buffer once it leaves the render window —
      // full-page bitmaps are several MB each on long documents.
      const canvas = canvasRef.current
      if (canvas && canvas.width > 2) {
        canvas.width = 1
        canvas.height = 1
      }
    }
  }, [near, scale, rotation, pageNumber, pdf, onMeasured])

  // ─── Text layer (only for pages with search matches) ───
  useEffect(() => {
    if (!near || !rendered || !hasMatches || !pdfjsLib) return
    let cancelled = false
    ;(async () => {
      const page = pageProxyRef.current
      const container = textRef.current
      if (!page || !container) return
      try {
        const rot = (page.rotate + rotation) % 360
        const viewport = page.getViewport({ scale, rotation: rot })
        const tc = await page.getTextContent()
        if (cancelled) return
        container.innerHTML = ''
        const tl = new pdfjsLib.TextLayer({ textContentSource: tc, container, viewport })
        textLayerRef.current = tl
        await tl.render()
        if (!cancelled) setTextBuilt(t => t + 1)
      } catch {
        // Text layer is best-effort; canvas rendering already succeeded.
      }
    })()
    return () => {
      cancelled = true
      try { textLayerRef.current?.cancel() } catch { /* noop */ }
      if (textRef.current) textRef.current.innerHTML = ''
    }
  }, [near, rendered, hasMatches, scale, rotation, pageNumber, pdfjsLib])

  // ─── Highlight query matches inside the text layer ───
  useEffect(() => {
    const container = textRef.current
    if (!container || !textBuilt) return

    // Clear previous highlights (restore plain text nodes).
    container.querySelectorAll('mark').forEach(m => {
      const parent = m.parentNode
      if (!parent) return
      while (m.firstChild) parent.insertBefore(m.firstChild, m)
      m.remove()
    })
    container.normalize()
    if (!query) return

    const collectTextNodes = (): Text[] => {
      const out: Text[] = []
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) out.push(walker.currentNode as Text)
      return out
    }
    const rawLower = () => collectTextNodes().map(n => n.data).join('').toLowerCase()
    if (!rawLower().includes(query)) return

    let activeMark: HTMLElement | null = null
    // Find every occurrence, then wrap each one (re-walk before each wrap —
    // previous wraps changed the node structure).
    const firstPassNodes = collectTextNodes()
    const firstPassRaw = firstPassNodes.map(n => n.data).join('').toLowerCase()
    const positions: number[] = []
    let idx = firstPassRaw.indexOf(query)
    while (idx !== -1) {
      positions.push(idx)
      idx = firstPassRaw.indexOf(query, idx + Math.max(1, query.length))
    }

    for (let i = 0; i < positions.length; i++) {
      const s = positions[i]
      const e = s + query.length
      const nodes = collectTextNodes()
      let acc = 0
      for (const node of nodes) {
        const nStart = acc
        const nEnd = acc + node.data.length
        acc = nEnd
        if (nEnd <= s || nStart >= e) continue
        let target: Text = node
        const localStart = s - nStart
        const localEnd = Math.min(e, nEnd) - nStart
        if (localStart > 0) target = target.splitText(localStart)
        // After the first split, `target` starts at localStart — the match ends
        // at (localEnd - localStart) within it, NOT at localEnd.
        const withinTargetEnd = localEnd - localStart
        if (withinTargetEnd < target.length) target.splitText(withinTargetEnd)
        const mark = document.createElement('mark')
        mark.className = 'pdf-hl'
        if (activeOccurrence !== null && i === activeOccurrence) {
          mark.classList.add('pdf-hl-current')
          activeMark = mark
        }
        target.parentNode?.insertBefore(mark, target)
        mark.appendChild(target)
        if (nEnd >= e) break
      }
    }

    // Scroll the active match into view when it changes.
    if (activeMark && lastActiveRef.current !== activeOccurrence) {
      activeMark.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    lastActiveRef.current = activeOccurrence
  }, [textBuilt, query, activeOccurrence])

  const shownW = size?.w ?? placeholderW
  const shownH = size?.h ?? placeholderH

  return (
    <div
      ref={wrapRef}
      data-page={pageNumber}
      className="relative shrink-0"
      style={{ width: shownW, height: shownH }}
      aria-label={`Page ${pageNumber} of the document`}
    >
      {/* Placeholder / loading state behind the canvas */}
      {(!near || !rendered) && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded border border-border/70 bg-elevated/50"
          aria-hidden
        >
          {renderError ? (
            <span className="px-4 text-center text-xs text-destructive">Page {pageNumber} could not be rendered</span>
          ) : (
            <>
              {near && <Loader2 className="h-4 w-4 animate-spin text-gold/70" />}
              <span className="text-sm text-muted-foreground">Page {pageNumber}</span>
            </>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={cn('block rounded shadow-[0_2px_14px_rgba(0,0,0,0.35)]', (!near || !rendered) && 'invisible')}
        role="img"
        aria-label={`Rendered page ${pageNumber}`}
      />

      {/* Text layer only for pages with search matches — keeps long documents fast */}
      {hasMatches && (
        <div
          ref={textRef}
          className="pdf-text-layer"
          style={{ '--total-scale-factor': scale } as React.CSSProperties}
          aria-hidden
        />
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Riishe upload reader — the same tested reader component, pointed at the
// owner-only material file stream instead of the official-registry proxy.
// Opens as the familiar full-viewport overlay; Back returns to the workspace.
// ═════════════════════════════════════════════════════════════════════════════
export function MaterialPdfReader({ documentId, title, guestId, onBack, startPage }: {
  documentId: string
  title: string
  guestId: string
  onBack: () => void
  /** Deep link: open the reader at this physical page. */
  startPage?: number
}) {
  const meta: ResourceMetaDTO = {
    resource: {
      id: `mat_${documentId}`,
      title,
      provider: 'My materials',
      type: 'TEXTBOOK_PDF',
      url: '', // unused — the reader streams from srcOverride below
      language: 'English',
      accessType: 'FREE',
      verificationStatus: 'VERIFIED',
      lastChecked: null,
      attribution: null,
      note: null,
      fileKind: 'PDF',
      docDate: null,
    },
    context: {
      origin: 'none',
      examSlug: null,
      examName: null,
      examShortName: null,
      authority: null,
      stageName: null,
      subjectName: null,
      topicId: null,
      topicName: null,
    },
  }
  return (
    <PdfReader
      meta={meta}
      onRetry={() => window.location.reload()}
      srcOverride={{
        streamUrl: api.materialFileUrl(documentId, false, guestId),
        downloadUrl: api.materialFileUrl(documentId, true, guestId),
        progressKey: `mat_${documentId}`,
        openOriginalUrl: null,
        startPage,
      }}
      backOverride={{ label: 'Back to workspace', go: onBack }}
    />
  )
}
