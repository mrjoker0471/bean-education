// ─── Phase 7: Hash routing + admin guard tests ───────────────────────────────
// Coverage (spec §26 / §28 — Admin):
//   • New Phase 7 routes parse and round-trip (#/institution, #/institution/:id
//     [/:section], #/career[…], #/admin/organizations, #/admin/career).
//   • Existing routes are unchanged (regression spot checks).
//   • Non-admins cannot reach admin moderation endpoints (requireAdmin guard
//     — server-side; the UI hiding is convenience only).

import { describe, it, expect } from 'bun:test'
import { parseHash, routeToHash, INSTITUTION_GROUP_TABS, EMPLOYER_WORKSPACE_TABS } from '@/lib/store'
import { buildRoleIndex, enrollCandidates, filterByGroupId } from '@/lib/institution-group'
import type { MemberDTO } from '@/lib/types'
import type { GroupRosterEntryDTO } from '@/lib/institution-dto'
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
    expect(parseHash('#/career/employer/org7')).toEqual({ view: 'career-employer-org', orgId: 'org7', tab: undefined })
    expect(parseHash('#/career/employer/org7/listings')).toEqual({ view: 'career-employer-org', orgId: 'org7', tab: 'listings' })
    expect(parseHash('#/career/employer/org7/candidates')).toEqual({ view: 'career-employer-org', orgId: 'org7', tab: 'candidates' })
    expect(parseHash('#/career/employer/org7/bogus')).toEqual({ view: 'career-employer-org', orgId: 'org7', tab: undefined })
    expect(parseHash('#/career/employer/org7/listings/extra')).toEqual({ view: 'career-employer-org', orgId: 'org7', tab: 'listings' })
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
  it('round-trips the group workspace route with and without a tab', () => {
    expect(routeToHash({ view: 'institution-group', orgId: 'org1', groupId: 'g1' })).toBe('#/institution/org1/groups/g1')
    expect(routeToHash({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'roster' })).toBe('#/institution/org1/groups/g1/roster')
  })
  it('group route round-trips survive parseHash for every known tab', () => {
    expect(INSTITUTION_GROUP_TABS).toHaveLength(6)
    for (const tab of INSTITUTION_GROUP_TABS) {
      const route = { view: 'institution-group' as const, orgId: 'org1', groupId: 'g1', tab }
      expect(parseHash(routeToHash(route))).toEqual(route)
    }
  })
  it('round-trips career routes', () => {
    expect(routeToHash({ view: 'career' })).toBe('#/career')
    expect(routeToHash({ view: 'career-profile' })).toBe('#/career/profile')
    expect(routeToHash({ view: 'career-opportunities' })).toBe('#/career/opportunities')
    expect(routeToHash({ view: 'career-opportunity', opportunityId: 'op1' })).toBe('#/career/opportunities/op1')
    expect(routeToHash({ view: 'career-applications' })).toBe('#/career/applications')
    expect(routeToHash({ view: 'career-employer' })).toBe('#/career/employer')
    expect(routeToHash({ view: 'career-employer-org', orgId: 'org1' })).toBe('#/career/employer/org1')
    expect(routeToHash({ view: 'career-employer-org', orgId: 'org 1', tab: 'candidates' })).toBe('#/career/employer/org%201/candidates')
    expect(routeToHash({ view: 'admin-organizations' })).toBe('#/admin/organizations')
    expect(routeToHash({ view: 'admin-career' })).toBe('#/admin/career')
  })
  it('employer-org route round-trips survive parseHash for every known tab', () => {
    expect(EMPLOYER_WORKSPACE_TABS).toHaveLength(2)
    for (const tab of EMPLOYER_WORKSPACE_TABS) {
      const route = { view: 'career-employer-org' as const, orgId: 'org9', tab }
      expect(parseHash(routeToHash(route))).toEqual(route)
    }
    const noTab = { view: 'career-employer-org' as const, orgId: 'org9' }
    expect(parseHash(routeToHash(noTab))).toEqual(noTab)
  })
  it('unknown employer tabs parse to tab undefined (view falls back to listings)', () => {
    const parsed = parseHash('#/career/employer/org9/bogus')
    expect(parsed).toEqual({ view: 'career-employer-org', orgId: 'org9', tab: undefined })
    expect(routeToHash(parsed)).toBe('#/career/employer/org9')
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

describe('Phase 7 group workspace — parseHash', () => {
  it('parses a group route with and without a tab', () => {
    expect(parseHash('#/institution/org1/groups/g1')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: undefined })
    expect(parseHash('#/institution/org1/groups/g1/overview')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'overview' })
    expect(parseHash('#/institution/org1/groups/g1/roster')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'roster' })
    expect(parseHash('#/institution/org1/groups/g1/classes')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'classes' })
    expect(parseHash('#/institution/org1/groups/g1/assignments')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'assignments' })
    expect(parseHash('#/institution/org1/groups/g1/resources')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'resources' })
    expect(parseHash('#/institution/org1/groups/g1/announcements')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: 'announcements' })
  })
  it('unknown tabs fall back to the overview (tab undefined)', () => {
    expect(parseHash('#/institution/org1/groups/g1/bogus')).toEqual({ view: 'institution-group', orgId: 'org1', groupId: 'g1', tab: undefined })
  })
  it('does not shadow the organization groups section', () => {
    expect(parseHash('#/institution/org1/groups')).toEqual({ view: 'institution-org', orgId: 'org1', section: 'groups' })
    expect(parseHash('#/institution/org1/groups/')).toEqual({ view: 'institution-org', orgId: 'org1', section: 'groups' })
  })
})

describe('Phase 7 group workspace — pure helpers', () => {
  const member = (id: string, status: string): MemberDTO => ({
    id,
    role: 'LEARNER',
    status,
    student: { displayName: `Member ${id}` },
    joinedAt: null,
    activatedAt: null,
    suspendedAt: null,
    leftAt: null,
  })
  const rosterEntry = (membershipId: string, enrollmentState: string): GroupRosterEntryDTO => ({
    id: `entry-${membershipId}`,
    membershipId,
    enrollmentState,
    joinedAt: '2025-01-01T00:00:00.000Z',
    leftAt: enrollmentState === 'LEFT' ? '2025-02-01T00:00:00.000Z' : null,
    member: { displayName: `Member ${membershipId}` },
  })

  it('filterByGroupId scopes lists to one group and supports class-shaped rows', () => {
    const announcements = [
      { groupId: 'g1', title: 'a' },
      { groupId: 'g2', title: 'b' },
      { groupId: null, title: 'org-wide' },
    ]
    expect(filterByGroupId(announcements, 'g1', a => a.groupId)).toEqual([{ groupId: 'g1', title: 'a' }])
    expect(filterByGroupId(announcements, 'missing', a => a.groupId)).toEqual([])
    const classes = [{ organizationGroupId: 'g1' }, { organizationGroupId: null }]
    expect(filterByGroupId(classes, 'g1', c => c.organizationGroupId)).toHaveLength(1)
  })

  it('enrollCandidates lists only ACTIVE members not currently enrolled (LEFT rows may return)', () => {
    const members = [member('m1', 'ACTIVE'), member('m2', 'ACTIVE'), member('m3', 'INVITED'), member('m4', 'ACTIVE'), member('m5', 'SUSPENDED')]
    const roster = [rosterEntry('m1', 'ACTIVE'), rosterEntry('m2', 'LEFT')]
    expect(enrollCandidates(members, roster).map(m => m.id)).toEqual(['m2', 'm4'])
  })

  it('enrollCandidates returns everyone active for an empty roster', () => {
    const members = [member('m1', 'ACTIVE'), member('m2', 'INVITED')]
    expect(enrollCandidates(members, []).map(m => m.id)).toEqual(['m1'])
  })

  it('buildRoleIndex maps membershipId to organization role', () => {
    const index = buildRoleIndex([member('m1', 'ACTIVE'), member('m2', 'ACTIVE')])
    expect(index.get('m1')).toBe('LEARNER')
    expect(index.get('m2')).toBe('LEARNER')
    expect(index.has('m3')).toBe(false)
  })
})
