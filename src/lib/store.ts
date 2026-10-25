'use client'

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { BeanContext, BeanSettings } from './types'

export type Route =
  | { view: 'home' }
  | { view: 'catalog'; category?: string; q?: string }
  | { view: 'exam'; slug: string; tab?: string }
  | { view: 'topic'; topicId: string }
  | { view: 'test'; attemptId: string }
  | { view: 'result'; attemptId: string }
  | { view: 'bean'; seeded?: boolean }
  | { view: 'progress' }
  | { view: 'pdf'; resourceId: string }
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
      return parts[1] ? { view: 'result', attemptId: parts[1] } : { view: 'not-found' }
    case 'bean':
      return { view: 'bean', seeded: params.get('seeded') === '1' }
    case 'progress':
      return { view: 'progress' }
    case 'pdf':
      return parts[1] ? { view: 'pdf', resourceId: decodeURIComponent(parts[1]) } : { view: 'not-found' }
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
    case 'result': return `#/result/${route.attemptId}`
    case 'bean': return `#/bean${route.seeded ? '?seeded=1' : ''}`
    case 'progress': return '#/progress'
    case 'pdf': return `#/pdf/${encodeURIComponent(route.resourceId)}`
    default: return '#/'
  }
}

interface AppState {
  route: Route
  guestId: string
  beanContext: BeanContext | null
  beanSettings: BeanSettings
  _hydrated: boolean
  init: () => void
  navigate: (route: Route) => void
  setRoute: (route: Route) => void
  setBeanContext: (ctx: BeanContext | null) => void
  setBeanSettings: (s: Partial<BeanSettings>) => void
}

const GUEST_KEY = 'bean_guest_id'
const BEAN_SETTINGS_KEY = 'bean_bean_settings'

export const useAppStore = create<AppState>((set, get) => ({
  route: { view: 'home' },
  guestId: '',
  beanContext: null,
  beanSettings: { style: 'exam-focused', showSourceContext: true },
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
}))

export function navigateExam(slug: string, tab?: string) {
  useAppStore.getState().navigate({ view: 'exam', slug, tab })
}
