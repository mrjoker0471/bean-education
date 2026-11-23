'use client'

// Reading progress for the integrated PDF viewer.
//
// Privacy model (per spec): progress is stored per GUEST PROFILE and per
// DOCUMENT — never in one shared global key. BEAN Education identifies a student
// by the guestId in its zustand store (persisted in `bean_guest_id`), so the
// natural per-account namespace is that guestId. Guests without a guestId get
// a temporary session-only map (kept in memory for the tab's lifetime).

const STORE_KEY = 'bean_reading_progress_v1'
const MAX_DOCS_PER_GUEST = 300

export interface ReadingProgress {
  /** Last page the student was actually viewing. */
  lastPage: number
  /** Total pages when last saved (lets us sanity-check restores). */
  totalPages: number
  /** Highest page reached — the honest "reading progress" measure. */
  maxPage: number
  /** Zoom preference: mode + custom scale when mode === 'custom'. */
  zoomMode: 'fit-width' | 'fit-page' | 'custom'
  zoomScale: number | null
  rotation: number
  updatedAt: number
}

type GuestDocs = Record<string, ReadingProgress> // resourceId → progress
type RootStore = Record<string, GuestDocs> // guestId → per-document progress

// Session-only fallback for guests whose id isn't known yet.
const sessionStore: Record<string, ReadingProgress> = {}

function readRoot(): RootStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as RootStore) : {}
  } catch {
    return {}
  }
}

function writeRoot(root: RootStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(root))
  } catch {
    // Storage full / private mode — non-fatal, progress just won't persist.
  }
}

function prune(guestDocs: Record<string, ReadingProgress>) {
  const ids = Object.keys(guestDocs)
  if (ids.length <= MAX_DOCS_PER_GUEST) return
  ids
    .sort((a, b) => (guestDocs[a].updatedAt ?? 0) - (guestDocs[b].updatedAt ?? 0))
    .slice(0, ids.length - MAX_DOCS_PER_GUEST)
    .forEach(id => delete guestDocs[id])
}

/** Load saved progress for one document of one guest. */
export function loadReadingProgress(guestId: string, resourceId: string): ReadingProgress | null {
  if (!resourceId) return null
  if (!guestId) return sessionStore[resourceId] ?? null
  try {
    const root = readRoot()
    const doc = root[guestId]?.[resourceId]
    if (!doc) return null
    if (typeof doc.lastPage !== 'number' || doc.lastPage < 1) return null
    return doc
  } catch {
    return null
  }
}

/**
 * Merge-save progress for one document of one guest.
 * Called on page change / zoom / rotation — small, idempotent writes.
 */
export function saveReadingProgress(
  guestId: string,
  resourceId: string,
  patch: Partial<ReadingProgress> & { lastPage?: number }
) {
  if (!resourceId) return
  const next: ReadingProgress = {
    lastPage: Math.max(1, patch.lastPage ?? 1),
    totalPages: patch.totalPages ?? 0,
    maxPage: Math.max(1, patch.maxPage ?? patch.lastPage ?? 1),
    zoomMode: patch.zoomMode ?? 'fit-width',
    zoomScale: patch.zoomScale ?? null,
    rotation: patch.rotation ?? 0,
    updatedAt: Date.now(),
  }

  if (!guestId) {
    sessionStore[resourceId] = next
    return
  }

  try {
    const root = readRoot()
    const guestDocs = root[guestId] ?? {}
    const prev = guestDocs[resourceId]
    guestDocs[resourceId] = {
      ...next,
      // maxPage must never go backwards within a document.
      maxPage: Math.max(prev?.maxPage ?? 1, next.maxPage),
      totalPages: next.totalPages || prev?.totalPages || 0,
    }
    prune(guestDocs)
    root[guestId] = guestDocs
    writeRoot(root)
  } catch {
    // Non-fatal.
  }
}

/** Percentage (0–100) of a document read, from progress + total pages. */
export function progressPercent(progress: ReadingProgress | null, totalPages: number): number {
  if (!progress || !totalPages) return 0
  const reached = Math.min(progress.maxPage, totalPages)
  return Math.max(0, Math.min(100, Math.round((reached / totalPages) * 100)))
}
