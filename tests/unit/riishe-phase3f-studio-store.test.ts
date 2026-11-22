import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  saveGeneratedActivity,
  getStudioActivity,
  listStudioActivities,
  saveStudioProgress,
  completeStudioActivity,
  abandonStudioActivity,
  deleteStudioActivity,
  StudioStoreError,
  summarizeEvidence,
} from '@/lib/riishe/studio-store'
import type { StudioActivityRow } from '@/lib/riishe/studio-store'
import type { StudioActivityResult, StudioEvidenceSummaryDTO } from '@/lib/riishe/studio-types'

// ─── Phase 3F — Studio continuity store: persistence, lifecycle, evidence ─────
// Covers the store against a faithful in-memory db (no real database, no
// network): every function must scope by { id, guestId }, enforce the
// server-owned lifecycle, recompute scores server-side and never invent
// evidence.
//
//   P1. create → restore round-trip for EVERY activity kind (snapshot intact)
//   P2. in-progress progress save/restore per kind (clamped + validated)
//   P3. completion is recorded exactly once; a repeated completion returns the
//       stored summary unchanged (no duplicate completion, no score change)
//   P4. invalid lifecycle transitions are rejected (complete→abandoned 409,
//       abandon→completed 409, progress on terminal rows 409)
//   P5. evidence honesty: mini-test scores are SERVER-recomputed (client scores
//       do not exist in the contract); a flashcard reveal is not recall;
//       self-marked recall is stored as such; formula verified/illustrative
//       is copied from the snapshot, never upgraded; concept-map/steps carry
//       no correctness
//   P6. ownership: every read/write is { id, guestId }-scoped — a valid id
//       belonging to another guest is 404 / deletes nothing
//   P7. deleted/unavailable source documents: records stay restorable
//       (snapshot-based resume needs no document)
//   P8. evidence roll-up is honest and bounded

let seq = 0
const nextId = () => `act-${++seq}`
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
  riisheStudioActivity: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = toRow({ ...(data as Record<string, unknown>), guestId: data.guestId as string, kind: data.kind as string, topic: data.topic as string, activityJson: data.activityJson as string })
      rows.push(row)
      return row
    },
    findFirst: async ({ where }: { where: { id: string; guestId: string } }) =>
      rows.find(r => r.id === where.id && r.guestId === where.guestId) ?? null,
    findMany: async ({ where, orderBy, take }: { where: { guestId: string }; orderBy?: { updatedAt: string } | Record<string, unknown>[]; take?: number }) => {
      const out = rows.filter(r => r.guestId === where.guestId)
      // Phase 3H lock-step: orderBy may be the composite array
      // [(updatedAt desc), (id desc)] — sort deterministically in that case.
      const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []
      if (order.some(o => (o as { updatedAt?: string }).updatedAt === 'desc')) {
        out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || String(b.id).localeCompare(String(a.id)))
      }
      return out.slice(0, take ?? out.length)
    },
    count: async ({ where }: { where: Record<string, unknown> }) => {
      // Phase 3H lock-step: evaluate the count-only where shapes the store emits.
      const w = where ?? {}
      return rows.filter(r => {
        if (w.guestId !== undefined && r.guestId !== w.guestId) return false
        if (w.status !== undefined && r.status !== w.status) return false
        if (w.kind !== undefined) {
          const k = w.kind as { in?: string[] } | string
          if (typeof k === 'string') {
            if (r.kind !== k) return false
          } else if (k.in && !k.in.includes(r.kind)) return false
        }
        if (w.resultJson !== undefined) {
          const cond = w.resultJson as { not?: unknown }
          if (cond && cond.not === null && r.resultJson == null) return false
        }
        return true
      }).length
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

// ─── Valid snapshots (the shapes the Phase 3E normalisers produce) ────────────

const MAP = {
  kind: 'concept-map' as const,
  title: 'Laws of motion',
  nodes: [
    { id: 'n1', label: 'Root', parent: null, explanation: 'Root explanation.' },
    { id: 'n2', label: 'First law', parent: 'n1', explanation: 'Inertia.' },
    { id: 'n3', label: 'Second law', parent: 'n1', explanation: 'F = ma.' },
  ],
}
const STEPS = {
  kind: 'steps' as const,
  title: 'Solving for acceleration',
  steps: [
    { title: 'Identify the variables', body: 'Find F and m.' },
    { title: 'Substitute', body: 'Put the numbers in.' },
    { title: 'Compute', body: 'Divide.' },
  ],
}
const FORMULA_VERIFIED = {
  kind: 'formula' as const,
  title: 'Speed',
  formula: 'v = d / t',
  variables: [{ symbol: 'v', meaning: 'speed' }],
  steps: [{ stage: 'calculate' as const, description: 'Divide.', expression: '100 / 20', claimedResult: '5', verification: { computed: '5', matches: true } }],
  result: { value: '5', units: 'm/s', verified: true, illustrative: false },
}
const FORMULA_ILLUSTRATIVE = {
  kind: 'formula' as const,
  title: 'Momentum (no concrete inputs)',
  formula: 'p = m · v',
  variables: [{ symbol: 'p', meaning: 'momentum' }],
  steps: [{ stage: 'substitute' as const, description: 'Insert values when known.' }],
  result: { value: 'm × v', illustrative: true, verified: false },
}
const CARDS = {
  kind: 'flashcards' as const,
  title: 'Key terms',
  cards: [
    { front: 'What is inertia?', back: 'Resistance to change of motion.', kindTag: 'definition' as const },
    { front: 'State the second law', back: 'F = ma.', kindTag: 'fact' as const },
    { front: 'Unit of force', back: 'newton (N).', kindTag: 'fact' as const },
  ],
}
const TEST = {
  kind: 'mini-test' as const,
  title: 'Quick check',
  questions: [
    { prompt: 'Q1?', options: ['a', 'b', 'c'], correctIndex: 1, explanation: 'Because b.', difficulty: 'foundation' as const },
    { prompt: 'Q2?', options: ['x', 'y'], correctIndex: 0, explanation: 'Because x.' },
  ],
  honestyNote: 'Self-check note.',
}

const GUEST = 'g-phase3f-store'

beforeEach(() => {
  rows.length = 0
  seq = 0
})

async function seed(kind: string, snapshot: unknown, opts: Partial<StudioActivityRow> = {}) {
  const row = toRow({ guestId: GUEST, kind, topic: opts.topic ?? 'Motion', activityJson: JSON.stringify(snapshot), ...opts })
  rows.push(row)
  return row
}

// ─── P1: create/restore every kind ────────────────────────────────────────────

describe('Phase 3F store — persistence round-trips', () => {
  it('P1. saves and restores every activity kind with an intact snapshot', async () => {
    const kinds: [string, unknown][] = [
      ['concept-map', MAP],
      ['steps', STEPS],
      ['formula', FORMULA_VERIFIED],
      ['flashcards', CARDS],
      ['mini-test', TEST],
    ]
    for (const [kind, snapshot] of kinds) {
      const id = await saveGeneratedActivity({ guestId: GUEST, activity: snapshot as never, topic: 'Motion', grounding: 'document', documentTitle: 'Physics Essentials', responseLanguage: 'auto' })
      const record = await getStudioActivity(GUEST, id)
      expect(record).not.toBeNull()
      expect(record!.kind).toBe(kind)
      expect(record!.status).toBe('IN_PROGRESS')
      expect(record!.activity).toEqual(snapshot)
      expect(record!.documentTitle).toBe('Physics Essentials')
      expect(record!.result).toBeNull()
    }
  })

  it('P7. restores records whose source document no longer exists (snapshot-based resume)', async () => {
    const row = await seed('steps', STEPS, { documentId: 'doc-deleted', documentTitle: 'Deleted doc' })
    const record = await getStudioActivity(GUEST, row.id)
    expect(record).not.toBeNull()
    expect(record!.documentId).toBe('doc-deleted')
    expect(record!.documentTitle).toBe('Deleted doc')
    expect(record!.activity).toEqual(STEPS)
  })
})

// ─── P2: progress save/restore per kind ───────────────────────────────────────

describe('Phase 3F store — progress save/restore', () => {
  it('P2a. concept-map progress restores selection and expanded set (unknown ids dropped)', async () => {
    const row = await seed('concept-map', MAP)
    await saveStudioProgress(GUEST, row.id, { selectedNodeId: 'n3', expandedIds: ['n1', 'n2', 'ghost'] })
    const record = await getStudioActivity(GUEST, row.id)
    expect(record!.progress).toEqual({ selectedNodeId: 'n3', expandedIds: ['n1', 'n2'] })
  })

  it('P2b. steps progress is clamped into the snapshot range', async () => {
    const row = await seed('steps', STEPS)
    await saveStudioProgress(GUEST, row.id, { stepIndex: 99, maxStepReached: 2 })
    const record = await getStudioActivity(GUEST, row.id)
    expect(record!.progress).toEqual({ stepIndex: 2, maxStepReached: 2 })
    await expect(saveStudioProgress(GUEST, row.id, 'not an object')).rejects.toMatchObject({ status: 400 })
  })

  it('P2c. flashcards progress requires a valid order permutation and keeps the reviewed set', async () => {
    const row = await seed('flashcards', CARDS)
    await saveStudioProgress(GUEST, row.id, { order: [2, 0, 1], index: 1, revealed: true, reviewed: [2, 2, 0] })
    const record = await getStudioActivity(GUEST, row.id)
    expect(record!.progress).toEqual({ order: [2, 0, 1], index: 1, revealed: true, reviewed: [2, 0] })
    // A non-permutation is malformed.
    await expect(saveStudioProgress(GUEST, row.id, { order: [0, 0, 1], index: 0, revealed: false, reviewed: [] }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('P2d. mini-test progress validates lengths and option ranges', async () => {
    const row = await seed('mini-test', TEST)
    await saveStudioProgress(GUEST, row.id, { index: 1, answers: [1, null], submitted: [true, false], finished: false })
    const record = await getStudioActivity(GUEST, row.id)
    expect(record!.progress).toEqual({ index: 1, answers: [1, null], submitted: [true, false], finished: false })
    await expect(saveStudioProgress(GUEST, row.id, { index: 0, answers: [9, null], submitted: [false, false], finished: false }))
      .rejects.toMatchObject({ status: 400 }) // 9 is outside Q1's 3 options
    await expect(saveStudioProgress(GUEST, row.id, { index: 0, answers: [1], submitted: [true, false], finished: false }))
      .rejects.toMatchObject({ status: 400 }) // wrong length
  })

  it('P2e. formula walkthroughs carry no progress (single static view)', async () => {
    const row = await seed('formula', FORMULA_VERIFIED)
    await saveStudioProgress(GUEST, row.id, {})
    const record = await getStudioActivity(GUEST, row.id)
    expect(record!.progress).toEqual({})
  })
})

// ─── P3/P4: lifecycle ─────────────────────────────────────────────────────────

describe('Phase 3F store — lifecycle', () => {
  it('P3a. a mini-test completes exactly once with a server-recomputed score; re-submission is idempotent', async () => {
    const row = await seed('mini-test', TEST)
    const first = await completeStudioActivity(GUEST, row.id, { answers: [1, null] })
    expect(first.alreadyCompleted).toBe(false)
    expect(first.record.status).toBe('COMPLETED')
    expect(first.record.result).toEqual({ type: 'mini-test', correct: 1, answered: 1, total: 2, percent: 50 })

    // A repeated submission (double click, retry, stale client) can neither
    // create a second completion nor change the recorded score — even with
    // different answers.
    const second = await completeStudioActivity(GUEST, row.id, { answers: [0, 0] })
    expect(second.alreadyCompleted).toBe(true)
    expect(second.record.result).toEqual(first.record.result)
    const listed = await listStudioActivities(GUEST)
    expect(listed.items.filter(i => i.status === 'COMPLETED')).toHaveLength(1)
  })

  it('P3b. flashcard completion stores self-marked recall exactly once', async () => {
    const row = await seed('flashcards', CARDS)
    const { record } = await completeStudioActivity(GUEST, row.id, { selfRecall: { 0: 'recalled', 1: 'missed' } })
    expect(record.result).toEqual({ type: 'flashcards', cardsTotal: 3, cardsReviewed: 2, recalled: 1, missed: 1 })
    const again = await completeStudioActivity(GUEST, row.id, { selfRecall: { 0: 'recalled', 1: 'recalled', 2: 'recalled' } })
    expect(again.alreadyCompleted).toBe(true)
    expect(again.record.result).toEqual(record.result)
  })

  it('P4a. completing an abandoned activity is rejected 409', async () => {
    const row = await seed('steps', STEPS)
    await abandonStudioActivity(GUEST, row.id)
    await expect(completeStudioActivity(GUEST, row.id, null)).rejects.toMatchObject({ status: 409 })
  })

  it('P4b. abandoning a completed activity is rejected 409 (completion is protected)', async () => {
    const row = await seed('steps', STEPS)
    await completeStudioActivity(GUEST, row.id, null)
    await expect(abandonStudioActivity(GUEST, row.id)).rejects.toMatchObject({ status: 409 })
  })

  it('P4c. progress cannot be saved on terminal rows', async () => {
    const row = await seed('steps', STEPS)
    await completeStudioActivity(GUEST, row.id, null)
    await expect(saveStudioProgress(GUEST, row.id, { stepIndex: 1, maxStepReached: 1 })).rejects.toMatchObject({ status: 409 })
  })

  it('P4d. abandon is idempotent on an already-abandoned row', async () => {
    const row = await seed('steps', STEPS)
    await abandonStudioActivity(GUEST, row.id)
    await expect(abandonStudioActivity(GUEST, row.id)).resolves.toBeUndefined()
    const record = await getStudioActivity(GUEST, row.id)
    expect(record!.status).toBe('ABANDONED')
  })

  it('P4e. no client-supplied status exists in the contract — unknown payloads are 400', async () => {
    const row = await seed('steps', STEPS)
    // A client cannot POST a status transition: neither progress nor action.
    await expect(saveStudioProgress(GUEST, row.id, undefined)).rejects.toMatchObject({ status: 400 })
  })
})

// ─── P5: evidence honesty ─────────────────────────────────────────────────────

describe('Phase 3F store — evidence honesty', () => {
  it('P5a. flashcard completion with zero marks records zero evidence — a reveal alone is never recall', async () => {
    const row = await seed('flashcards', CARDS)
    // Progress says every card was revealed/reviewed…
    await saveStudioProgress(GUEST, row.id, { order: [0, 1, 2], index: 2, revealed: true, reviewed: [0, 1, 2] })
    // …but without self-marks, completion records review only — no recall.
    const { record } = await completeStudioActivity(GUEST, row.id, {})
    expect(record.result).toEqual({ type: 'flashcards', cardsTotal: 3, cardsReviewed: 0, recalled: 0, missed: 0 })
    expect(record.responses).toEqual({ selfRecall: {} })
  })

  it('P5b. recall marks outside the card range are malformed (no invented evidence)', async () => {
    const row = await seed('flashcards', CARDS)
    await expect(completeStudioActivity(GUEST, row.id, { selfRecall: { 7: 'recalled' } })).rejects.toMatchObject({ status: 400 })
  })

  it('P5c. formula verified/illustrative is copied from the validated snapshot, never upgraded', async () => {
    const verified = await seed('formula', FORMULA_VERIFIED)
    const { record: v } = await completeStudioActivity(GUEST, verified.id, null)
    expect(v.result).toEqual({ type: 'formula', verified: true, illustrative: false })

    const illustrative = await seed('formula', FORMULA_ILLUSTRATIVE)
    const { record: i } = await completeStudioActivity(GUEST, illustrative.id, null)
    expect(i.result).toEqual({ type: 'formula', verified: false, illustrative: true })
  })

  it('P5d. concept-map and steps completions carry no correctness claims', async () => {
    const mapRow = await seed('concept-map', MAP)
    const { record: m } = await completeStudioActivity(GUEST, mapRow.id, null)
    expect(m.result).toEqual({ type: 'concept-map', conceptsTotal: 3 })

    const stepsRow = await seed('steps', STEPS)
    await saveStudioProgress(GUEST, stepsRow.id, { stepIndex: 2, maxStepReached: 2 })
    const { record: s } = await completeStudioActivity(GUEST, stepsRow.id, null)
    expect(s.result).toEqual({ type: 'steps', stepsStudied: 3, stepsTotal: 3 })
  })

  it('P5e. an abandoned mini-test is distinguishable from a completed one', async () => {
    const done = await seed('mini-test', TEST, { topic: 'Done' })
    await completeStudioActivity(GUEST, done.id, { answers: [1, 0] })
    const abandoned = await seed('mini-test', TEST, { topic: 'Abandoned' })
    await saveStudioProgress(GUEST, abandoned.id, { index: 0, answers: [0, null], submitted: [true, false], finished: false })
    await abandonStudioActivity(GUEST, abandoned.id)

    const listed = await listStudioActivities(GUEST)
    const doneItem = listed.items.find(i => i.topic === 'Done')!
    const abandonedItem = listed.items.find(i => i.topic === 'Abandoned')!
    expect(doneItem.status).toBe('COMPLETED')
    expect(doneItem.result?.type).toBe('mini-test')
    expect(abandonedItem.status).toBe('ABANDONED')
    expect(abandonedItem.result).toBeNull()
    expect(abandonedItem.completedAt).toBeUndefined()
  })

  it('P5f. responses for kinds without objective evaluation are rejected outright', async () => {
    const mapRow = await seed('concept-map', MAP)
    await expect(completeStudioActivity(GUEST, mapRow.id, { score: 100 })).rejects.toMatchObject({ status: 400 })
    const stepsRow = await seed('steps', STEPS)
    await expect(completeStudioActivity(GUEST, stepsRow.id, { correct: 5 })).rejects.toMatchObject({ status: 400 })
  })
})

// ─── P6: ownership at the store boundary ──────────────────────────────────────

describe('Phase 3F store — ownership scoping', () => {
  it('P6a. a valid activity id belonging to another guest is 404 for reads, updates, completion and deletion', async () => {
    const row = await seed('steps', STEPS)
    const foreign = 'g-someone-else-entirely'

    await expect(getStudioActivity(foreign, row.id)).resolves.toBeNull()
    await expect(saveStudioProgress(foreign, row.id, { stepIndex: 0, maxStepReached: 0 })).rejects.toMatchObject({ status: 404 })
    await expect(completeStudioActivity(foreign, row.id, null)).rejects.toMatchObject({ status: 404 })
    await expect(abandonStudioActivity(foreign, row.id)).rejects.toMatchObject({ status: 404 })
    await expect(deleteStudioActivity(foreign, row.id)).rejects.toMatchObject({ status: 404 })

    // The owner's record is untouched by every foreign attempt.
    const record = await getStudioActivity(GUEST, row.id)
    expect(record).not.toBeNull()
    expect(record!.status).toBe('IN_PROGRESS')
  })

  it('P6b. cross-account updates and deletion are rejected even for same-kind records', async () => {
    const mine = await seed('flashcards', CARDS)
    const theirs = await seed('flashcards', CARDS, { guestId: 'g-other' })
    // Same kind, same shape, different owner — no cross-over either way.
    await expect(saveStudioProgress('g-other', mine.id, { order: [0, 1, 2], index: 0, revealed: false, reviewed: [] })).rejects.toMatchObject({ status: 404 })
    await expect(deleteStudioActivity('g-other', mine.id)).rejects.toMatchObject({ status: 404 })
    const mineAfter = await getStudioActivity(GUEST, mine.id)
    expect(mineAfter).not.toBeNull()
    const theirsAfter = await getStudioActivity('g-other', theirs.id)
    expect(theirsAfter).not.toBeNull()
  })
})

// ─── P8: evidence roll-up ─────────────────────────────────────────────────────

describe('Phase 3F store — evidence roll-up', () => {
  it('P8. summarizes statuses and honest evidence counts', async () => {
    const summary: StudioEvidenceSummaryDTO = summarizeEvidence([
      { id: '1', kind: 'mini-test', topic: 'T', status: 'COMPLETED', grounding: 'document', createdAt: '', updatedAt: '', result: { type: 'mini-test', correct: 4, answered: 5, total: 5, percent: 80 } as StudioActivityResult },
      { id: '2', kind: 'mini-test', topic: 'T', status: 'COMPLETED', grounding: 'general', createdAt: '', updatedAt: '', result: { type: 'mini-test', correct: 2, answered: 4, total: 5, percent: 40 } as StudioActivityResult },
      { id: '3', kind: 'flashcards', topic: 'T', status: 'IN_PROGRESS', grounding: 'document', createdAt: '', updatedAt: '', result: null },
      { id: '4', kind: 'flashcards', topic: 'T', status: 'COMPLETED', grounding: 'general', createdAt: '', updatedAt: '', result: { type: 'flashcards', cardsTotal: 6, cardsReviewed: 6, recalled: 4, missed: 2 } as StudioActivityResult },
      { id: '5', kind: 'steps', topic: 'T', status: 'ABANDONED', grounding: 'document', createdAt: '', updatedAt: '', result: null },
    ])
    expect(summary).toEqual({
      total: 5,
      inProgress: 1,
      completed: 3,
      abandoned: 1,
      miniTestsCompleted: 2,
      miniTestPercentAvg: 60,
      cardsReviewed: 6,
      cardsRecalled: 4,
    })
  })
})
