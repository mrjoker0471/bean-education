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
  | { view: 'riishe-research' }
  | { view: 'riishe-research-session'; sessionId: string }
  | { view: 'practice'; doc?: string; topics?: string }
  | { view: 'topics' }
  | { view: 'settings' }
  | { view: 'auth' }
  // Phase 2B — student experience & curation
  | { view: 'onboarding'; edit?: boolean }
  | { view: 'dashboard' }
  | { view: 'workspace' }
  | { view: 'goals' }
  | { view: 'pyq-studio' }
  // Phase 4A — BEAN Teach marketplace (additive; every existing route unchanged)
  | { view: 'classes'; tab?: 'browse' | 'bookings' }
  | { view: 'class'; classId: string }
  | { view: 'teach-apply' }
  | { view: 'teach-dashboard' }
  | { view: 'teach-review' }
  // Phase 5 — BEAN Live Classroom (additive)
  | { view: 'classroom'; classId: string }
  // Phase 6 — BEAN Trust & Quality (additive)
  | { view: 'admin-trust' }
  | { view: 'my-reports' }
  | { view: 'trust-policy' }
  // Phase 7 — Institution & Career (additive; every existing route unchanged)
  | { view: 'institution' }
  | { view: 'institution-org'; orgId: string; section?: 'overview' | 'members' | 'groups' | 'classes' | 'assignments' | 'resources' | 'reports' }
  | { view: 'institution-group'; orgId: string; groupId: string; tab?: InstitutionGroupTab }
  | { view: 'career' }
  | { view: 'career-profile' }
  | { view: 'career-portfolio' }
  | { view: 'career-opportunities' }
  | { view: 'career-opportunity'; opportunityId: string }
  | { view: 'career-applications' }
  | { view: 'career-employer' }
  | { view: 'career-employer-org'; orgId: string; tab?: EmployerWorkspaceTab }
  | { view: 'admin-organizations' }
  | { view: 'admin-career' }
  | { view: 'not-found' }

/** Tabs of the group workspace (#/institution/:orgId/groups/:groupId[/:tab]).
 *  Unknown tab segments parse to `undefined` so the view falls back to overview. */
export type InstitutionGroupTab = 'overview' | 'roster' | 'classes' | 'assignments' | 'resources' | 'announcements'

/** Tabs of the employer workspace (#/career/employer/:orgId[/:tab]).
 *  Unknown tab segments parse to `undefined` so the view falls back to listings. */
export type EmployerWorkspaceTab = 'listings' | 'candidates'

export const EMPLOYER_WORKSPACE_TABS: readonly EmployerWorkspaceTab[] = ['listings', 'candidates']

export const INSTITUTION_GROUP_TABS: readonly InstitutionGroupTab[] = [
  'overview',
  'roster',
  'classes',
  'assignments',
  'resources',
  'announcements',
]

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
      // Phase 3A: research paths share the /riishe prefix — intercept first.
      if (parts[1] === 'research') {
        return parts[2]
          ? { view: 'riishe-research-session', sessionId: decodeURIComponent(parts[2]) }
          : { view: 'riishe-research' }
      }
      return {
        view: 'riishe',
        docId: parts[1] ? decodeURIComponent(parts[1]) : undefined,
        page: params.get('page') ? Number(params.get('page')) || undefined : undefined,
        topic: params.get('topic') ?? undefined,
      }
    case 'riishe-research':
      return { view: 'riishe-research' }
    case 'riishe-research-session':
      return { view: 'riishe-research-session', sessionId: parts[1] ? decodeURIComponent(parts[1]) : '' }
    case 'practice':
      return { view: 'practice', doc: params.get('doc') ?? undefined, topics: params.get('topics') ?? undefined }
    case 'topics':
      return { view: 'topics' }
    case 'settings':
      return { view: 'settings' }
    case 'auth':
      return { view: 'auth' }
    // Phase 2B — student experience & curation
    case 'onboarding':
      return { view: 'onboarding', edit: params.get('edit') === '1' }
    case 'dashboard':
      return { view: 'dashboard' }
    case 'workspace':
      return { view: 'workspace' }
    case 'goals':
      return { view: 'goals' }
    case 'pyq-studio':
      return { view: 'pyq-studio' }
    // Phase 4A — BEAN Teach marketplace
    case 'classes':
      return parts[1]
        ? { view: 'class', classId: decodeURIComponent(parts[1]) }
        : { view: 'classes', tab: params.get('tab') === 'bookings' ? 'bookings' : 'browse' }
    case 'teach':
      if (parts[1] === 'apply') return { view: 'teach-apply' }
      if (parts[1] === 'dashboard') return { view: 'teach-dashboard' }
      if (parts[1] === 'review') return { view: 'teach-review' }
      return { view: 'not-found' }
    // Phase 5 — BEAN Live Classroom
    case 'classroom':
      return parts[1] ? { view: 'classroom', classId: decodeURIComponent(parts[1]) } : { view: 'not-found' }
    // Phase 6 — BEAN Trust & Quality
    case 'admin':
      if (parts[1] === 'trust') return { view: 'admin-trust' }
      if (parts[1] === 'organizations') return { view: 'admin-organizations' }
      if (parts[1] === 'career') return { view: 'admin-career' }
      return { view: 'not-found' }
    case 'my-reports':
      return { view: 'my-reports' }
    case 'trust-policy':
      return { view: 'trust-policy' }
    // Phase 7 — Institution & Career
    case 'institution':
      if (!parts[1]) return { view: 'institution' }
      // #/institution/:orgId/groups/:groupId[/:tab] — one group's workspace.
      // `#/institution/:orgId/groups` (no groupId) stays the org groups section.
      if (parts[2] === 'groups' && parts[3]) {
        const groupTab = INSTITUTION_GROUP_TABS.includes(parts[4] as InstitutionGroupTab)
          ? (parts[4] as InstitutionGroupTab)
          : undefined
        return {
          view: 'institution-group',
          orgId: decodeURIComponent(parts[1]),
          groupId: decodeURIComponent(parts[3]),
          tab: groupTab,
        }
      }
      return {
        view: 'institution-org',
        orgId: decodeURIComponent(parts[1]),
        section: ['overview', 'members', 'groups', 'classes', 'assignments', 'resources', 'reports'].includes(parts[2] ?? '')
          ? (parts[2] as 'overview' | 'members' | 'groups' | 'classes' | 'assignments' | 'resources' | 'reports')
          : undefined,
      }
    case 'career': {
      const section = parts[1]
      if (!section) return { view: 'career' }
      if (section === 'profile') return { view: 'career-profile' }
      if (section === 'portfolio') return { view: 'career-portfolio' }
      if (section === 'opportunities') {
        return parts[2]
          ? { view: 'career-opportunity', opportunityId: decodeURIComponent(parts[2]) }
          : { view: 'career-opportunities' }
      }
      if (section === 'applications') return { view: 'career-applications' }
      // #/career/employer            — employer hub (auto-redirects to the first org)
      // #/career/employer/:orgId[/:tab] — one employer organization's workspace.
      // Unknown tab segments parse to `undefined` (view falls back to listings).
      if (section === 'employer') {
        if (!parts[2]) return { view: 'career-employer' }
        return {
          view: 'career-employer-org',
          orgId: decodeURIComponent(parts[2]),
          tab: EMPLOYER_WORKSPACE_TABS.includes(parts[3] as EmployerWorkspaceTab)
            ? (parts[3] as EmployerWorkspaceTab)
            : undefined,
        }
      }
      return { view: 'not-found' }
    }
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
    case 'riishe-research':
      return '#/riishe/research'
    case 'riishe-research-session':
      return `#/riishe/research/${encodeURIComponent(route.sessionId)}`
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
    // Phase 2B — student experience & curation
    case 'onboarding': return `#/onboarding${route.edit ? '?edit=1' : ''}`
    case 'dashboard': return '#/dashboard'
    case 'workspace': return '#/workspace'
    case 'goals': return '#/goals'
    case 'pyq-studio': return '#/pyq-studio'
    // Phase 4A — BEAN Teach marketplace
    case 'classes': return `#/classes${route.tab === 'bookings' ? '?tab=bookings' : ''}`
    case 'class': return `#/classes/${encodeURIComponent(route.classId)}`
    case 'teach-apply': return '#/teach/apply'
    case 'teach-dashboard': return '#/teach/dashboard'
    case 'teach-review': return '#/teach/review'
    // Phase 5 — BEAN Live Classroom
    case 'classroom': return `#/classroom/${encodeURIComponent(route.classId)}`
    // Phase 6 — BEAN Trust & Quality
    case 'admin-trust': return '#/admin/trust'
    case 'my-reports': return '#/my-reports'
    case 'trust-policy': return '#/trust-policy'
    // Phase 7 — Institution & Career
    case 'institution': return '#/institution'
    case 'institution-org': {
      const base = `#/institution/${encodeURIComponent(route.orgId)}`
      return route.section ? `${base}/${route.section}` : base
    }
    case 'institution-group': {
      const groupBase = `#/institution/${encodeURIComponent(route.orgId)}/groups/${encodeURIComponent(route.groupId)}`
      return route.tab ? `${groupBase}/${route.tab}` : groupBase
    }
    case 'career': return '#/career'
    case 'career-profile': return '#/career/profile'
    case 'career-portfolio': return '#/career/portfolio'
    case 'career-opportunities': return '#/career/opportunities'
    case 'career-opportunity': return `#/career/opportunities/${encodeURIComponent(route.opportunityId)}`
    case 'career-applications': return '#/career/applications'
    case 'career-employer': return '#/career/employer'
    case 'career-employer-org': {
      const base = `#/career/employer/${encodeURIComponent(route.orgId)}`
      return route.tab ? `${base}/${route.tab}` : base
    }
    case 'admin-organizations': return '#/admin/organizations'
    case 'admin-career': return '#/admin/career'
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
