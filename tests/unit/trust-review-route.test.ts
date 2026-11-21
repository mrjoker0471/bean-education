// ─── BEAN Trust & Quality (Phase 6): verified review route tests ─────────────
// Coverage (spec §15 — Reviews):
//   • POST /api/teach/classes/:id/reviews — guests 401; only ATTENDED bookings
//     after class end may review; one review per booking (in-transaction check
//     plus the bookingId unique index as the lost-race backstop — the fake
//     create throws a REAL PrismaClientKnownRequestError P2002 so the route's
//     instanceof check fires); rating/text bounds; teacher attribution always
//     comes from the class row, never the client; REVIEW_CREATED audit.
//   • GET /api/teach/classes/:id/reviews — public DTO is privacy-mapped
//     ("Verified student", consent-gated displayName, no emails/account ids)
//     and the author alone sees their HIDDEN review with its moderation reason.
//   • PATCH /api/teach/reviews/:reviewId — author-only, 7-day window, HIDDEN
//     reviews locked, REVIEW_EDITED audit appended.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

interface FakeClass {
  id: string
  teacherProfileId: string
  status: string
  startsAt: Date
  durationMinutes: number
}

interface FakeBooking {
  id: string
  classSessionId: string
  studentId: string
  status: string
  bookedAt: Date
  cancelledAt: Date | null
  attendanceMarkedAt: Date | null
}

interface FakeReview {
  id: string
  bookingId: string
  classSessionId: string
  teacherProfileId: string
  studentId: string
  rating: number
  title: string | null
  reviewText: string
  status: string
  isVerified: boolean
  showDisplayName: boolean
  editedAt: Date | null
  publishedAt: Date | null
  moderatedAt: Date | null
  moderationReason: string | null
  createdAt: Date
  updatedAt: Date
  response: null
  student: { displayName: string | null }
}

const DAY = 24 * 3600_000

/** The slice of the Prisma transaction client the review routes actually touch. */
interface ReviewTx {
  classSession: { findUnique(args: { where: { id: string } }): Promise<unknown> }
  classBooking: {
    findUnique(args: {
      where: { id?: string; classSessionId_studentId?: { classSessionId: string; studentId: string } }
    }): Promise<unknown>
  }
  classReview: {
    findUnique(args: { where: { id?: string; bookingId?: string }; select?: unknown; include?: unknown }): Promise<unknown>
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
  }
  teachAuditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
}

const state = {
  student: null as Record<string, unknown> | null,
  classes: new Map<string, FakeClass>(),
  bookings: [] as FakeBooking[],
  reviews: [] as FakeReview[],
  auditEvents: [] as { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail: string | null }[],
  nextReviewId: 1,
  // Simulates a lost concurrency race: the in-transaction bookingId lookup
  // misses even though the winner's row is already committed.
  simulateLookupMiss: false,
}

function resetState() {
  state.student = null
  state.classes = new Map()
  state.bookings = []
  state.reviews = []
  state.auditEvents = []
  state.nextReviewId = 1
  state.simulateLookupMiss = false
  state.classes.set('c1', {
    id: 'c1',
    teacherProfileId: 'tp-1',
    status: 'PUBLISHED',
    startsAt: new Date(Date.now() - 2 * DAY), // ended ~2 days ago (+60 min)
    durationMinutes: 60,
  })
  state.bookings.push({
    id: 'bk-1',
    classSessionId: 'c1',
    studentId: 'student-1',
    status: 'ATTENDED',
    bookedAt: new Date(Date.now() - 3 * DAY),
    cancelledAt: null,
    attendanceMarkedAt: new Date(Date.now() - 1.9 * DAY),
  })
}

function displayNameFor(studentId: string): string | null {
  const map: Record<string, string | null> = {
    'student-1': 'Student One',
    'student-2': 'Student Two',
    'student-3': null,
  }
  return studentId in map ? map[studentId] : null
}

const fakeDb = {
  classSession: {
    // Routes call this twice with different selects — return a superset row.
    findUnique: async ({ where }: { where: { id: string } }) => state.classes.get(where.id) ?? null,
  },
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string } }) => {
      if (!where?.studentId) return null
      if (where.studentId === 'teacher-1') {
        return { id: 'tp-1', studentId: 'teacher-1', teachingName: 'Prof One', verificationStatus: 'APPROVED' }
      }
      return null
    },
  },
  classBooking: {
    findUnique: async ({ where }: { where: { id?: string; classSessionId_studentId?: { classSessionId: string; studentId: string } } }) => {
      const k = where.classSessionId_studentId
      const row = k
        ? state.bookings.find(b => b.classSessionId === k.classSessionId && b.studentId === k.studentId)
        : where.id
          ? state.bookings.find(b => b.id === where.id)
          : undefined
      return row ?? null
    },
  },
  classReview: {
    findUnique: async ({ where }: { where: { id?: string; bookingId?: string } }) => {
      let row: FakeReview | undefined
      if (where.id) {
        row = state.reviews.find(r => r.id === where.id)
      } else if (where.bookingId) {
        if (state.simulateLookupMiss) return null
        row = state.reviews.find(r => r.bookingId === where.bookingId)
      }
      return row ? { ...row } : null
    },
    findMany: async (args: {
      where?: {
        classSessionId?: string
        studentId?: string
        teacherProfileId?: string
        status?: string | { in: string[] }
        OR?: Array<Record<string, unknown>>
      }
      orderBy?: unknown
      take?: number
    }) => {
      const where = args.where ?? {}
      let rows = state.reviews.filter(
        r =>
          (!where.classSessionId || r.classSessionId === where.classSessionId) &&
          (!where.studentId || r.studentId === where.studentId) &&
          (!where.teacherProfileId || r.teacherProfileId === where.teacherProfileId),
      )
      if (where.OR) {
        // Public list: (status in [PUBLISHED, FLAGGED]) OR studentId = viewer.
        const statusCond = where.OR.find(c => 'status' in c) as { status: { in: string[] } } | undefined
        const studentCond = where.OR.find(c => 'studentId' in c) as { studentId: string } | undefined
        rows = rows.filter(
          r =>
            (!!statusCond && statusCond.status.in.includes(r.status)) ||
            (!!studentCond && r.studentId === studentCond.studentId),
        )
      } else if (where.status) {
        const statusIn = typeof where.status === 'string' ? [where.status] : where.status.in
        rows = rows.filter(r => statusIn.includes(r.status))
      }
      rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      if (args.take !== undefined) rows = rows.slice(0, args.take)
      return rows.map(r => ({ ...r }))
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const bookingId = String(data.bookingId)
      // Mirror the DB-level unique index on bookingId: a concurrent duplicate
      // create must fail with a REAL Prisma error so the route's
      // `err instanceof Prisma.PrismaClientKnownRequestError` check matches.
      if (state.reviews.some(r => r.bookingId === bookingId)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`bookingId`)', {
          code: 'P2002',
          clientVersion: 'test',
        })
      }
      const now = new Date()
      const studentId = String(data.studentId)
      const row: FakeReview = {
        id: `rev-${state.nextReviewId++}`,
        bookingId,
        classSessionId: String(data.classSessionId),
        teacherProfileId: String(data.teacherProfileId),
        studentId,
        rating: Number(data.rating),
        title: (data.title as string | null) ?? null,
        reviewText: String(data.reviewText),
        status: String(data.status ?? 'PUBLISHED'),
        isVerified: Boolean(data.isVerified ?? true),
        showDisplayName: Boolean(data.showDisplayName ?? false),
        editedAt: null,
        publishedAt: (data.publishedAt as Date | null) ?? null,
        moderatedAt: null,
        moderationReason: null,
        createdAt: now,
        updatedAt: now,
        response: null,
        student: { displayName: displayNameFor(studentId) },
      }
      state.reviews.push(row)
      return { ...row }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.reviews.find(r => r.id === where.id)
      if (!row) throw new Error('review not found')
      Object.assign(row, data)
      row.updatedAt = new Date()
      return { ...row }
    },
    count: async ({ where }: { where?: { studentId?: string; createdAt?: { gt: Date } } }) => {
      const w = where ?? {}
      return state.reviews.filter(
        r =>
          (!w.studentId || r.studentId === w.studentId) &&
          (!w.createdAt?.gt || r.createdAt.getTime() > w.createdAt.gt.getTime()),
      ).length
    },
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.auditEvents.push({
        entityType: String(data.entityType),
        entityId: String(data.entityId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null) ?? null,
      })
      return {}
    },
  },
  $transaction: async (fn: (tx: ReviewTx) => Promise<unknown>) => fn(fakeDb as unknown as ReviewTx),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const reviewsRoute = await import('@/app/api/teach/classes/[id]/reviews/route')
const reviewEditRoute = await import('@/app/api/teach/reviews/[reviewId]/route')

const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT2 = { id: 'student-2', email: 's2@bean.example', displayName: 'Student Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT3 = { id: 'student-3', email: 's3@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }

const OK_TEXT = 'Excellent class — clear explanations and patient teaching throughout.'

function reviewsReq(classId: string, method: string, body?: unknown): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/reviews`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }) as unknown as NextRequest
}

function editReq(reviewId: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/teach/reviews/${reviewId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function seedReview(overrides: Partial<FakeReview> = {}): FakeReview {
  const now = new Date()
  const studentId = overrides.studentId ?? 'student-1'
  const row: FakeReview = {
    id: `rev-${state.nextReviewId++}`,
    bookingId: `bk-seed-${state.nextReviewId}`,
    classSessionId: 'c1',
    teacherProfileId: 'tp-1',
    studentId,
    rating: 4,
    title: null,
    reviewText: 'Seeded review text that is comfortably longer than the twenty character minimum.',
    status: 'PUBLISHED',
    isVerified: true,
    showDisplayName: false,
    editedAt: null,
    publishedAt: now,
    moderatedAt: null,
    moderationReason: null,
    createdAt: now,
    updatedAt: now,
    response: null,
    student: { displayName: displayNameFor(studentId) },
  }
  Object.assign(row, overrides)
  state.reviews.push(row)
  return row
}

describe('POST /api/teach/classes/:id/reviews — booking-verified creation', () => {
  beforeEach(resetState)

  it('a guest cannot review (401)', async () => {
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(401)
    expect(state.reviews).toHaveLength(0)
  })

  it('a student without a booking in the class cannot review (403)', async () => {
    state.student = STUDENT2
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Only students who attended this class can review it.')
    expect(state.reviews).toHaveLength(0)
  })

  it('a CANCELLED booking cannot be reviewed (403)', async () => {
    state.student = STUDENT
    state.bookings[0].status = 'CANCELLED'
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Cancelled reservations cannot be reviewed.')
    expect(state.reviews).toHaveLength(0)
  })

  it('a NO_SHOW booking cannot be reviewed (403)', async () => {
    state.student = STUDENT
    state.bookings[0].status = 'NO_SHOW'
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Classes you did not attend cannot be reviewed.')
    expect(state.reviews).toHaveLength(0)
  })

  it('a CONFIRMED booking (attendance not yet confirmed) cannot be reviewed (403)', async () => {
    state.student = STUDENT
    state.bookings[0].status = 'CONFIRMED'
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Reviews open once the teacher confirms your attendance.')
    expect(state.reviews).toHaveLength(0)
  })

  it('an ATTENDED student cannot review before the class has ended (403)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() + 30 * 60_000) })
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Reviews open after the class has ended.')
    expect(state.reviews).toHaveLength(0)
  })

  it('a student with an ATTENDED booking for a DIFFERENT class cannot review c1 (403)', async () => {
    state.classes.set('c2', {
      id: 'c2',
      teacherProfileId: 'tp-2',
      status: 'PUBLISHED',
      startsAt: new Date(Date.now() - 2 * DAY),
      durationMinutes: 60,
    })
    state.bookings.push({
      id: 'bk-2',
      classSessionId: 'c2',
      studentId: 'student-2',
      status: 'ATTENDED',
      bookedAt: new Date(Date.now() - 3 * DAY),
      cancelledAt: null,
      attendanceMarkedAt: new Date(Date.now() - 1.9 * DAY),
    })
    state.student = STUDENT2
    // The booking lookup for (c1, student-2) returns null — their c2 booking
    // does not carry over to another class.
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(403)
    expect(state.reviews).toHaveLength(0)
  })

  it('an ATTENDED student CAN review after the class ended (201) — server-derived fields only, REVIEW_CREATED audited', async () => {
    state.student = STUDENT
    const res = await reviewsRoute.POST(
      reviewsReq('c1', 'POST', {
        rating: 5,
        reviewText: OK_TEXT,
        // Client-supplied attribution attempts are stripped by the schema and
        // replaced by values derived from the class row / session identity:
        teacherProfileId: 'FAKE-CLIENT-VALUE',
        bookingId: 'FAKE-CLIENT-VALUE',
        studentId: 'FAKE-CLIENT-VALUE',
        status: 'HIDDEN',
        isVerified: false,
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.review.rating).toBe(5)
    expect(body.review.reviewer.label).toBe('Verified student')
    expect(body.review.reviewer.displayName).toBeNull() // no display-name consent given
    expect(body.review.response).toBeNull()

    const row = state.reviews[0]
    expect(row.bookingId).toBe('bk-1') // from the caller's OWN booking
    expect(row.classSessionId).toBe('c1')
    expect(row.teacherProfileId).toBe('tp-1') // from the CLASS row — never the client
    expect(row.studentId).toBe('student-1') // from the session
    expect(row.status).toBe('PUBLISHED') // client-supplied 'HIDDEN' ignored
    expect(row.isVerified).toBe(true) // client-supplied false ignored
    expect(row.publishedAt).not.toBeNull()

    expect(
      state.auditEvents.some(
        e =>
          e.action === 'REVIEW_CREATED' &&
          e.entityType === 'CLASS_REVIEW' &&
          e.entityId === row.id &&
          e.actorId === 'student-1' &&
          e.actorRole === 'STUDENT' &&
          e.detail === 'rating=5',
      ),
    ).toBe(true)
  })

  it('a second review for the same booking is refused by the in-transaction check (409)', async () => {
    state.student = STUDENT
    const first = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(first.status).toBe(201)
    const second = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 4, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(second.status).toBe(409)
    expect((await second.json()).error).toBe('You have already reviewed this class.')
    expect(state.reviews).toHaveLength(1)
  })

  it('a duplicate that races past the eligibility check is still rejected by the bookingId unique index (409)', async () => {
    state.student = STUDENT
    const first = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 5, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(first.status).toBe(201)
    // The losing transaction's bookingId lookup misses the winner's row...
    state.simulateLookupMiss = true
    const raced = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 3, reviewText: OK_TEXT }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    state.simulateLookupMiss = false
    // ...but the DB unique index fires as the last line of defence.
    expect(raced.status).toBe(409)
    expect((await raced.json()).error).toBe('You have already reviewed this class.')
    expect(state.reviews).toHaveLength(1)
  })

  it('ratings outside 1–5 are rejected by validation (400)', async () => {
    state.student = STUDENT
    for (const rating of [0, 6]) {
      const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating, reviewText: OK_TEXT }), {
        params: Promise.resolve({ id: 'c1' }),
      })
      expect(res.status).toBe(400)
    }
    expect(state.reviews).toHaveLength(0)
  })

  it('review text shorter than 20 characters is rejected (400)', async () => {
    state.student = STUDENT
    const res = await reviewsRoute.POST(reviewsReq('c1', 'POST', { rating: 4, reviewText: 'Too short' }), {
      params: Promise.resolve({ id: 'c1' }),
    })
    expect(res.status).toBe(400)
    expect(state.reviews).toHaveLength(0)
  })
})

describe('GET /api/teach/classes/:id/reviews — public, privacy-mapped list', () => {
  beforeEach(resetState)

  it('the public list never leaks private student information and honours display-name consent', async () => {
    state.student = null
    const r1 = seedReview({ studentId: 'student-1', showDisplayName: true, createdAt: new Date(Date.now() - 3 * DAY) })
    const r2 = seedReview({ studentId: 'student-2', showDisplayName: false, createdAt: new Date(Date.now() - 1 * DAY) })
    const r3 = seedReview({ studentId: 'student-3', showDisplayName: true, createdAt: new Date(Date.now() - 4 * DAY) })

    const res = await reviewsRoute.GET(reviewsReq('c1', 'GET'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviews).toHaveLength(3)

    for (const r of body.reviews) {
      expect(r.reviewer.label).toBe('Verified student')
      expect('ownStatus' in r).toBe(false) // author-only block stays locked
      expect('ownModerationReason' in r).toBe(false)
    }
    // displayName appears ONLY with consent AND a displayName to show:
    const byId = (id: string) => body.reviews.find((r: { id: string }) => r.id === id)
    expect(byId(r1.id).reviewer.displayName).toBe('Student One') // consented + has name
    expect(byId(r2.id).reviewer.displayName).toBeNull() // no consent
    expect(byId(r3.id).reviewer.displayName).toBeNull() // consented but displayName is null

    // No email address or account identifier anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('@')
    expect(JSON.stringify(body)).not.toContain('student-1')
    expect(JSON.stringify(body)).not.toContain('s1@bean.example')
  })

  it('the author alone sees their own HIDDEN review with its moderation status and reason', async () => {
    const hidden = seedReview({
      studentId: 'student-2',
      status: 'HIDDEN',
      moderationReason: 'Hidden during moderation review',
      showDisplayName: true,
      createdAt: new Date(Date.now() - 2 * DAY),
    })
    state.student = STUDENT2
    const res = await reviewsRoute.GET(reviewsReq('c1', 'GET'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    const dto = body.reviews.find((r: { id: string }) => r.id === hidden.id)
    expect(dto).toBeDefined()
    expect(dto.ownStatus).toBe('HIDDEN')
    expect(dto.ownModerationReason).toBe('Hidden during moderation review')
    expect(dto.canEdit).toBe(false)
    expect(JSON.stringify(body)).not.toContain('@')
  })

  it('a non-author viewer never sees a hidden review', async () => {
    const hidden = seedReview({
      studentId: 'student-2',
      status: 'HIDDEN',
      moderationReason: 'Hidden during moderation review',
      createdAt: new Date(Date.now() - 2 * DAY),
    })
    state.student = STUDENT
    const res = await reviewsRoute.GET(reviewsReq('c1', 'GET'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviews.some((r: { id: string }) => r.id === hidden.id)).toBe(false)
    expect(JSON.stringify(body)).not.toContain('Hidden during moderation review')
  })
})

describe('PATCH /api/teach/reviews/:reviewId — author self-edit within 7 days', () => {
  beforeEach(resetState)

  it('editing after the 7-day window is refused (409)', async () => {
    state.student = STUDENT
    const rev = seedReview({ studentId: 'student-1', createdAt: new Date(Date.now() - 8 * DAY) })
    const res = await reviewEditRoute.PATCH(
      editReq(rev.id, { rating: 2, reviewText: 'Updated after reflection — the second half was excellent.' }),
      { params: Promise.resolve({ reviewId: rev.id }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Reviews can be edited for 7 days after posting.')
    expect(state.reviews.find(r => r.id === rev.id)!.rating).toBe(4) // untouched
    expect(state.auditEvents.some(e => e.action === 'REVIEW_EDITED')).toBe(false)
  })

  it('the author can edit within the window (200) — editedAt set and REVIEW_EDITED audited', async () => {
    state.student = STUDENT
    const rev = seedReview({ studentId: 'student-1', createdAt: new Date(Date.now() - 2 * DAY) })
    const res = await reviewEditRoute.PATCH(
      editReq(rev.id, { rating: 2, reviewText: 'Updated after reflection — the second half was excellent.' }),
      { params: Promise.resolve({ reviewId: rev.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.review.rating).toBe(2)
    expect(body.review.editedAt).not.toBeNull()
    expect(body.review.canEdit).toBe(true)
    expect(body.review.reviewer.label).toBe('Verified student')
    const row = state.reviews.find(r => r.id === rev.id)!
    expect(row.rating).toBe(2)
    expect(row.editedAt).not.toBeNull()
    // Moderation state is never touched by an edit:
    expect(row.status).toBe('PUBLISHED')
    expect(
      state.auditEvents.some(
        e =>
          e.action === 'REVIEW_EDITED' &&
          e.entityType === 'CLASS_REVIEW' &&
          e.entityId === rev.id &&
          e.actorId === 'student-1',
      ),
    ).toBe(true)
  })

  it('editing another student\u2019s review is forbidden (403)', async () => {
    state.student = STUDENT
    const other = seedReview({ studentId: 'student-2', createdAt: new Date(Date.now() - 1 * DAY) })
    const res = await reviewEditRoute.PATCH(editReq(other.id, { rating: 1 }), {
      params: Promise.resolve({ reviewId: other.id }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You can only edit your own review.')
    expect(state.reviews.find(r => r.id === other.id)!.rating).toBe(4)
  })

  it('a HIDDEN review cannot be edited (409)', async () => {
    state.student = STUDENT2
    const rev = seedReview({
      studentId: 'student-2',
      status: 'HIDDEN',
      moderationReason: 'Under investigation',
      createdAt: new Date(Date.now() - 1 * DAY),
    })
    const res = await reviewEditRoute.PATCH(editReq(rev.id, { rating: 5 }), {
      params: Promise.resolve({ reviewId: rev.id }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('This review is under moderation and cannot be edited.')
    expect(state.reviews.find(r => r.id === rev.id)!.rating).toBe(4)
    expect(state.auditEvents.some(e => e.action === 'REVIEW_EDITED')).toBe(false)
  })
})
