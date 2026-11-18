'use client'

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { api } from './api'
import type { AuthedStudent, BeanContext, BeanSettings } from './types'

export type Route =
  | { view: 'home' }
  | { view: 'catalog'; category?: string; q?: string }
  | { view: 'exam'; slug: string; tab?: string }
  | { view: 'topic'; topicId: string }
  | { view: 'test'; attemptId: string }
  | { view: 'result'; attemptId: string; questionId?: string }
  | { view: 'bean'; seeded?: boolean }
  | { view: 'progress' }
  | { view: 'pdf'; resourceId: string }
  | { view: 'materials' }
  | { view: 'riishe'; docId?: string; page?: number; topic?: string }
  | { view: 'practice'; doc?: string; topics?: string }
  | { view: 'topics' }
  | { view: 'settings' }
  | { view: 'auth' }
  | { view: 'not-found' }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const [path, query] = raw.split('?')
  const params = new URLSearchParams(query ?? '')
  const parts = (path ?? '').split('/').filter(Boolean)

  if (parts.length === 0) return { view: 'home' }
  switch (parts[0]) {
    case 'catalog':
      return { view: 'catalog', category: params.get('category') ?? undefined, q: params.get('q') ?? undefined }
    case 'exam':
      return parts[1] ? { view: 'exam', slug: parts[1], tab: params.get('tab') ?? undefined } : { view: 'not-found' }
    case 'topic':
      return parts[1] ? { view: 'topic', topicId: parts[1] } : { view: 'not-found' }
    case 'test':
      return parts[1] ? { view: 'test', attemptId: parts[1] } : { view: 'not-found' }
    case 'result':
      return parts[1] ? { view: 'result', attemptId: parts[1], questionId: params.get('q') ?? undefined } : { view: 'not-found' }
    case 'bean':
      return { view: 'bean', seeded: params.get('seeded') === '1' }
    case 'progress':
      return { view: 'progress' }
    case 'pdf':
      return parts[1] ? { view: 'pdf', resourceId: decodeURIComponent(parts[1]) } : { view: 'not-found' }
    case 'materials':
      return { view: 'materials' }
    case 'riishe':
      return {
        view: 'riishe',
        docId: parts[1] ? decodeURIComponent(parts[1]) : undefined,
        page: params.get('page') ? Number(params.get('page')) || undefined : undefined,
        topic: params.get('topic') ?? undefined,
      }
    case 'practice':
      return { view: 'practice', doc: params.get('doc') ?? undefined, topics: params.get('topics') ?? undefined }
    case 'topics':
      return { view: 'topics' }
    case 'settings':
      return { view: 'settings' }
    case 'auth':
      return { view: 'auth' }
    default:
      return { view: 'not-found' }
  }
}

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'home': return '#/'
    case 'catalog': {
      const p = new URLSearchParams()
      if (route.category) p.set('category', route.category)
      if (route.q) p.set('q', route.q)
      const qs = p.toString()
      return `#/catalog${qs ? '?' + qs : ''}`
    }
    case 'exam': return `#/exam/${route.slug}${route.tab ? `?tab=${route.tab}` : ''}`
    case 'topic': return `#/topic/${route.topicId}`
    case 'test': return `#/test/${route.attemptId}`
    case 'result': return `#/result/${route.attemptId}${route.questionId ? `?q=${encodeURIComponent(route.questionId)}` : ''}`
    case 'bean': return `#/bean${route.seeded ? '?seeded=1' : ''}`
    case 'progress': return '#/progress'
    case 'pdf': return `#/pdf/${encodeURIComponent(route.resourceId)}`
    case 'materials': return '#/materials'
    case 'riishe': {
      const p = new URLSearchParams()
      if (route.page) p.set('page', String(route.page))
      if (route.topic) p.set('topic', route.topic)
      const qs = p.toString()
      const base = route.docId ? `#/riishe/${encodeURIComponent(route.docId)}` : '#/riishe'
      return `${base}${qs ? '?' + qs : ''}`
    }
    case 'practice': {
      const p = new URLSearchParams()
      if (route.doc) p.set('doc', route.doc)
      if (route.topics) p.set('topics', route.topics)
      const qs = p.toString()
      return `#/practice${qs ? '?' + qs : ''}`
    }
    case 'topics': return '#/topics'
    case 'settings': return '#/settings'
    case 'auth': return '#/auth'
    default: return '#/'
  }
}

interface AppState {
  route: Route
  guestId: string
  beanContext: BeanContext | null
  beanSettings: BeanSettings
  /** Signed-in student (null = guest mode — fully functional). */
  authedStudent: AuthedStudent | null
  /** True once the initial session probe (/api/auth/me) has settled. */
  authChecked: boolean
  _hydrated: boolean
  init: () => void
  navigate: (route: Route) => void
  setRoute: (route: Route) => void
  setBeanContext: (ctx: BeanContext | null) => void
  setBeanSettings: (s: Partial<BeanSettings>) => void
  refreshAuth: () => Promise<void>
  authSignIn: (email: string, password: string) => Promise<void>
  authSignUp: (email: string, password: string, displayName?: string) => Promise<void>
  authSignOut: () => Promise<void>
  authDeleteAccount: () => Promise<void>
  claimGuestData: () => Promise<{ attempts: number; documents: number; tests: number; chatTurns: number }>
}

const GUEST_KEY = 'bean_guest_id'
const BEAN_SETTINGS_KEY = 'bean_bean_settings'

export const useAppStore = create<AppState>((set, get) => ({
  route: { view: 'home' },
  guestId: '',
  beanContext: null,
  beanSettings: { style: 'exam-focused', showSourceContext: true },
  authedStudent: null,
  authChecked: false,
  _hydrated: false,
  init: () => {
    if (get()._hydrated) return
    let guestId = ''
    try {
      guestId = localStorage.getItem(GUEST_KEY) ?? ''
      if (!guestId) {
        guestId = uuidv4()
        localStorage.setItem(GUEST_KEY, guestId)
      }
      const rawSettings = localStorage.getItem(BEAN_SETTINGS_KEY)
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) as Partial<BeanSettings>
        set({ beanSettings: { ...get().beanSettings, ...parsed } })
      }
    } catch {
      guestId = uuidv4()
    }
    set({ guestId, route: parseHash(window.location.hash), _hydrated: true })
    window.addEventListener('hashchange', () => {
      set({ route: parseHash(window.location.hash) })
    })
    // Session probe (Phase 2A): settle the signed-in/guest state once on boot.
    void get().refreshAuth()
  },
  navigate: (route) => {
    const hash = routeToHash(route)
    if (window.location.hash === hash) {
      set({ route })
    } else {
      window.location.hash = hash // triggers hashchange listener
    }
    window.scrollTo({ top: 0 })
  },
  setRoute: (route) => set({ route }),
  setBeanContext: (ctx) => set({ beanContext: ctx }),
  setBeanSettings: (s) => {
    const next = { ...get().beanSettings, ...s }
    set({ beanSettings: next })
    try {
      localStorage.setItem(BEAN_SETTINGS_KEY, JSON.stringify(next))
    } catch { /* non-fatal */ }
  },

  // ─── Student identity (Phase 2A): additive — guest mode stays unchanged ───
  refreshAuth: async () => {
    try {
      const { student } = await api.authMe()
      set({ authedStudent: student, authChecked: true })
    } catch {
      set({ authedStudent: null, authChecked: true })
    }
  },
  authSignIn: async (email, password) => {
    const { student } = await api.authLogin({ email, password })
    set({ authedStudent: student, authChecked: true })
    // Auto-claim this device's guest data into the account (idempotent, safe:
    // only rows with no owner are claimed; guest identity is preserved).
    const gid = get().guestId
    if (gid) await api.claimGuest(gid).catch(() => undefined)
  },
  authSignUp: async (email, password, displayName) => {
    const { student } = await api.authRegister({ email, password, ...(displayName ? { displayName } : {}) })
    set({ authedStudent: student, authChecked: true })
    const gid = get().guestId
    if (gid) await api.claimGuest(gid).catch(() => undefined)
  },
  authSignOut: async () => {
    await api.authLogout()
    set({ authedStudent: null })
  },
  authDeleteAccount: async () => {
    await api.deleteStudentAccount()
    set({ authedStudent: null })
  },
  claimGuestData: async () => {
    const gid = get().guestId
    if (!gid) return { attempts: 0, documents: 0, tests: 0, chatTurns: 0 }
    const res = await api.claimGuest(gid)
    return res.claims
  },
}))

export function navigateExam(slug: string, tab?: string) {
  useAppStore.getState().navigate({ view: 'exam', slug, tab })
}

/**
 * Privacy control (Settings): discard the device's guest identity and start a
 * fresh, empty session. Updates BOTH the stored identity and the live store so
 * the running app immediately uses the new session. Only affects the LOCAL
 * identity — server-side records are deleted separately via DELETE /api/account
 * (the Settings UI makes both steps explicit).
 */
export function resetGuestIdentity(): void {
  const fresh = uuidv4()
  try {
    localStorage.setItem(GUEST_KEY, fresh)
  } catch {
    // Non-fatal: without localStorage the app already runs an ephemeral session.
  }
  useAppStore.setState({ guestId: fresh, beanContext: null })
}
