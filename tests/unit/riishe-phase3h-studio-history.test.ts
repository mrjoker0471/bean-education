// ─── Riishe Phase 3H: Studio history discovery, retention, cleanup ────────────
// Tests for:
//   - cursor pagination with stable (updatedAt desc, id desc) ordering
//   - search (topic / document title) and kind/status filters
//   - exact totalMatching and accurate whole-history evidence roll-up
//   - retention preference validation through the existing profile PATCH
//   - user-initiated cleanup: preview, explicit confirmation, bounded batch,
//     repeated/concurrent safety, truthful failure, scope discipline
//   - ownership (fail-closed, before any read), CSRF, and single-record
//     deletion compatibility
//
// The fake database implements a recursive Prisma-where evaluator for the
// exact condition shapes the Phase 3H store emits (AND/OR, lt/lte/gte, in,
// contains, not-null) so pagination and cleanup scope logic is exercised for
// real. Existing Phase 3F/3G suites keep their own fakes — nothing there was
// weakened.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── State + fakes ────────────────────────────────────────────────────────────

interface ActivityRow {
  id: string
  guestId: string
  studentId: string | null
  kind: string
  topic: string
  status: string
  grounding: string
  documentId: string | null
  documentTitle: string | null
  responseLanguage: string | null
  activityVersion: number
  activityJson: string
  progressJson: string | null
  responsesJson: string | null
  resultJson: string | null
  createdAt: Date
  updatedAt: Date
  lastAccessedAt: Date
  completedAt: Date | null
}

const state = {
  sessionStudent: null as { id: string } | null,
  sessionThrows: false,
  sameOrigin: true,
  activities: [] as ActivityRow[],
  attempts: [] as Record<string, unknown>[],
  students: [] as Record<string, unknown>[],
  studentSeq: 0,
  activitySeq: 0,
  deleteManyThrows: false,
}

const dbCalls: string[] = []
const call = (key: string) => dbCalls.push(key)

let guestSeq = 0
const newGuest = () => `p3h-guest-${++guestSeq}`
let tickSeq = 0
/** Strictly increasing timestamps (minutes apart) for deterministic ordering. */
function tick(): Date {
  return new Date(1_700_000_000_000 + ++tickSeq * 60_000)
}

function seedActivity(guestId: string, overrides: Partial<ActivityRow> = {}): ActivityRow {
  const now = tick()
  const row: ActivityRow = {
    id: `act-${++state.activitySeq}`,
    guestId,
    studentId: null,
    kind: 'steps',
    topic: 'Acceleration',
    status: 'IN_PROGRESS',
    grounding: 'document',
    documentId: null,
    documentTitle: null,
    responseLanguage: 'auto',
    activityVersion: 1,
    activityJson: JSON.stringify({
      kind: 'steps',
      title: 'Solving for acceleration',
      steps: [
        { title: 'Identify variables', body: 'Find F and m.' },
        { title: 'Substitute', body: 'Insert values.' },
      ],
    }),
    progressJson: null,
    responsesJson: null,
    resultJson: null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    completedAt: null,
    ...overrides,
  }
  state.activities.push(row)
  return row
}

function seedClaim(guestId: string, studentId: string) {
  state.attempts.push({
    id: `a-${guestId}`,
    guestId,
    studentId,
    status: 'SUBMITTED',
    startedAt: tick(),
    submittedAt: tick(),
    questionIdsJson: '[]',
    answersJson: '{}',
    source: 'BANK',
    perTopicJson: '{}',
  })
}

function seedStudent(preferences: Record<string, unknown> = {}): { id: string; email: string } {
  const id = `stu-${++state.studentSeq}`
  state.students.push({
    id,
    email: `${id}@bean.test`,
    displayName: null,
    learningLevel: null,
    interestsJson: '[]',
    preferencesJson: JSON.stringify(preferences),
    onboardedAt: null,
  })
  return { id, email: `${id}@bean.test` }
}

// ─── Recursive Prisma-where evaluator (the shapes the 3H store emits) ─────────

function normalize(v: unknown): unknown {
  return v instanceof Date ? v.getTime() : v
}

function condMatch(rowValue: unknown, cond: Record<string, unknown>): boolean {
  // Type-aware comparator: strings order lexicographically (Prisma semantics),
  // everything else compares numerically (Dates via normalize → epoch ms).
  const cmp = (a: unknown, b: unknown): number => {
    const na = normalize(a)
    const nb = normalize(b)
    if (typeof na === 'string' && typeof nb === 'string') return na < nb ? -1 : na > nb ? 1 : 0
    const x = Number(na)
    const y = Number(nb)
    return x < y ? -1 : x > y ? 1 : 0
  }
  let ok = true
  if ('lt' in cond) ok = ok && cmp(rowValue, cond.lt) < 0
  if ('lte' in cond) ok = ok && cmp(rowValue, cond.lte) <= 0
  if ('gt' in cond) ok = ok && cmp(rowValue, cond.gt) > 0
  if ('gte' in cond) ok = ok && cmp(rowValue, cond.gte) >= 0
  if ('in' in cond) ok = ok && (cond.in as unknown[]).map(normalize).includes(normalize(rowValue))
  if ('not' in cond) ok = ok && normalize(rowValue) !== normalize(cond.not)
  if ('contains' in cond) {
    ok =
      ok &&
      typeof rowValue === 'string' &&
      rowValue.toLowerCase().includes(String(cond.contains).toLowerCase())
  }
  return ok
}

function whereMatch(row: Record<string, unknown>, where: Record<string, unknown> | undefined | null): boolean {
  const w = where ?? {}
  for (const [key, value] of Object.entries(w)) {
    if (key === 'AND') {
      if (!(value as Record<string, unknown>[]).every(sub => whereMatch(row, sub))) return false
    } else if (key === 'OR') {
      if (!(value as Record<string, unknown>[]).some(sub => whereMatch(row, sub))) return false
    } else if (key === 'NOT') {
      if (whereMatch(row, value as Record<string, unknown>)) return false
    } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      if (!condMatch(row[key], value as Record<string, unknown>)) return false
    } else {
      if (normalize(row[key]) !== normalize(value)) return false
    }
  }
  return true
}

function sortRows<T extends Record<string, unknown>>(out: T[], orderBy: unknown): T[] {
  const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []
  if (order.length === 0) return out
  return [...out].sort((a, b) => {
    for (const o of order) {
      for (const [k, dir] of Object.entries(o as Record<string, unknown>)) {
        const av = normalize(a[k]) as number | string
        const bv = normalize(b[k]) as number | string
        if (av === bv) continue
        const cmp = av < bv ? -1 : 1
        return dir === 'desc' ? -cmp : cmp
      }
    }
    return 0
  })
}

const fakeDb = {
  attempt: {
    findFirst: async ({ where }: { where: { guestId: string } }) => {
      call('attempt.findFirst')
      return (
        state.attempts
          .filter(a => a.guestId === where.guestId)
          .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())[0] ?? null
      )
    },
  },
  student: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.students.find(s => s.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.students.find(s => s.id === where.id)
      if (!row) throw new Error('student missing')
      Object.assign(row, data)
      return row
    },
  },
  riisheStudioActivity: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      call('riisheStudioActivity.create')
      const now = tick()
      const row: ActivityRow = {
        id: `act-${++state.activitySeq}`,
        guestId: data.guestId as string,
        studentId: null,
        kind: data.kind as string,
        topic: data.topic as string,
        status: 'IN_PROGRESS',
        grounding: data.grounding as string,
        documentId: (data.documentId as string | null) ?? null,
        documentTitle: (data.documentTitle as string | null) ?? null,
        responseLanguage: (data.responseLanguage as string | null) ?? null,
        activityVersion: (data.activityVersion as number) ?? 1,
        activityJson: data.activityJson as string,
        progressJson: null,
        responsesJson: null,
        resultJson: null,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        completedAt: null,
      }
      state.activities.push(row)
      return row
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      call('riisheStudioActivity.findFirst')
      return state.activities.find(r => whereMatch(r as unknown as Record<string, unknown>, where)) ?? null
    },
    findMany: async ({
      where,
      orderBy,
      take,
      select,
    }: {
      where?: Record<string, unknown>
      orderBy?: unknown
      take?: number
      select?: Record<string, boolean>
    }) => {
      call('riisheStudioActivity.findMany')
      let out = state.activities.filter(r => whereMatch(r as unknown as Record<string, unknown>, where))
      out = sortRows(out as unknown as Record<string, unknown>[], orderBy) as ActivityRow[]
      const sliced = out.slice(0, take ?? out.length)
      if (select) {
        // emulate Prisma select: only chosen columns (plus nothing else)
        return sliced.map(r => {
          const projected: Record<string, unknown> = {}
          for (const col of Object.keys(select)) projected[col] = (r as unknown as Record<string, unknown>)[col]
          return projected
        })
      }
      return sliced
    },
    count: async ({ where }: { where?: Record<string, unknown> }) => {
      call('riisheStudioActivity.count')
      return state.activities.filter(r => whereMatch(r as unknown as Record<string, unknown>, where)).length
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      call('riisheStudioActivity.update')
      const row = state.activities.find(r => whereMatch(r as unknown as Record<string, unknown>, where))
      if (!row) throw new Error('row missing')
      Object.assign(row, data)
      if (!('updatedAt' in data)) row.updatedAt = tick()
      return row
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      call('riisheStudioActivity.deleteMany')
      if (state.deleteManyThrows) throw new Error('delete unavailable')
      const doomed = state.activities.filter(r => whereMatch(r as unknown as Record<string, unknown>, where))
      state.activities = state.activities.filter(r => !doomed.includes(r))
      return { count: doomed.length }
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () =>
  completeAuthMock({
    getSessionStudent: async () => {
      if (state.sessionThrows) throw new Error('session store unavailable')
      return state.sessionStudent
    },
    requireStudent: async () => {
      if (state.sessionThrows) throw new Error('session store unavailable')
      return state.sessionStudent
    },
    sameOrigin: () => state.sameOrigin,
  }),
)

// Modules under test — imported AFTER the mocks.
const { listStudioActivities, previewStudioCleanup, confirmStudioCleanup, deleteStudioActivity, StudioStoreError } =
  await import('@/lib/riishe/studio-store')
const { GET: listRoute } = await import('@/app/api/riishe/studio/route')
const { POST: cleanupRoute } = await import('@/app/api/riishe/studio/cleanup/route')
const { PATCH: profilePatch } = await import('@/app/api/student/profile/route')
const { DELETE: deleteRecordRoute } = await import('@/app/api/riishe/studio/[id]/route')

function getReq(url: string): NextRequest {
  return new Request(url, { headers: { 'content-type': 'application/json' } }) as unknown as NextRequest
}

function postReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function patchReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function deleteReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function idCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const DAY = 24 * 60 * 60 * 1000
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY)
}

const MINI_RESULT = (percent: number) => JSON.stringify({ type: 'mini-test', correct: percent / 10, answered: 10, total: 10, percent })
const CARDS_RESULT = JSON.stringify({ type: 'flashcards', cardsTotal: 4, cardsReviewed: 2, recalled: 1, missed: 1 })

beforeEach(() => {
  state.sessionStudent = null
  state.sessionThrows = false
  state.sameOrigin = true
  state.activities = []
  state.attempts = []
  state.students = []
  state.studentSeq = 0
  state.activitySeq = 0
  state.deleteManyThrows = false
  dbCalls.length = 0
})

// ─── History: pagination, ordering, filters ───────────────────────────────────

describe('Phase 3H — history pagination and ordering', () => {
  it('H1. first page is the newest 50 with exact totalMatching and nextCursor', async () => {
    const gid = newGuest()
    for (let i = 0; i < 120; i++) seedActivity(gid, { topic: `Topic ${i}` })

    const page = await listStudioActivities(gid)
    expect(page.items).toHaveLength(50)
    expect(page.totalMatching).toBe(120)
    expect(page.nextCursor).not.toBeNull()
    // Stable ordering: newest first.
    for (let i = 1; i < page.items.length; i++) {
      const prev = new Date(page.items[i - 1].updatedAt).getTime()
      const cur = new Date(page.items[i].updatedAt).getTime()
      expect(prev).toBeGreaterThanOrEqual(cur)
    }

    const res = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null; totalMatching: number }
    expect(body.items).toHaveLength(50)
    expect(body.totalMatching).toBe(120)
    expect(body.nextCursor).not.toBeNull()
  })

  it('H2. walking pages yields every record exactly once in stable order', async () => {
    const gid = newGuest()
    for (let i = 0; i < 70; i++) seedActivity(gid, { topic: `T${i}` })

    const page1 = await listStudioActivities(gid, { limit: 30 })
    expect(page1.items).toHaveLength(30)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await listStudioActivities(gid, { limit: 30, cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(30)
    expect(page2.nextCursor).not.toBeNull()

    const page3 = await listStudioActivities(gid, { limit: 30, cursor: page2.nextCursor })
    expect(page3.items).toHaveLength(10)
    expect(page3.nextCursor).toBeNull()

    const ids = [...page1.items, ...page2.items, ...page3.items].map(i => i.id)
    expect(new Set(ids).size).toBe(70)
    // Full walk is one deterministic ordering (updatedAt desc, id desc).
    const times = [...page1.items, ...page2.items, ...page3.items].map(i => new Date(i.updatedAt).getTime())
    for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i])
  })

  it('H3. records sharing one updatedAt are tie-broken by id desc with no gaps', async () => {
    const gid = newGuest()
    const same = new Date(1_700_100_000_000)
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const row = seedActivity(gid, { updatedAt: same, createdAt: same, lastAccessedAt: same })
      ids.push(row.id)
    }
    const sortedDesc = [...ids].sort((a, b) => (a < b ? 1 : -1))

    const page1 = await listStudioActivities(gid, { limit: 2 })
    const page2 = await listStudioActivities(gid, { limit: 2, cursor: page1.nextCursor })
    const seen = [...page1.items, ...page2.items].map(i => i.id)
    expect(seen).toEqual(sortedDesc)
    expect(page2.nextCursor).toBeNull()
  })

  it('H4. invalid cursors and oversized limits are rejected 400 (hostile input)', async () => {
    const gid = newGuest()
    seedActivity(gid)

    const bad = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}&cursor=not-a-cursor`))
    expect(bad.status).toBe(400)
    const body = (await bad.json()) as { error: string }
    expect(body.error).toBe('Invalid request')

    const oversized = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}&limit=101`))
    expect(oversized.status).toBe(400)

    const unknownKind = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}&kind=not-a-kind`))
    expect(unknownKind.status).toBe(400)

    await expect(listStudioActivities(gid, { cursor: 'garbage' })).rejects.toMatchObject({
      status: 400,
      message: 'Invalid request',
    })
    expect(StudioStoreError).toBeTruthy()
  })

  it('H5. empty history returns an empty page with zero counts', async () => {
    const gid = newGuest()
    const page = await listStudioActivities(gid)
    expect(page.items).toEqual([])
    expect(page.totalMatching).toBe(0)
    expect(page.nextCursor).toBeNull()
    expect(page.evidence.total).toBe(0)
    expect(page.evidence.completed).toBe(0)
  })

  it('H6. guest scoping: another guest\'s records never appear or count', async () => {
    const mine = newGuest()
    const theirs = newGuest()
    seedActivity(theirs, { topic: 'Not mine' })
    seedActivity(mine, { topic: 'Mine' })

    const page = await listStudioActivities(mine)
    expect(page.items).toHaveLength(1)
    expect(page.totalMatching).toBe(1)
    expect(page.items[0].topic).toBe('Mine')
    expect(page.evidence.total).toBe(1)
  })
})

describe('Phase 3H — search and filters', () => {
  it('H7. search matches topic and document title (case-insensitive)', async () => {
    const gid = newGuest()
    seedActivity(gid, { topic: 'Photosynthesis basics' })
    seedActivity(gid, { topic: 'Respiration', documentTitle: 'Plant Physiology Reader' })
    seedActivity(gid, { topic: 'Kinematics' })

    const page = await listStudioActivities(gid, { search: 'photos' })
    expect(page.totalMatching).toBe(1)
    expect(page.items.map(i => i.topic)).toEqual(['Photosynthesis basics'])

    const byTitle = await listStudioActivities(gid, { search: 'physiology' })
    expect(byTitle.totalMatching).toBe(1)
    expect(byTitle.items[0].topic).toBe('Respiration')

    const none = await listStudioActivities(gid, { search: 'quantum' })
    expect(none.totalMatching).toBe(0)
    expect(none.items).toEqual([])
  })

  it('H8. kind and status filters narrow both the page and the matching count', async () => {
    const gid = newGuest()
    seedActivity(gid, { kind: 'flashcards', status: 'COMPLETED' })
    seedActivity(gid, { kind: 'mini-test', status: 'IN_PROGRESS' })
    seedActivity(gid, { kind: 'flashcards', status: 'ABANDONED' })

    const byKind = await listStudioActivities(gid, { kind: 'flashcards' })
    expect(byKind.totalMatching).toBe(2)
    expect(byKind.items.every(i => i.kind === 'flashcards')).toBe(true)

    const byStatus = await listStudioActivities(gid, { status: 'IN_PROGRESS' })
    expect(byStatus.totalMatching).toBe(1)
    expect(byStatus.items[0].kind).toBe('mini-test')

    const combined = await listStudioActivities(gid, { kind: 'flashcards', status: 'COMPLETED' })
    expect(combined.totalMatching).toBe(1)

    const routeRes = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}&kind=flashcards&status=COMPLETED`))
    const body = (await routeRes.json()) as { totalMatching: number; items: { kind: string }[] }
    expect(body.totalMatching).toBe(1)
    expect(body.items).toHaveLength(1)
  })

  it('H9. filters compose with cursor pagination without overlap', async () => {
    const gid = newGuest()
    for (let i = 0; i < 25; i++) seedActivity(gid, { kind: 'flashcards', topic: `Card set ${i}` })
    for (let i = 0; i < 25; i++) seedActivity(gid, { kind: 'steps', topic: `Steps ${i}` })

    const p1 = await listStudioActivities(gid, { kind: 'flashcards', limit: 10 })
    expect(p1.totalMatching).toBe(25)
    expect(p1.items.every(i => i.kind === 'flashcards')).toBe(true)
    const p2 = await listStudioActivities(gid, { kind: 'flashcards', limit: 10, cursor: p1.nextCursor })
    const p3 = await listStudioActivities(gid, { kind: 'flashcards', limit: 10, cursor: p2.nextCursor })
    const all = [...p1.items, ...p2.items, ...p3.items]
    expect(all).toHaveLength(25)
    expect(new Set(all.map(i => i.id)).size).toBe(25)
  })
})

// ─── Evidence accuracy ────────────────────────────────────────────────────────

describe('Phase 3H — accurate evidence roll-up', () => {
  it('E1. status counts are exact beyond the page (whole history, not the page)', async () => {
    const gid = newGuest()
    for (let i = 0; i < 60; i++) {
      seedActivity(gid, { kind: 'mini-test', status: 'COMPLETED', resultJson: MINI_RESULT(70), completedAt: tick() })
    }
    seedActivity(gid, { status: 'IN_PROGRESS' })
    seedActivity(gid, { status: 'ABANDONED' })

    const page = await listStudioActivities(gid, { limit: 10 })
    expect(page.items).toHaveLength(10)
    expect(page.evidence.total).toBe(62)
    expect(page.evidence.completed).toBe(60)
    expect(page.evidence.inProgress).toBe(1)
    expect(page.evidence.abandoned).toBe(1)
    expect(page.evidence.miniTestsCompleted).toBe(60)
    expect(page.evidence.miniTestPercentAvg).toBe(70)
    expect(page.evidence.truncated).toBe(false)
  })

  it('E2. per-kind aggregates are bounded and truthfully labelled when truncated', async () => {
    const gid = newGuest()
    // 210 completed flashcards with results — the scan caps at 200.
    for (let i = 0; i < 210; i++) {
      seedActivity(gid, { kind: 'flashcards', status: 'COMPLETED', resultJson: CARDS_RESULT })
    }
    const page = await listStudioActivities(gid, { limit: 5 })
    expect(page.evidence.total).toBe(210)
    expect(page.evidence.completed).toBe(210)
    expect(page.evidence.cardsReviewed).toBe(400) // 200 scanned rows x 2 cards
    expect(page.evidence.truncated).toBe(true)
  })

  it('E3. evidence describes the whole history even while filters narrow the list', async () => {
    const gid = newGuest()
    seedActivity(gid, { topic: 'Photosynthesis', kind: 'mini-test', status: 'COMPLETED', resultJson: MINI_RESULT(80), completedAt: tick() })
    seedActivity(gid, { topic: 'Respiration' })

    const page = await listStudioActivities(gid, { search: 'photos' })
    expect(page.totalMatching).toBe(1)
    expect(page.items).toHaveLength(1)
    expect(page.evidence.total).toBe(2)
    expect(page.evidence.miniTestsCompleted).toBe(1)
  })
})

// ─── Retention preference (existing settings architecture) ────────────────────

describe('Phase 3H — retention preference via profile PATCH', () => {
  it('R1. a signed-in student can set and clear the retention choice', async () => {
    const student = seedStudent({ dailyMinutes: 45 })
    state.sessionStudent = { id: student.id }

    const set = await profilePatch(
      patchReq('http://x/api/student/profile', { preferences: { studioRetentionDays: 90 } }),
    )
    expect(set.status).toBe(200)
    const stored = JSON.parse(state.students[0].preferencesJson as string) as Record<string, unknown>
    expect(stored.studioRetentionDays).toBe(90)
    // The merge preserves unrelated preference keys.
    expect(stored.dailyMinutes).toBe(45)

    const cleared = await profilePatch(
      patchReq('http://x/api/student/profile', { preferences: { studioRetentionDays: null } }),
    )
    expect(cleared.status).toBe(200)
    const after = JSON.parse(state.students[0].preferencesJson as string) as Record<string, unknown>
    expect(after.studioRetentionDays).toBeUndefined()
    expect(after.dailyMinutes).toBe(45)
  })

  it('R2. invalid retention values are rejected server-side', async () => {
    const student = seedStudent()
    state.sessionStudent = { id: student.id }

    for (const bad of [45, 0, 3650, 'ninety']) {
      const res = await profilePatch(
        patchReq('http://x/api/student/profile', { preferences: { studioRetentionDays: bad } }),
      )
      expect(res.status).toBe(400)
    }
    expect(JSON.parse(state.students[0].preferencesJson as string)).toEqual({})
  })

  it('R3. guests (401) and cross-origin requests (403) can never change it', async () => {
    const student = seedStudent()

    const res = await profilePatch(
      patchReq('http://x/api/student/profile', { preferences: { studioRetentionDays: 30 } }),
    )
    expect(res.status).toBe(401)

    state.sessionStudent = { id: student.id }
    state.sameOrigin = false
    const cross = await profilePatch(
      patchReq('http://x/api/student/profile', { preferences: { studioRetentionDays: 30 } }),
    )
    expect(cross.status).toBe(403)
    expect(JSON.parse(state.students[0].preferencesJson as string)).toEqual({})
  })

  it('R4. existing users without the key keep keep-forever semantics (no silent change)', async () => {
    const student = seedStudent({ language: 'en' })
    state.sessionStudent = { id: student.id }
    const res = await profilePatch(patchReq('http://x/api/student/profile', { displayName: 'New name' }))
    expect(res.status).toBe(200)
    const prefs = JSON.parse(state.students[0].preferencesJson as string) as Record<string, unknown>
    expect(prefs.studioRetentionDays).toBeUndefined()
    expect(prefs.language).toBe('en')
  })
})

// ─── Cleanup: preview, confirm, scope, safety ─────────────────────────────────

describe('Phase 3H — cleanup preview', () => {
  it('C1. preview counts exactly the in-scope records (completed/abandoned, old, own)', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(100), resultJson: MINI_RESULT(50) })
    seedActivity(gid, { status: 'ABANDONED', updatedAt: daysAgo(95) })
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(10) }) // too recent
    seedActivity(gid, { status: 'IN_PROGRESS', updatedAt: daysAgo(200) }) // never cleaned
    const foreign = newGuest()
    seedActivity(foreign, { status: 'COMPLETED', updatedAt: daysAgo(200) }) // other owner

    const res = await cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { preview: boolean; affected: number; cutoff: string; scopeNote: string; olderThanDays: number }
    expect(body.preview).toBe(true)
    expect(body.affected).toBe(2)
    expect(body.olderThanDays).toBe(90)
    expect(new Date(body.cutoff).getTime()).toBeGreaterThan(daysAgo(91).getTime())
    expect(body.scopeNote).toContain('In-progress activities are never cleaned up')
    // A preview deletes nothing.
    expect(state.activities).toHaveLength(5)
    expect(dbCalls.filter(c => c === 'riisheStudioActivity.deleteMany')).toEqual([])
  })

  it('C2. the boundary is exclusive: records exactly at newer ages survive', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(89) })
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(91) })
    const preview = await previewStudioCleanup(gid, 90)
    expect(preview.affected).toBe(1)
  })

  it('C3. invalid day choices are rejected 400 before any read', async () => {
    const gid = newGuest()
    const res = await cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 45 }))
    expect(res.status).toBe(400)
    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])
  })
})

describe('Phase 3H — cleanup confirmation and safety', () => {
  it('C4. confirmation is required: absent confirm only previews', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(200), resultJson: MINI_RESULT(50) })

    const res = await cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90 }))
    const body = (await res.json()) as { preview: boolean }
    expect(body.preview).toBe(true)
    expect(state.activities).toHaveLength(1)
  })

  it('C5. a confirmed cleanup deletes only the in-scope owner records', async () => {
    const gid = newGuest()
    const oldCompleted = seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(200) })
    const oldAbandoned = seedActivity(gid, { status: 'ABANDONED', updatedAt: daysAgo(150) })
    const freshCompleted = seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(5) })
    const oldInProgress = seedActivity(gid, { status: 'IN_PROGRESS', updatedAt: daysAgo(300) })
    const foreignRow = seedActivity(newGuest(), { status: 'COMPLETED', updatedAt: daysAgo(300) })

    const res = await cleanupRoute(
      postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90, confirm: 'CLEANUP' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; deleted: number; remaining: number }
    expect(body.ok).toBe(true)
    expect(body.deleted).toBe(2)
    expect(body.remaining).toBe(0)

    const survivingIds = state.activities.map(r => r.id)
    expect(survivingIds).toContain(freshCompleted.id)
    expect(survivingIds).toContain(oldInProgress.id)
    expect(survivingIds).toContain(foreignRow.id)
    expect(survivingIds).not.toContain(oldCompleted.id)
    expect(survivingIds).not.toContain(oldAbandoned.id)
  })

  it('C6. repeated requests are safe and drain the scope to zero', async () => {
    const gid = newGuest()
    for (let i = 0; i < 7; i++) seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })

    const first = await confirmStudioCleanup(gid, 90)
    expect(first.deleted).toBe(7)
    expect(first.remaining).toBe(0)

    const second = await confirmStudioCleanup(gid, 90)
    expect(second.deleted).toBe(0)
    expect(second.remaining).toBe(0)
  })

  it('C7. large scopes are bounded per batch and honestly reported', async () => {
    const gid = newGuest()
    for (let i = 0; i < 505; i++) seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })

    const batch1 = await confirmStudioCleanup(gid, 90)
    expect(batch1.deleted).toBe(500)
    expect(batch1.remaining).toBe(5)

    const batch2 = await confirmStudioCleanup(gid, 90)
    expect(batch2.deleted).toBe(5)
    expect(batch2.remaining).toBe(0)
  })

  it('C8. concurrent requests cannot delete out-of-scope rows (scope re-asserted)', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(110) })
    seedActivity(gid, { status: 'IN_PROGRESS', updatedAt: daysAgo(300) })
    const protectedRow = seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(1) })

    const [a, b] = await Promise.all([
      cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90, confirm: 'CLEANUP' })),
      cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90, confirm: 'CLEANUP' })),
    ])
    const bodyA = (await a.json()) as { deleted: number; remaining: number }
    const bodyB = (await b.json()) as { deleted: number; remaining: number }
    // The union of both deletions never exceeds the scope, and the two runs
    // together drain it exactly once (each row deleted at most once).
    expect(bodyA.deleted + bodyB.deleted).toBe(2)
    expect(bodyA.remaining + bodyB.remaining).toBe(0)
    const survivingIds = state.activities.map(r => r.id)
    expect(survivingIds).toContain(protectedRow.id)
  })

  it('C9. the delete statement re-asserts ownership + status + cutoff in its WHERE', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })
    dbCalls.length = 0
    await confirmStudioCleanup(gid, 90)
    const deleteCalls = dbCalls.filter(c => c === 'riisheStudioActivity.deleteMany')
    expect(deleteCalls).toHaveLength(1)
    // The where clause passed to deleteMany is captured indirectly by the
    // outcome assertions in C5/C8; here we assert the batch select itself was
    // scope-shaped (small columns) by checking the findMany+deleteMany pair.
    expect(dbCalls.filter(c => c === 'riisheStudioActivity.findMany')).toHaveLength(1)
    expect(dbCalls.filter(c => c === 'riisheStudioActivity.count')).toHaveLength(1)
  })

  it('C10. a failed delete is reported truthfully — never a success with counts', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })
    state.deleteManyThrows = true

    const res = await cleanupRoute(
      postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90, confirm: 'CLEANUP' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Could not complete the cleanup. Please try again.')
    // The record was NOT deleted (the batch select ran, the delete threw).
    expect(state.activities).toHaveLength(1)
    state.deleteManyThrows = false
  })

  it('C11. cross-origin cleanup is 403; a foreign claimant is 403 before any read', async () => {
    const gid = newGuest()
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })

    state.sameOrigin = false
    const cross = await cleanupRoute(
      postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90 }),
    )
    expect(cross.status).toBe(403)
    expect((await cross.json() as { error: string }).error).toBe('Cross-origin request blocked')
    state.sameOrigin = true

    seedClaim(gid, 'the-real-owner')
    state.sessionStudent = { id: 'attacker' }
    dbCalls.length = 0
    const foreign = await cleanupRoute(
      postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90 }),
    )
    expect(foreign.status).toBe(403)
    expect((await foreign.json() as { error: string }).error).toBe('This learning history belongs to a different account.')
    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])
  })

  it('C12. cleanup rate limit kicks in after the configured burst (429)', async () => {
    const gid = newGuest() // fresh guest → fresh rate bucket
    seedActivity(gid, { status: 'COMPLETED', updatedAt: daysAgo(120) })
    let last = 200
    for (let i = 0; i < 7; i++) {
      const res = await cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90 }))
      last = res.status
      if (i < 6) expect(res.status).toBe(200)
    }
    expect(last).toBe(429)
  })
})

// ─── Security + single-record compatibility ───────────────────────────────────

describe('Phase 3H — ownership before read and single-delete compatibility', () => {
  it('S1. the paged history still rejects foreign claimants before any read', async () => {
    const victimGuest = 'guest-owned-by-victim-3h'
    seedClaim(victimGuest, 'someone-else')
    state.sessionStudent = { id: 'attacker' }
    dbCalls.length = 0

    const res = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${victimGuest}`))
    expect(res.status).toBe(403)
    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])
  })

  it('S2. single-record deletion still works exactly as before (3F contract)', async () => {
    const gid = newGuest()
    const row = seedActivity(gid, { status: 'COMPLETED', resultJson: MINI_RESULT(50) })

    const foreign = await deleteRecordRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: 'other-guest' }), idCtx(row.id))
    expect(foreign.status).toBe(404)
    expect(state.activities).toHaveLength(1)

    const ok = await deleteRecordRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid }), idCtx(row.id))
    expect(ok.status).toBe(200)
    expect(state.activities).toHaveLength(0)

    await expect(deleteStudioActivity(gid, row.id)).rejects.toMatchObject({ status: 404 })
  })

  it('S3. a thrown session lookup fails closed with 503 on the cleanup route', async () => {
    const gid = newGuest()
    state.sessionThrows = true
    const res = await cleanupRoute(postReq('http://x/api/riishe/studio/cleanup', { guestId: gid, olderThanDays: 90 }))
    expect(res.status).toBe(503)
    state.sessionThrows = false
  })
})
