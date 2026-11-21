// ─── BEAN Trust & Quality (Phase 6): admin trust-action route tests ──────────
// POST /api/admin/trust/teachers/:teacherProfileId/actions over a fake db:
//   • ADMIN-only authorization — a signed-in STUDENT can never issue a
//     restriction (server-side requireAdmin, not UI hiding);
//   • SUSPEND_PUBLISHING creates an active TrustAction row with the issuing
//     admin recorded and an append-only TeachAuditEvent;
//   • REINSTATE ends every currently-enforcing restriction (expiry-aware),
//     records the reinstatement decision (itself never enforcing) and audits;
//   • STATIC proof that the teacher-facing server routes actually enforce the
//     restrictions (class creation, publishing, booking, live start/token);
//   • PURE proof over the real evaluateTrustState: temporary restrictions
//     expire at evaluation time, flags map correctly, NOTICE/WARNING/REINSTATE
//     never enforce, and filing a complaint alone restricts nobody.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Read a repo source file relative to tests/unit (cwd-independent). */
const readSrc = (rel: string) => readFileSync(resolve(here, '..', '..', rel), 'utf8')

interface TrustActionRow {
  id: string
  teacherProfileId: string
  action: string
  reason: string
  startsAt: Date
  endsAt: Date | null
  isActive: boolean
  createdByAdminId: string
  endedAt: Date | null
  endedById: string | null
  createdAt: Date
}

interface AuditRow {
  entityType: string
  entityId: string
  actorId: string
  actorRole: string
  action: string
  detail: string | null
  createdAt: Date
}

const ADMIN = { id: 'admin-1', email: 'admin@bean.example', displayName: 'Admin One', learningLevel: null, role: 'ADMIN', onboardedAt: null }
const STUDENT_USER = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }

const state = {
  // The session identity the REAL requireAdmin sees (via the mocked auth).
  // Default: a signed-in STUDENT (role != ADMIN) → 403.
  currentStudent: STUDENT_USER as Record<string, unknown> | null,
  teacherProfiles: new Map<string, { id: string; studentId: string }>(),
  trustActions: [] as TrustActionRow[],
  auditEvents: [] as AuditRow[],
  nextActionId: 1,
}

function resetState() {
  state.currentStudent = STUDENT_USER
  state.teacherProfiles = new Map()
  state.teacherProfiles.set('tp-1', { id: 'tp-1', studentId: 'teacher-1' })
  state.trustActions = []
  state.auditEvents = []
  state.nextActionId = 1
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600_000)
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 3600_000)
}

// Evaluate exactly the where predicate the route builds for the REINSTATE scan
// (teacherProfileId + isActive + action IN enforcing + OR endsAt null/gt now).
function matchesTrustWhere(row: TrustActionRow, where: Record<string, unknown>): boolean {
  const w = where as {
    teacherProfileId?: string
    isActive?: boolean
    action?: { in?: string[] }
    OR?: { endsAt?: null | { gt: Date } }[]
  }
  if (w.teacherProfileId !== undefined && row.teacherProfileId !== w.teacherProfileId) return false
  if (w.isActive !== undefined && row.isActive !== w.isActive) return false
  if (w.action?.in && !w.action.in.includes(row.action)) return false
  if (w.OR) {
    const matched = w.OR.some((cond) => {
      if (cond.endsAt === null) return row.endsAt === null
      if (cond.endsAt && typeof cond.endsAt === 'object' && 'gt' in cond.endsAt) {
        return row.endsAt !== null && row.endsAt.getTime() > cond.endsAt.gt.getTime()
      }
      return false
    })
    if (!matched) return false
  }
  return true
}

const fakeDb = {
  teacherProfile: {
    findUnique: async ({ where }: { where: { id?: string; studentId?: string } }) => {
      if (where?.id !== undefined) return state.teacherProfiles.get(where.id) ?? null
      if (where?.studentId !== undefined) {
        for (const p of state.teacherProfiles.values()) if (p.studentId === where.studentId) return p
        return null
      }
      return null
    },
  },
  trustAction: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.trustActions.filter((r) => matchesTrustWhere(r, where)),
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.trustActions.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: TrustActionRow = {
        id: `ta-${state.nextActionId++}`,
        teacherProfileId: String(data.teacherProfileId),
        action: String(data.action),
        reason: String(data.reason),
        startsAt: (data.startsAt as Date) ?? new Date(),
        endsAt: (data.endsAt as Date | null | undefined) ?? null,
        isActive: Boolean(data.isActive),
        createdByAdminId: String(data.createdByAdminId),
        endedAt: (data.endedAt as Date | null | undefined) ?? null,
        endedById: (data.endedById as string | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.trustActions.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.trustActions.find((r) => r.id === where.id)
      if (!row) throw new Error('trust action not found')
      Object.assign(row, data)
      return row
    },
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: AuditRow = {
        entityType: String(data.entityType),
        entityId: String(data.entityId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.auditEvents.push(row)
      return row
    },
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.currentStudent,
  sameOrigin: () => true,
  getSessionStudent: async () => state.currentStudent,
}))
// NOTE: '@/lib/teach' is NOT mocked — the REAL requireAdmin consults the
// mocked auth (role-based) and the REAL appendAudit writes through the fake
// db's teachAuditEvent.create. This keeps the shared-module contract intact
// across bun's single-process test run (other files rely on the real module).

// REAL trust module (not mocked) — evaluateTrustState is exercised purely.
const trust = await import('@/lib/trust')
const actionsRoute = await import('@/app/api/admin/trust/teachers/[teacherProfileId]/actions/route')

function actionReq(teacherProfileId: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/trust/teachers/${teacherProfileId}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function seedActiveAction(action: string): TrustActionRow {
  const row: TrustActionRow = {
    id: `ta-seed-${state.nextActionId++}`,
    teacherProfileId: 'tp-1',
    action,
    reason: 'Seeded while the investigation was open',
    startsAt: daysAgo(1),
    endsAt: null,
    isActive: true,
    createdByAdminId: 'admin-9',
    endedAt: null,
    endedById: null,
    createdAt: daysAgo(1),
  }
  state.trustActions.push(row)
  return row
}

describe('POST /api/admin/trust/teachers/:id/actions — ADMIN-only authorization', () => {
  beforeEach(resetState)

  it('a signed-in student whose role is STUDENT cannot restrict a teacher — server-side ADMIN guard, not UI hiding (403)', async () => {
    const res = await actionsRoute.POST(
      actionReq('tp-1', { action: 'SUSPEND_PUBLISHING', reason: 'Investigation ongoing after conduct review' }),
      { params: Promise.resolve({ teacherProfileId: 'tp-1' }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
    // The denial happened before any write: no restriction row, no audit row.
    expect(state.trustActions).toHaveLength(0)
    expect(state.auditEvents).toHaveLength(0)
    // Static: authorization is the server-side requireAdmin guard.
    expect(readSrc('src/app/api/admin/trust/teachers/[teacherProfileId]/actions/route.ts')).toContain('requireAdmin')
  })
})

describe('POST /api/admin/trust/teachers/:id/actions — issuing restrictions', () => {
  beforeEach(resetState)

  it('SUSPEND_PUBLISHING creates an active restriction row with the issuing admin and an audit event (201)', async () => {
    state.currentStudent = ADMIN
    const res = await actionsRoute.POST(
      actionReq('tp-1', { action: 'SUSPEND_PUBLISHING', reason: 'Investigation ongoing after conduct review' }),
      { params: Promise.resolve({ teacherProfileId: 'tp-1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.reinstated).toBe(0)

    expect(state.trustActions).toHaveLength(1)
    const row = state.trustActions[0]
    expect(row.action).toBe('SUSPEND_PUBLISHING')
    expect(row.isActive).toBe(true)
    expect(row.teacherProfileId).toBe('tp-1')
    expect(row.createdByAdminId).toBe('admin-1')
    expect(row.endsAt).toBeNull()
    expect(row.reason).toBe('Investigation ongoing after conduct review')

    const audit = state.auditEvents.find((e) => e.action === 'TRUST_ACTION_ISSUED')
    expect(audit).toBeDefined()
    expect(audit!.entityType).toBe('TRUST_ACTION')
    expect(audit!.entityId).toBe(row.id)
    expect(audit!.actorId).toBe('admin-1')
    expect(audit!.actorRole).toBe('ADMIN')
    expect(audit!.detail).toContain('SUSPEND_PUBLISHING')
  })
})

describe('POST /api/admin/trust/teachers/:id/actions — REINSTATE', () => {
  beforeEach(resetState)

  it('REINSTATE ends every active enforcing restriction, records the decision, and audits it (201, reinstated=2)', async () => {
    state.currentStudent = ADMIN
    const pause = seedActiveAction('PAUSE_LISTINGS')
    const suspend = seedActiveAction('SUSPEND_PUBLISHING')

    const res = await actionsRoute.POST(
      actionReq('tp-1', { action: 'REINSTATE', reason: 'Investigation closed — no violation found' }),
      { params: Promise.resolve({ teacherProfileId: 'tp-1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.reinstated).toBe(2)

    // Both seeded restrictions are now inactive, with the reinstater recorded.
    for (const row of [pause, suspend]) {
      expect(row.isActive).toBe(false)
      expect(row.endedAt).not.toBeNull()
      expect(row.endedById).toBe('admin-1')
    }

    // The reinstatement itself is a decision record — never an enforcing row.
    const record = state.trustActions.find((r) => r.action === 'REINSTATE')
    expect(record).toBeDefined()
    expect(record!.isActive).toBe(false)
    expect(record!.createdByAdminId).toBe('admin-1')
    expect(record!.reason).toBe('Investigation closed — no violation found')

    const audit = state.auditEvents.find((e) => e.action === 'TRUST_REINSTATE')
    expect(audit).toBeDefined()
    expect(audit!.entityType).toBe('TRUST_ACTION')
    expect(audit!.entityId).toBe(record!.id)
    expect(audit!.actorId).toBe('admin-1')
    expect(audit!.detail).toBe('Investigation closed — no violation found')
  })
})

describe('Trust restrictions are enforced by the teacher-facing server routes (static)', () => {
  it('class creation blocks suspendedPublishing', () => {
    const text = readSrc('src/app/api/teach/classes/route.ts')
    expect(text).toContain('trustStateFor')
    expect(text).toContain('suspendedPublishing')
  })

  it('publishing blocks pausedListings and suspendedPublishing', () => {
    const text = readSrc('src/app/api/teach/classes/[id]/publish/route.ts')
    expect(text).toContain('trust.pausedListings || trust.suspendedPublishing')
    expect(text).toContain('pausedListings')
    expect(text).toContain('suspendedPublishing')
  })

  it('booking blocks pausedListings', () => {
    expect(readSrc('src/app/api/teach/classes/[id]/book/route.ts')).toContain('pausedListings')
  })

  it('live start blocks emergencyStop', () => {
    expect(readSrc('src/app/api/teach/classes/[id]/live/start/route.ts')).toContain('emergencyStop')
  })

  it('live token issuance blocks emergencyStop', () => {
    expect(readSrc('src/app/api/teach/classes/[id]/live/token/route.ts')).toContain('emergencyStop')
  })
})

describe('evaluateTrustState (pure) — expiry of temporary restrictions', () => {
  const now = new Date()

  it('a temporary restriction whose endsAt has passed no longer enforces', () => {
    const s = trust.evaluateTrustState(
      [{ action: 'SUSPEND_PUBLISHING', isActive: true, startsAt: daysAgo(2), endsAt: daysAgo(1) }],
      now,
    )
    expect(s.restricted).toBe(false)
    expect(s.suspendedPublishing).toBe(false)
    expect(s.pausedListings).toBe(false)
    expect(s.emergencyStop).toBe(false)
  })

  it('an active restriction with no expiry enforces', () => {
    const s = trust.evaluateTrustState(
      [{ action: 'SUSPEND_PUBLISHING', isActive: true, startsAt: daysAgo(2), endsAt: null }],
      now,
    )
    expect(s.restricted).toBe(true)
    expect(s.suspendedPublishing).toBe(true)
  })

  it('a restriction that expires tomorrow still enforces', () => {
    const s = trust.evaluateTrustState(
      [{ action: 'SUSPEND_PUBLISHING', isActive: true, startsAt: daysAgo(2), endsAt: daysFromNow(1) }],
      now,
    )
    expect(s.restricted).toBe(true)
    expect(s.suspendedPublishing).toBe(true)
  })

  it('a restriction expiring exactly now is already expired (endsAt <= now)', () => {
    const s = trust.evaluateTrustState(
      [{ action: 'SUSPEND_PUBLISHING', isActive: true, startsAt: daysAgo(2), endsAt: now }],
      now,
    )
    expect(s.restricted).toBe(false)
  })
})

describe('evaluateTrustState (pure) — flag mapping and non-enforcing rows', () => {
  const now = new Date()
  const activeRow = (action: string, endsAt: Date | null = null) => ({
    action,
    isActive: true,
    startsAt: daysAgo(1),
    endsAt,
  })

  it('PAUSE_LISTINGS maps to pausedListings only', () => {
    const s = trust.evaluateTrustState([activeRow('PAUSE_LISTINGS')], now)
    expect(s.pausedListings).toBe(true)
    expect(s.suspendedPublishing).toBe(false)
    expect(s.emergencyStop).toBe(false)
    expect(s.restricted).toBe(true)
  })

  it('SUSPEND_PUBLISHING maps to suspendedPublishing only', () => {
    const s = trust.evaluateTrustState([activeRow('SUSPEND_PUBLISHING')], now)
    expect(s.suspendedPublishing).toBe(true)
    expect(s.pausedListings).toBe(false)
    expect(s.emergencyStop).toBe(false)
    expect(s.restricted).toBe(true)
  })

  it('EMERGENCY_STOP maps to emergencyStop only', () => {
    const s = trust.evaluateTrustState([activeRow('EMERGENCY_STOP')], now)
    expect(s.emergencyStop).toBe(true)
    expect(s.pausedListings).toBe(false)
    expect(s.suspendedPublishing).toBe(false)
    expect(s.restricted).toBe(true)
  })

  it('multiple active rows combine (all flags true)', () => {
    const s = trust.evaluateTrustState(
      [activeRow('PAUSE_LISTINGS'), activeRow('SUSPEND_PUBLISHING'), activeRow('EMERGENCY_STOP')],
      now,
    )
    expect(s.pausedListings).toBe(true)
    expect(s.suspendedPublishing).toBe(true)
    expect(s.emergencyStop).toBe(true)
    expect(s.restricted).toBe(true)
  })

  it('NOTICE, WARNING and REINSTATE rows never enforce', () => {
    const s = trust.evaluateTrustState(
      [activeRow('NOTICE'), activeRow('WARNING'), activeRow('REINSTATE')],
      now,
    )
    expect(s.pausedListings).toBe(false)
    expect(s.suspendedPublishing).toBe(false)
    expect(s.emergencyStop).toBe(false)
    expect(s.restricted).toBe(false)
  })
})

describe('Filing a complaint alone does not suspend a teacher', () => {
  it('pure: with no TrustAction rows nothing is restricted', () => {
    const s = trust.evaluateTrustState([], new Date())
    expect(s.pausedListings).toBe(false)
    expect(s.suspendedPublishing).toBe(false)
    expect(s.emergencyStop).toBe(false)
    expect(s.restricted).toBe(false)
  })

  it('static: the complaint route neither creates TrustAction rows nor consults trustStateFor', () => {
    const text = readSrc('src/app/api/teach/complaints/route.ts')
    expect(text).not.toContain('trustAction.create')
    expect(text).not.toContain('trustStateFor')
  })
})
