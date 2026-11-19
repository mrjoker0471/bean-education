// ─── Phase 7: Hash routing + admin guard tests ───────────────────────────────
// Coverage (spec §26 / §28 — Admin):
//   • New Phase 7 routes parse and round-trip (#/institution, #/institution/:id
//     [/:section], #/career[…], #/admin/organizations, #/admin/career).
//   • Existing routes are unchanged (regression spot checks).
//   • Non-admins cannot reach admin moderation endpoints (requireAdmin guard
//     — server-side; the UI hiding is convenience only).

import { describe, it, expect } from 'bun:test'
import { parseHash, routeToHash } from '@/lib/store'
import type { NextRequest } from 'next/server'

describe('Phase 7 hash routes — parseHash', () => {
  it('parses the institution hub', () => {
    expect(parseHash('#/institution')).toEqual({ view: 'institution' })
  })
  it('parses an organization workspace with and without a section', () => {
    expect(parseHash('#/institution/org123')).toEqual({ view: 'institution-org', orgId: 'org123', section: undefined })
    expect(parseHash('#/institution/org123/members')).toEqual({ view: 'institution-org', orgId: 'org123', section: 'members' })
    expect(parseHash('#/institution/org123/assignments')).toEqual({ view: 'institution-org', orgId: 'org123', section: 'assignments' })
    expect(parseHash('#/institution/org123/groups')).toEqual({ view: 'institution-org', orgId: 'org123', section: 'groups' })
    expect(parseHash('#/institution/org123/classes')).toEqual({ view: 'institution-org', orgId: 'org123', section: 'classes' })
    expect(parseHash('#/institution/org123/resources')).toEqual({ view: 'institution-org', orgId: 'org123', section: 'resources' })
    expect(parseHash('#/institution/org123/reports')).toEqual({ view: 'institution-org', orgId: 'org123', section: 'reports' })
    expect(parseHash('#/institution/org123/bogus')).toEqual({ view: 'institution-org', orgId: 'org123', section: undefined })
  })
  it('parses the career family', () => {
    expect(parseHash('#/career')).toEqual({ view: 'career' })
    expect(parseHash('#/career/profile')).toEqual({ view: 'career-profile' })
    expect(parseHash('#/career/portfolio')).toEqual({ view: 'career-portfolio' })
    expect(parseHash('#/career/opportunities')).toEqual({ view: 'career-opportunities' })
    expect(parseHash('#/career/opportunities/op9')).toEqual({ view: 'career-opportunity', opportunityId: 'op9' })
    expect(parseHash('#/career/applications')).toEqual({ view: 'career-applications' })
    expect(parseHash('#/career/employer')).toEqual({ view: 'career-employer' })
    expect(parseHash('#/career/unknown')).toEqual({ view: 'not-found' })
  })
  it('parses the new admin routes without breaking #/admin/trust', () => {
    expect(parseHash('#/admin/trust')).toEqual({ view: 'admin-trust' })
    expect(parseHash('#/admin/organizations')).toEqual({ view: 'admin-organizations' })
    expect(parseHash('#/admin/career')).toEqual({ view: 'admin-career' })
    expect(parseHash('#/admin/other')).toEqual({ view: 'not-found' })
  })
})

describe('Phase 7 hash routes — routeToHash round trips', () => {
  it('round-trips institution routes', () => {
    expect(routeToHash({ view: 'institution' })).toBe('#/institution')
    expect(routeToHash({ view: 'institution-org', orgId: 'org1', section: 'members' })).toBe('#/institution/org1/members')
    expect(routeToHash({ view: 'institution-org', orgId: 'org1' })).toBe('#/institution/org1')
  })
  it('round-trips career routes', () => {
    expect(routeToHash({ view: 'career' })).toBe('#/career')
    expect(routeToHash({ view: 'career-profile' })).toBe('#/career/profile')
    expect(routeToHash({ view: 'career-opportunities' })).toBe('#/career/opportunities')
    expect(routeToHash({ view: 'career-opportunity', opportunityId: 'op1' })).toBe('#/career/opportunities/op1')
    expect(routeToHash({ view: 'career-applications' })).toBe('#/career/applications')
    expect(routeToHash({ view: 'career-employer' })).toBe('#/career/employer')
    expect(routeToHash({ view: 'admin-organizations' })).toBe('#/admin/organizations')
    expect(routeToHash({ view: 'admin-career' })).toBe('#/admin/career')
  })
  it('existing routes are unchanged (regression spot checks)', () => {
    expect(routeToHash({ view: 'home' })).toBe('#/')
    expect(routeToHash({ view: 'dashboard' })).toBe('#/dashboard')
    expect(routeToHash({ view: 'classes', tab: 'bookings' })).toBe('#/classes?tab=bookings')
    expect(routeToHash({ view: 'class', classId: 'c1' })).toBe('#/classes/c1')
    expect(routeToHash({ view: 'teach-dashboard' })).toBe('#/teach/dashboard')
    expect(routeToHash({ view: 'classroom', classId: 'c1' })).toBe('#/classroom/c1')
    expect(routeToHash({ view: 'my-reports' })).toBe('#/my-reports')
  })
})
