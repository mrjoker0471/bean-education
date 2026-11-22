import { describe, it, expect, beforeEach, mock } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'
import {
  gradeTypedRecall,
  normalizeRecallText,
  GRADE_CORRECT_THRESHOLD,
  GRADE_PARTIAL_THRESHOLD,
  GRADE_SPAM_TOKEN_RATIO,
  type StudioActivityRow,
} from '@/lib/riishe/studio-types'

// ─── Phase 3G — Studio graded recall (type-the-answer flashcards) ─────────────
// Extends the Phase 3F evidence model with an OPTIONAL objective recall step:
// the learner types what they recall BEFORE revealing, and a deterministic,
// documented text-similarity heuristic grades the attempt against the card's
// answer. Covers the three layers of the feature:
//
//   G1. grading helper (pure): normalization (case, punctuation, diacritics,
//       NFKC superscripts), verdict thresholds, empty-attempt honesty (null),
//       single-token compact comparison, spam guard, determinism
//   G2. store: typedRecall validation (bounds, caps, whitespace-only dropped),
//       server-side recomputation of the graded block at completion, idempotent
//       completion, backward compatibility (no typed answers → no graded block)
//   G3. routes: the complete intent carries typed answers; client verdicts are
//       never stored (unknown fields stripped, result recomputed); ownership
//       scoping and generic errors are unchanged
//
// Honesty invariants (same as Phase 3F, extended):
//   - typed evidence never feeds mastery/attempt/revision records
//   - the stored result is recomputed SERVER-side from snapshot + typed text
//   - a verdict is approximate text matching and is labelled as such

// ─── G1. Grading helper ───────────────────────────────────────────────────────

describe('Phase 3G — graded recall helper', () => {
  it('grades an exact match correct', () => {
    expect(gradeTypedRecall('The powerhouse of the cell', 'The powerhouse of the cell')).toBe('correct')
  })

  it('normalizes case, punctuation and diacritics', () => {
    expect(gradeTypedRecall("Newton's second law", 'NEWTONS  SECOND  LAW')).toBe('correct')
    expect(gradeTypedRecall('café con leche', 'cafe con leche')).toBe('correct')
    expect(normalizeRecallText('  Héllo,   WORLD! ')).toBe('hello world')
  })

  it('NFKC-normalizes superscripts so formula forms match', () => {
    expect(gradeTypedRecall('E = mc²', 'e=mc2')).toBe('correct')
    expect(gradeTypedRecall('E = mc²', 'E = mc^2')).toBe('correct')
  })

  it('grades token overlap: order-independent shared words can be correct, fewer is partial', () => {
    // 7 shared of union 8 = 0.875 ≥ correct threshold — word order is irrelevant
    expect(gradeTypedRecall('a force changes the motion of an object', 'the force of an object changes the motion')).toBe('correct')
    // 5 shared of union 8 = 0.625 → partial (between thresholds)
    const mixed = gradeTypedRecall('a force changes the motion of an object', 'a force changes the motion')
    expect(mixed).toBe('partial')
  })

  it('grades unrelated answers incorrect', () => {
    expect(gradeTypedRecall('photosynthesis converts light into chemical energy', 'the treaty of versailles')).toBe('incorrect')
  })

  it('returns null for an empty attempt — no attempt is not evidence', () => {
    expect(gradeTypedRecall('anything', '')).toBeNull()
    expect(gradeTypedRecall('anything', '   ')).toBeNull()
    expect(gradeTypedRecall('anything', '\n\t')).toBeNull()
  })

  it('grades a typed answer against an empty expected text incorrect', () => {
    expect(gradeTypedRecall('   ', 'something')).toBe('incorrect')
  })

  it('single-token answers compare compactly: equality correct, containment partial', () => {
    expect(gradeTypedRecall('mitochondria', 'MITOCHONDRIA')).toBe('correct')
    expect(gradeTypedRecall('photosynthesis', 'photosyn')).toBe('partial')
    // Short substrings cannot inflate the verdict (≥4 chars required).
    expect(gradeTypedRecall('photosynthesis', 'the')).toBe('incorrect')
  })

  it('formula strings match across notation, but differing operators stay honest', () => {
    // Implicit multiplication and caret superscripts are notation-lenient.
    expect(gradeTypedRecall('F = m · a', 'f=ma')).toBe('correct')
    expect(gradeTypedRecall('E = mc²', 'e=mc2')).toBe('correct')
    expect(gradeTypedRecall('E = mc²', 'E = mc^2')).toBe('correct')
    // Division is NOT multiplication — same letters, different formula → partial
    expect(gradeTypedRecall('F = m · a', 'f = m / a')).toBe('partial')
  })

  it('spam guard: vastly longer input caps at partial', () => {
    const answer = 'the mitochondria produces atp'
    const spam = `the mitochondria produces atp ${'extra filler word '.repeat(12)}`
    expect(gradeTypedRecall(answer, spam)).toBe('partial')
    expect(GRADE_SPAM_TOKEN_RATIO).toBe(3)
  })

  it('is deterministic — same inputs always produce the same verdict', () => {
    const pairs: [string, string][] = [
      ['induced emf equals negative dphi by dt', 'emf = -dΦ/dt'],
      ['demand rises when price falls', 'when price falls demand rises'],
      ['boyle law pressure volume', 'boyle'],
    ]
    for (const [exp, got] of pairs) {
      const first = gradeTypedRecall(exp, got)
      expect(first).not.toBeNull()
      for (let i = 0; i < 5; i++) expect(gradeTypedRecall(exp, got)).toBe(first)
    }
  })

  it('documents its thresholds explicitly', () => {
    expect(GRADE_CORRECT_THRESHOLD).toBe(0.75)
    expect(GRADE_PARTIAL_THRESHOLD).toBe(0.4)
  })
})

// ─── G2. Store: typedRecall validation + server-side graded result ────────────

let seq = 0
const nextId = () => `act-3g-${++seq}`
let nowMs = 1_700_000_000_000
const tick = () => new Date(nowMs++)

const rows: StudioActivityRow[] = []

function toRow(r: Partial<StudioActivityRow> & { guestId: string; kind: string; topic: string; activityJson: string }): StudioActivityRow {
  return {
    id: r.id ?? nextId(),
    guestId: r.guestId,
    studentId: r.studentId ?? null,
    kind: r.kind,
    topic: r.topic,
    status: r.status ?? 'IN_PROGRESS',
    grounding: r.grounding ?? 'document',
    documentId: r.documentId ?? null,
    documentTitle: r.documentTitle ?? null,
    responseLanguage: r.responseLanguage ?? null,
    activityVersion: r.activityVersion ?? 1,
    activityJson: r.activityJson,
    progressJson: r.progressJson ?? null,
    responsesJson: r.responsesJson ?? null,
    resultJson: r.resultJson ?? null,
    createdAt: r.createdAt ?? tick(),
    updatedAt: r.updatedAt ?? tick(),
    lastAccessedAt: r.lastAccessedAt ?? tick(),
    completedAt: r.completedAt ?? null,
  }
}

const fakeDb = {
  attempt: {
    findFirst: async () => null,
  },
  riisheStudioActivity: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = toRow(data as Record<string, unknown>)
      rows.push(row)
      return row
    },
    findFirst: async ({ where }: { where: { id: string; guestId: string } }) =>
      rows.find(r => r.id === where.id && r.guestId === where.guestId) ?? null,
    findMany: async ({ where, orderBy, take }: { where: { guestId: string }; orderBy?: { updatedAt: string }; take?: number }) => {
      const out = rows.filter(r => r.guestId === where.guestId)
      if (orderBy?.updatedAt === 'desc') out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return out.slice(0, take ?? out.length)
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find(r => r.id === where.id)
      if (!row) throw new Error('row missing')
      Object.assign(row, data)
      if (!('updatedAt' in data)) row.updatedAt = tick()
      return row
    },
    deleteMany: async ({ where }: { where: { id: string; guestId: string } }) => {
      const before = rows.length
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].id === where.id && rows[i].guestId === where.guestId) rows.splice(i, 1)
      }
      return { count: before - rows.length }
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

const { saveGeneratedActivity, saveStudioProgress, completeStudioActivity, StudioStoreError } = await import('@/lib/riishe/studio-store')

const CARDS_3G = {
  kind: 'flashcards' as const,
  title: 'Cell biology recall',
  cards: [
    { front: 'Powerhouse of the cell?', back: 'The mitochondria produces ATP', kindTag: 'fact' as const },
    { front: 'Process that converts light into chemical energy?', back: 'Photosynthesis converts light into chemical energy', kindTag: 'definition' as const },
    { front: 'Which organelle stores genetic material?', back: 'The nucleus stores DNA', kindTag: 'qa' as const },
  ],
}

function seedCards(guestId: string) {
  return saveGeneratedActivity({
    guestId,
    activity: CARDS_3G,
    topic: 'Cell biology',
    grounding: 'document',
    documentId: 'doc-1',
    documentTitle: 'Biology notes',
    responseLanguage: 'auto',
  })
}

let guestSeq = 0
const newGuest = () => `p3g-guest-${++guestSeq}`

function resetRows() {
  rows.length = 0
  seq = 0
}

beforeEach(() => {
  resetRows()
})

describe('Phase 3G — studio store typedRecall', () => {
  it('persists typed answers through a progress save (trimmed; whitespace-only dropped)', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    await saveStudioProgress(
      guest,
      id,
      { order: [0, 1, 2], index: 0, revealed: false, reviewed: [] },
      { selfRecall: {}, typedRecall: { '0': '  the mitochondria makes atp  ', '1': '   ' } },
    )
    const record = await (await import('@/lib/riishe/studio-store')).getStudioActivity(guest, id)
    expect(record?.responses).toEqual({ selfRecall: {}, typedRecall: { '0': 'the mitochondria makes atp' } })
  })

  it('rejects typed answers for out-of-range card indexes (400)', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    try {
      await saveStudioProgress(guest, id, { order: [0, 1, 2], index: 0, revealed: false, reviewed: [] }, { selfRecall: {}, typedRecall: { '7': 'nope' } })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(StudioStoreError)
      expect((err as StudioStoreError).status).toBe(400)
    }
  })

  it('rejects typed answers over the 2000-char cap (400)', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    try {
      await saveStudioProgress(guest, id, { order: [0, 1, 2], index: 0, revealed: false, reviewed: [] }, { selfRecall: {}, typedRecall: { '0': 'x'.repeat(2001) } })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(StudioStoreError)
      expect((err as StudioStoreError).status).toBe(400)
    }
  })

  it('completion recomputes the graded block SERVER-side (correct/partial/incorrect)', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    const { record } = await completeStudioActivity(guest, id, {
      selfRecall: { '2': 'recalled' },
      typedRecall: {
        // exact after normalization → correct
        '0': 'The Mitochondria Produces ATP!',
        // partial overlap (3 shared of union 7) → partial
        '1': 'photosynthesis converts light into heat',
        // unrelated → incorrect
        '2': 'the treaty of versailles',
      },
    })
    expect(record.status).toBe('COMPLETED')
    expect(record.result).toMatchObject({ type: 'flashcards', cardsTotal: 3, cardsReviewed: 1, recalled: 1, missed: 0 })
    expect((record.result as { graded?: { attempted: number; correct: number; partial: number; incorrect: number } }).graded).toEqual({
      attempted: 3,
      correct: 1,
      partial: 1,
      incorrect: 1,
    })
  })

  it('no typed answers → result carries NO graded block (backward compatible)', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    const { record } = await completeStudioActivity(guest, id, { selfRecall: { '0': 'missed' } })
    const result = record.result as { graded?: unknown }
    expect(result.type).toBe('flashcards')
    expect(result.graded).toBeUndefined()
    expect(record.result).toMatchObject({ cardsReviewed: 1, recalled: 0, missed: 1 })
  })

  it('completion falls back to stored typed evidence when the client does not re-send it', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    await saveStudioProgress(
      guest,
      id,
      { order: [0, 1, 2], index: 1, revealed: true, reviewed: [0] },
      { selfRecall: {}, typedRecall: { '0': 'mitochondria produces atp' } },
    )
    const { record } = await completeStudioActivity(guest, id, { selfRecall: {} })
    expect((record.result as { graded?: { attempted: number; correct: number } }).graded).toEqual({
      attempted: 1,
      correct: 1,
      partial: 0,
      incorrect: 0,
    })
  })

  it('completion is idempotent — a repeated complete returns the stored result unchanged', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    const first = await completeStudioActivity(guest, id, { selfRecall: {}, typedRecall: { '0': 'atp from mitochondria' } })
    const second = await completeStudioActivity(guest, id, { selfRecall: {}, typedRecall: { '0': 'TOTALLY DIFFERENT ANSWER' } })
    expect(second.alreadyCompleted).toBe(true)
    expect(second.record.result).toEqual(first.record.result)
  })

  it('client verdicts are never stored — unknown response fields are stripped', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    // A hostile client sends a fabricated graded block next to its typed text.
    const { record } = await completeStudioActivity(guest, id, {
      selfRecall: {},
      typedRecall: { '0': 'wrong on purpose' },
      graded: { attempted: 1, correct: 1, partial: 0, incorrect: 0 },
    } as Record<string, unknown>)
    expect((record.result as { graded?: { correct: number } }).graded).toEqual({ attempted: 1, correct: 0, partial: 0, incorrect: 1 })
  })
})

// ─── G3. Routes: the complete intent + ownership are unchanged ────────────────

const state = {
  sessionStudent: null as { id: string } | null,
  sameOrigin: true,
}

mock.module('@/lib/auth', () =>
  completeAuthMock({
    getSessionStudent: async () => state.sessionStudent,
    requireStudent: async () => state.sessionStudent,
    sameOrigin: () => state.sameOrigin,
  }),
)

const { PATCH: patchRoute } = await import('@/app/api/riishe/studio/[id]/route')
const { getStudioActivity } = await import('@/lib/riishe/studio-store')

function req(url: string, init: RequestInit = {}): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

function patchReq(url: string, body: unknown): NextRequest {
  return req(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  })
}

function idCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('Phase 3G — studio route typed recall', () => {
  it('PATCH complete with typed answers returns the server-computed graded summary', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    const res = await patchRoute(
      patchReq(`http://x/api/riishe/studio/${id}`, {
        guestId: guest,
        action: 'complete',
        responses: {
          selfRecall: {},
          typedRecall: { '0': 'the mitochondria produces atp', '1': 'photosynthesis converts light into chemical energy' },
        },
      }),
      idCtx(id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.record.result).toMatchObject({ type: 'flashcards', cardsTotal: 3 })
    expect(body.record.result.graded).toEqual({ attempted: 2, correct: 2, partial: 0, incorrect: 0 })
    // Typed evidence is part of the stored record (visible on resume).
    expect(body.record.responses.typedRecall).toEqual({
      '0': 'the mitochondria produces atp',
      '1': 'photosynthesis converts light into chemical energy',
    })
  })

  it('PATCH progress with typed answers stores the trimmed evidence', async () => {
    const guest = newGuest()
    const id = await seedCards(guest)
    const res = await patchRoute(
      patchReq(`http://x/api/riishe/studio/${id}`, {
        guestId: guest,
        progress: { order: [0, 1, 2], index: 0, revealed: false, reviewed: [] },
        responses: { selfRecall: {}, typedRecall: { '0': '  the nucleus stores dna  ' } },
      }),
      idCtx(id),
    )
    expect(res.status).toBe(200)
    const stored = await getStudioActivity(guest, id)
    expect(stored?.responses?.typedRecall).toEqual({ '0': 'the nucleus stores dna' })
  })

  it('a foreign claimant is 403 before any read (ownership contract unchanged)', async () => {
    // Signed in as attacker-3g; the claimed guestId belongs to student-3g
    // (its claim attempt resolves to that student) → 403 before any read.
    state.sessionStudent = { id: 'attacker-3g' }
    fakeDb.attempt.findFirst = async () => ({ studentId: 'student-3g' })
    try {
      const res = await patchRoute(patchReq('http://x/api/riishe/studio/act-foreign', { guestId: 'someone-else', action: 'complete', responses: { selfRecall: {}, typedRecall: { '0': 'x' } } }), idCtx('act-foreign'))
      expect(res.status).toBe(403)
    } finally {
      fakeDb.attempt.findFirst = async () => null
      state.sessionStudent = null
    }
  })

  it('an unknown activity id is 404 with generic text (no existence leak)', async () => {
    const res = await patchRoute(patchReq('http://x/api/riishe/studio/does-not-exist', { guestId: newGuest(), action: 'complete', responses: { selfRecall: {}, typedRecall: { '0': 'x' } } }), idCtx('does-not-exist'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Activity not found')
  })

  it('cross-origin mutations stay 403', async () => {
    state.sameOrigin = false
    try {
      const res = await patchRoute(patchReq('http://x/api/riishe/studio/whatever', { guestId: newGuest(), action: 'complete', responses: { selfRecall: {}, typedRecall: { '0': 'x' } } }), idCtx('whatever'))
      expect(res.status).toBe(403)
    } finally {
      state.sameOrigin = true
    }
  })
})
