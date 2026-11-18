// ─── BEAN Teach (Phase 4A): class creation / listing / edit route tests ──────
// Covers teacher permissions, class rule validation, public visibility and
// ownership guards (established mock.module pattern).

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

interface FakeClass {
  id: string
  teacherProfileId: string
  title: string
  description: string
  subject: string
  targetLevel: string
  language: string
  durationMinutes: number
  startsAt: Date
  timeZone: string
  capacity: number
  minimumStudents: number
  bookedCount: number
  plannedPricePaise: number
  status: string
  publishedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface FakeProfile {
  id: string
  studentId: string
  teachingName: string
  headline: string
  verificationStatus: string
  isPublished: boolean
}

const state = {
  student: null as Record<string, unknown> | null,
  profiles: new Map<string, FakeProfile>(),
  classes: new Map<string, FakeClass>(),
}

function resetState() {
  state.student = null
  state.profiles = new Map()
  state.classes = new Map()
  // Teacher 'me' (approved) and 'other' (approved, different owner).
  state.profiles.set('tp-me', { id: 'tp-me', studentId: 'me', teachingName: 'Prof Me', headline: 'Mathematics teacher', verificationStatus: 'APPROVED', isPublished: true })
  state.profiles.set('tp-other', { id: 'tp-other', studentId: 'other', teachingName: 'Prof Other', headline: 'Science teacher', verificationStatus: 'APPROVED', isPublished: true })
}

function seedClass(overrides: Partial<FakeClass> = {}): FakeClass {
  const row: FakeClass = {
    id: `cls-${state.classes.size + 1}`,
    teacherProfileId: 'tp-me',
    title: 'Fractions made friendly',
    description: 'A gentle hands-on introduction to fractions with visual models and practice problems for beginners.',
    subject: 'Mathematics',
    targetLevel: 'SCHOOL_6_8',
    language: 'English',
    durationMinutes: 60,
    startsAt: new Date(Date.now() + 7 * 24 * 3600_000),
    timeZone: 'Asia/Kolkata',
    capacity: 10,
    minimumStudents: 1,
    bookedCount: 0,
    plannedPricePaise: 0,
    status: 'DRAFT',
    publishedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
  state.classes.set(row.id, row)
  return row
}

const fakeDb = {
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string; id?: string } }) => {
      if (where.studentId) return [...state.profiles.values()].find(p => p.studentId === where.studentId) ?? null
      return state.profiles.get(where.id ?? '') ?? null
    },
  },
  classSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.classes.get(where.id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => seedClass(data as Partial<FakeClass>),
    count: async ({ where }: { where: { teacherProfileId?: string; status?: { in?: string[] } } }) => {
      let rows = [...state.classes.values()]
      if (where.teacherProfileId) rows = rows.filter(c => c.teacherProfileId === where.teacherProfileId)
      if (where.status?.in) rows = rows.filter(c => where.status!.in!.includes(c.status))
      return rows.length
    },
    findMany: async ({ where }: { where: { status?: string; teacherProfile?: { verificationStatus?: string; isPublished?: boolean } } }) => {
      let rows = [...state.classes.values()]
      if (where.status) rows = rows.filter(c => c.status === where.status)
      if (where.teacherProfile?.verificationStatus) {
        rows = rows.filter(c => state.profiles.get(c.teacherProfileId)?.verificationStatus === where.teacherProfile!.verificationStatus)
      }
      if (where.teacherProfile?.isPublished !== undefined) {
        rows = rows.filter(c => state.profiles.get(c.teacherProfileId)?.isPublished === where.teacherProfile!.isPublished)
      }
      // Mirror the route's include: teacherProfile { id, teachingName, headline }.
      return rows.map(c => ({
        ...c,
        teacherProfile: (() => {
          const p = state.profiles.get(c.teacherProfileId)
          return p ? { id: p.id, teachingName: p.teachingName, headline: p.headline } : { id: c.teacherProfileId, teachingName: 'Unknown', headline: '' }
        })(),
      }))
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.classes.get(where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data)
      return row
    },
  },
  classBooking: {
    count: async ({ where }: { where: { classSessionId: string; status?: { not?: string } } }) => {
      // The booking tests own actual bookings; this fake counts nothing unless the
      // booking test file seeds them. Held seats default to 0 here.
      void where
      return 0
    },
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const classesRoute = await import('@/app/api/teach/classes/route')
const classIdRoute = await import('@/app/api/teach/classes/[id]/route')

const ME = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const OTHER_STUDENT = { id: 'nobody', email: 'other@bean.example', displayName: 'Other', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function req(url: string, method: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const VALID_CLASS = {
  title: 'Quadratic equations problem sprint',
  description: 'Solve twenty progressively harder quadratic problems with guided strategy discussion and worked examples.',
  subject: 'Mathematics',
  targetLevel: 'SCHOOL_9_10',
  language: 'English',
  durationMinutes: 90,
  startsAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
  timeZone: 'Asia/Kolkata',
  capacity: 20,
  minimumStudents: 2,
  plannedPricePaise: 0,
}

describe('POST /api/teach/classes — teacher permissions and class rules', () => {
  beforeEach(resetState)

  it('a guest cannot create a class (401)', async () => {
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', VALID_CLASS))
    expect(res.status).toBe(401)
  })

  it('a pending applicant cannot create a class (403)', async () => {
    state.student = ME
    state.profiles.set('tp-me', { ...state.profiles.get('tp-me')!, verificationStatus: 'PENDING' })
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', VALID_CLASS))
    expect(res.status).toBe(403)
  })

  it('a rejected applicant cannot create a class (403)', async () => {
    state.student = ME
    state.profiles.set('tp-me', { ...state.profiles.get('tp-me')!, verificationStatus: 'REJECTED' })
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', VALID_CLASS))
    expect(res.status).toBe(403)
  })

  it('a student with no teacher profile cannot create a class (403)', async () => {
    state.student = OTHER_STUDENT
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', VALID_CLASS))
    expect(res.status).toBe(403)
  })

  it('an approved teacher can create a DRAFT class (201)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', VALID_CLASS))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.class.status).toBe('DRAFT')
  })

  it('an invalid duration (45 minutes, not a 30-minute step) is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, durationMinutes: 45 }))
    expect(res.status).toBe(400)
  })

  it('a duration above 360 minutes is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, durationMinutes: 390 }))
    expect(res.status).toBe(400)
  })

  it('an invalid capacity (0) is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, capacity: 0 }))
    expect(res.status).toBe(400)
  })

  it('capacity above 50 is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, capacity: 51 }))
    expect(res.status).toBe(400)
  })

  it('minimum enrolment above capacity is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, capacity: 5, minimumStudents: 6 }))
    expect(res.status).toBe(400)
  })

  it('a past schedule is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, startsAt: new Date(Date.now() - 3600_000).toISOString() }))
    expect(res.status).toBe(400)
  })

  it('an unknown time zone is rejected (400)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, timeZone: 'Mars/Olympus_Mons' }))
    expect(res.status).toBe(400)
  })

  it('the planned price is stored as metadata only (never charged — field is informational)', async () => {
    state.student = ME
    const res = await classesRoute.POST(req('http://localhost/api/teach/classes', 'POST', { ...VALID_CLASS, plannedPricePaise: 49900 }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.class.plannedPricePaise).toBe(49900)
    expect(body.class.status).toBe('DRAFT')
  })
})

describe('GET /api/teach/classes — public discovery', () => {
  beforeEach(resetState)

  it('only PUBLISHED classes of APPROVED teachers are listed', async () => {
    seedClass({ id: 'pub', status: 'PUBLISHED' })
    seedClass({ id: 'draft', status: 'DRAFT' })
    seedClass({ id: 'cancelled', status: 'CANCELLED' })
    const res = await classesRoute.GET(req('http://localhost/api/teach/classes', 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.classes.map((c: { id: string }) => c.id)
    expect(ids).toContain('pub')
    expect(ids).not.toContain('draft')
    expect(ids).not.toContain('cancelled')
  })

  it('the public listing query hard-codes APPROVED + published teacher visibility', async () => {
    // Even if the fake findMany were permissive, the WHERE clause itself must
    // demand PUBLISHED + APPROVED + isPublished — this is the security check.
    let captured: Record<string, unknown> | null = null
    const original = fakeDb.classSession.findMany
    fakeDb.classSession.findMany = async (args: { where: Record<string, unknown> }) => {
      captured = args.where
      return []
    }
    await classesRoute.GET(req('http://localhost/api/teach/classes', 'GET'))
    fakeDb.classSession.findMany = original
    const where = captured as { status?: string; teacherProfile?: { verificationStatus?: string; isPublished?: boolean }; startsAt?: { gt?: Date } }
    expect(where.status).toBe('PUBLISHED')
    expect(where.teacherProfile?.verificationStatus).toBe('APPROVED')
    expect(where.teacherProfile?.isPublished).toBe(true)
    expect(where.startsAt?.gt).toBeInstanceOf(Date)
  })
})

describe('PATCH /api/teach/classes/:id — ownership and edit guards', () => {
  beforeEach(resetState)

  it('a teacher cannot modify another teacher\u2019s class (404)', async () => {
    state.student = ME
    seedClass({ id: 'foreign', teacherProfileId: 'tp-other', status: 'PUBLISHED' })
    const res = await classIdRoute.PATCH(req('http://localhost/api/teach/classes/foreign', 'PATCH', { title: 'Hijacked title here' }), { params: Promise.resolve({ id: 'foreign' }) })
    expect(res.status).toBe(404)
  })

  it('a completed class cannot be edited (409)', async () => {
    state.student = ME
    seedClass({ id: 'done', status: 'COMPLETED' })
    const res = await classIdRoute.PATCH(req('http://localhost/api/teach/classes/done', 'PATCH', { title: 'Edited title' }), { params: Promise.resolve({ id: 'done' }) })
    expect(res.status).toBe(409)
  })

  it('a cancelled class cannot be edited (409)', async () => {
    state.student = ME
    seedClass({ id: 'gone', status: 'CANCELLED' })
    const res = await classIdRoute.PATCH(req('http://localhost/api/teach/classes/gone', 'PATCH', { title: 'Edited title' }), { params: Promise.resolve({ id: 'gone' }) })
    expect(res.status).toBe(409)
  })

  it('capacity cannot be reduced below held seats (409)', async () => {
    state.student = ME
    seedClass({ id: 'held', status: 'PUBLISHED', capacity: 10, bookedCount: 3 })
    // Simulate held seats for the guard query.
    fakeDb.classBooking.count = async () => 3
    const res = await classIdRoute.PATCH(req('http://localhost/api/teach/classes/held', 'PATCH', { capacity: 2 }), { params: Promise.resolve({ id: 'held' }) })
    expect(res.status).toBe(409)
    fakeDb.classBooking.count = async () => 0
  })

  it('an owner can edit their own draft (200)', async () => {
    state.student = ME
    seedClass({ id: 'mine', status: 'DRAFT' })
    const res = await classIdRoute.PATCH(req('http://localhost/api/teach/classes/mine', 'PATCH', { title: 'Renamed draft class' }), { params: Promise.resolve({ id: 'mine' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.class.title).toBe('Renamed draft class')
  })
})
