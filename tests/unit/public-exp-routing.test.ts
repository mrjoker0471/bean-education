// ─── Public experience: routing + audience-intent routing tests ───────────────
// Covers:
//   • #/terms and #/privacy hash routes parse and serialize correctly
//   • every homepage feature card destination parses to a REAL route (no dead CTAs)
//   • the post-auth routing matrix (audience intent × onboarding × teacher
//     application status) — the Student/Teacher choice can never grant rights

import { describe, it, expect } from 'bun:test'
import { parseHash, routeToHash } from '@/lib/store'
import { FEATURE_GROUPS } from '@/components/bean/views/home-view'
import {
  postAuthDestination,
  postOnboardingDestination,
} from '@/lib/teacher-intent'

describe('public legal routes', () => {
  it('#/terms parses to the terms view', () => {
    expect(parseHash('#/terms')).toEqual({ view: 'terms' })
  })

  it('#/privacy parses to the privacy view', () => {
    expect(parseHash('#/privacy')).toEqual({ view: 'privacy' })
  })

  it('terms/privacy serialize to their canonical hashes', () => {
    expect(routeToHash({ view: 'terms' })).toBe('#/terms')
    expect(routeToHash({ view: 'privacy' })).toBe('#/privacy')
  })

  it('terms/privacy round-trip through parseHash', () => {
    expect(parseHash(routeToHash({ view: 'terms' })).view).toBe('terms')
    expect(parseHash(routeToHash({ view: 'privacy' })).view).toBe('privacy')
  })
})

describe('homepage feature cards — every destination is a real route', () => {
  const allFeatures = FEATURE_GROUPS.flatMap(g => g.features)

  it('shows the full milestone feature set (11 cards in 3 groups)', () => {
    expect(FEATURE_GROUPS.length).toBe(3)
    expect(allFeatures.length).toBe(11)
  })

  it('no feature card navigates to not-found (no dead CTA)', () => {
    for (const f of allFeatures) {
      const route = parseHash(f.hash)
      expect(route.view).not.toBe('not-found')
    }
  })

  it('each card lands on its intended destination view', () => {
    const expectations: Record<string, string> = {
      'exam-preparation': 'catalog',
      'riishe-ai': 'riishe',
      'study-workspace': 'materials',
      'learning-studio': 'riishe',
      'learning-intelligence': 'dashboard',
      'bean-teach': 'classes',
      'live-classrooms': 'classes',
      'teacher-growth': 'teach-dashboard',
      'institutions': 'institution',
      'career': 'career',
      'bean-intelligence': 'bean',
    }
    for (const f of allFeatures) {
      expect(parseHash(f.hash).view).toBe(expectations[f.id])
    }
  })

  it('sign-in-required cards declare it honestly', () => {
    const dashboard = allFeatures.find(f => f.id === 'learning-intelligence')
    expect(dashboard?.requires).toContain('sign-in')
    const teacherDash = allFeatures.find(f => f.id === 'teacher-growth')
    expect(teacherDash?.requires).toContain('teacher-approval')
  })

  it('live classrooms tab query parses to bookings', () => {
    const route = parseHash('#/classes?tab=bookings')
    expect(route.view).toBe('classes')
    if (route.view === 'classes') expect(route.tab).toBe('bookings')
  })
})

describe('post-auth routing matrix (audience intent is navigation only)', () => {
  it('teacher intent + not onboarded → onboarding first (intent preserved to the application)', () => {
    expect(postAuthDestination({ intent: 'TEACHER', onboardedAt: null, applicationStatus: null }).view).toBe('onboarding')
  })

  it('teacher intent + onboarded + no application → teacher application', () => {
    expect(postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: null }).view).toBe('teach-apply')
  })

  it('teacher intent + PENDING → genuine pending status (apply view)', () => {
    expect(postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: 'PENDING' }).view).toBe('teach-apply')
  })

  it('teacher intent + REJECTED → correction/resubmission (apply view)', () => {
    expect(postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: 'REJECTED' }).view).toBe('teach-apply')
  })

  it('teacher intent + APPROVED → teacher dashboard', () => {
    expect(postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: 'APPROVED' }).view).toBe('teach-dashboard')
  })

  it('student intent follows the existing onboarding → dashboard flow', () => {
    expect(postAuthDestination({ intent: 'STUDENT', onboardedAt: null, applicationStatus: null }).view).toBe('onboarding')
    expect(postAuthDestination({ intent: 'STUDENT', onboardedAt: '2026-01-01', applicationStatus: 'APPROVED' }).view).toBe('dashboard')
    expect(postAuthDestination({ intent: null, onboardedAt: '2026-01-01', applicationStatus: null }).view).toBe('dashboard')
  })

  it('onboarding handoff honours teacher intent without granting any role', () => {
    expect(postOnboardingDestination('TEACHER').view).toBe('teach-apply')
    expect(postOnboardingDestination('STUDENT').view).toBe('dashboard')
    expect(postOnboardingDestination(null).view).toBe('dashboard')
  })
})
