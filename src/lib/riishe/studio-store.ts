// ─── Riishe Phase 3F: Learning Studio continuity — server-side store ─────────
// Persistence for ONE generated Studio activity: the server-validated snapshot
// (never raw model output), learner progress, learner response evidence and a
// server-computed completion summary, under a server-enforced lifecycle.
//
// Ownership boundary (Phase 3B.1/3D.1 contract):
//   - Every function scopes reads AND writes by { id, guestId } — a client-
//     supplied activity id can never reach another guest's row (unknown pair
//     is indistinguishable from a missing one: 404, no existence leak).
//   - The API routes call assertLearningOwner(guestId) BEFORE calling into
//     this module, so a signed-in foreign claimant is rejected before any
//     database read happens at all. This module is defence in depth.
//   - Rows are guestId-first and never stamped with studentId at creation;
//     claim-guest stamps them exactly like every other learner table.
//
// Lifecycle (server-enforced, no client-supplied status field):
//   created → IN_PROGRESS (on generation)
//   IN_PROGRESS → COMPLETED (explicit complete intent; validated responses;
//                idempotent — a repeated completion returns the stored result
//                unchanged and never re-records)
//   IN_PROGRESS → ABANDONED (explicit abandon intent)
//   COMPLETED and ABANDONED are terminal. Any other transition is rejected.
//
// Evidence honesty (Phase 3F Part 4):
//   - mini-test scores are recomputed server-side from the validated snapshot;
//     client scores are never trusted or stored.
//   - flashcard recall is SELF-marked and recorded only per card; a reveal
//     without a mark stays review, never evidence.
//   - concept maps, step walks and formula walkthroughs carry no correctness
//     claims — their summaries are factual (counts, verified/illustrative
//     flags copied from the validated snapshot).
//   - NOTHING here writes Attempt / TopicMastery / RevisionScheduleItem /
//     MistakeRecord / LearningAction rows. Studio completion cannot inflate
//     exam mastery, attempts or the digest — by design.

import { z } from 'zod'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { gradeTypedRecall, scoreMiniTest } from '@/lib/riishe/studio-types'
import {
  STUDIO_SCHEMA_VERSION,
  type StudioActivity,
  type StudioActivityResult,
  type StudioActivityResponses,
  type StudioEvidenceSummaryDTO,
  type StudioGradedRecallSummary,
  type StudioHistoryItemDTO,
  type StudioActivityRecordDTO,
  type StudioActivityStatus,
} from '@/lib/riishe/studio-types'

/** Typed error the API routes map straight to a response status. */
export class StudioStoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const ACTIVITY_KINDS = ['concept-map', 'steps', 'formula', 'flashcards', 'mini-test'] as const
const STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'] as const

const idSchema = z.string().min(1).max(64)

// ─── Row shape (the mock-friendly subset the store touches) ───────────────────

export interface StudioActivityRow {
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

function normalizeKind(raw: string): (typeof ACTIVITY_KINDS)[number] | null {
  return (ACTIVITY_KINDS as readonly string[]).includes(raw) ? (raw as (typeof ACTIVITY_KINDS)[number]) : null
}

function normalizeStatus(raw: string): StudioActivityStatus {
  return (STATUSES as readonly string[]).includes(raw) ? (raw as StudioActivityStatus) : 'IN_PROGRESS'
}

function normalizeGrounding(raw: string): 'document' | 'general' {
  return raw === 'document' ? 'document' : 'general'
}

/** Re-validate a stored snapshot defensively — malformed rows never render. */
function parseActivitySnapshot(row: StudioActivityRow): StudioActivity | null {
  const kind = normalizeKind(row.kind)
  if (!kind) return null
  const parsed = safeParse<StudioActivity | null>(row.activityJson, null)
  if (!parsed || parsed.kind !== kind) return null
  return parsed
}

// ─── Per-kind validation (progress + responses) ───────────────────────────────
// Shapes are validated against the STORED SNAPSHOT (counts, ranges, order
// permutations) so a malformed or hostile payload can never corrupt state.

const conceptMapProgressSchema = z.object({
  selectedNodeId: z.string().min(1).max(200).optional(),
  expandedIds: z.array(z.string().min(1).max(200)).max(200).optional(),
})

const stepsProgressSchema = z.object({
  stepIndex: z.number().int().min(0),
  maxStepReached: z.number().int().min(0),
})

const flashcardsProgressSchema = z.object({
  order: z.array(z.number().int().min(0)).max(200),
  index: z.number().int().min(0),
  revealed: z.boolean(),
  /** Card indexes revealed so far (the reviewed set — restored on resume). */
  reviewed: z.array(z.number().int().min(0)).max(200),
})

const miniTestProgressSchema = z.object({
  index: z.number().int().min(0),
  answers: z.array(z.number().int().min(0).max(9).nullable()),
  submitted: z.array(z.boolean()),
  finished: z.boolean(),
})

const flashcardResponsesSchema = z.object({
  // Absent/empty marks = zero recall evidence (a reveal alone is never recall).
  selfRecall: z.record(z.string().regex(/^\d{1,3}$/), z.enum(['recalled', 'missed'])).default({}),
  // Phase 3G: what the learner typed before revealing, per card index. Empty
  // strings are dropped by validation below (no attempt = no evidence); each
  // entry is capped to keep the stored row small.
  typedRecall: z.record(z.string().regex(/^\d{1,3}$/), z.string().max(2000)).default({}),
})

const miniTestResponsesSchema = z.object({
  answers: z.array(z.number().int().min(0).max(9).nullable()),
})

export type ValidatedProgress = Record<string, unknown>
export type ValidatedResponses = NonNullable<StudioActivityResponses>

/**
 * Validate a client progress payload against the stored snapshot.
 * Returns the normalized object to persist, or null when nothing useful was
 * sent. Throws StudioStoreError(400) on malformed payloads.
 */
function validateProgress(
  kind: (typeof ACTIVITY_KINDS)[number],
  snapshot: StudioActivity,
  raw: unknown,
): ValidatedProgress {
  if (kind === 'formula') {
    // The formula walkthrough is a single static view — no progress to save.
    return {}
  }
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new StudioStoreError(400, 'Invalid request')
  }

  if (kind === 'concept-map') {
    const parsed = conceptMapProgressSchema.safeParse(raw)
    if (!parsed.success) throw new StudioStoreError(400, 'Invalid request')
    const nodeIds = new Set(snapshot.kind === 'concept-map' ? snapshot.nodes.map(n => n.id) : [])
    const selectedNodeId = parsed.data.selectedNodeId && nodeIds.has(parsed.data.selectedNodeId)
      ? parsed.data.selectedNodeId
      : undefined
    const expandedIds = (parsed.data.expandedIds ?? []).filter(id => nodeIds.has(id))
    return {
      ...(selectedNodeId ? { selectedNodeId } : {}),
      expandedIds,
    }
  }

  if (kind === 'steps') {
    const parsed = stepsProgressSchema.safeParse(raw)
    if (!parsed.success) throw new StudioStoreError(400, 'Invalid request')
    const total = snapshot.kind === 'steps' ? snapshot.steps.length : 0
    if (total === 0) throw new StudioStoreError(400, 'Invalid request')
    const stepIndex = Math.min(parsed.data.stepIndex, total - 1)
    const maxStepReached = Math.min(parsed.data.maxStepReached, total - 1)
    return { stepIndex, maxStepReached: Math.max(maxStepReached, stepIndex) }
  }

  if (kind === 'flashcards') {
    const parsed = flashcardsProgressSchema.safeParse(raw)
    if (!parsed.success) throw new StudioStoreError(400, 'Invalid request')
    const total = snapshot.kind === 'flashcards' ? snapshot.cards.length : 0
    if (total === 0 || parsed.data.order.length !== total) throw new StudioStoreError(400, 'Invalid request')
    // `order` must be a permutation of 0..total-1 — anything else is malformed.
    const seen = new Set(parsed.data.order)
    if (seen.size !== total || parsed.data.order.some(i => i < 0 || i >= total)) {
      throw new StudioStoreError(400, 'Invalid request')
    }
    const index = Math.min(parsed.data.index, total - 1)
    // Reviewed set: deduped, range-checked card indexes (revealed so far).
    const reviewed = [...new Set(parsed.data.reviewed)].filter(i => i < total)
    return { order: parsed.data.order, index, revealed: parsed.data.revealed, reviewed }
  }

  // mini-test
  const parsed = miniTestProgressSchema.safeParse(raw)
  if (!parsed.success) throw new StudioStoreError(400, 'Invalid request')
  const total = snapshot.kind === 'mini-test' ? snapshot.questions.length : 0
  if (total === 0 || parsed.data.answers.length !== total || parsed.data.submitted.length !== total) {
    throw new StudioStoreError(400, 'Invalid request')
  }
  // Every chosen option must be inside the question's option range.
  if (snapshot.kind === 'mini-test') {
    for (let i = 0; i < total; i++) {
      const a = parsed.data.answers[i]
      if (a != null && a >= snapshot.questions[i].options.length) {
        throw new StudioStoreError(400, 'Invalid request')
      }
    }
  }
  return {
    index: Math.min(parsed.data.index, total - 1),
    answers: parsed.data.answers,
    submitted: parsed.data.submitted,
    finished: parsed.data.finished,
  }
}

/**
 * Validate a client responses payload against the stored snapshot.
 * Throws StudioStoreError(400) on malformed payloads.
 */
function validateResponses(
  kind: (typeof ACTIVITY_KINDS)[number],
  snapshot: StudioActivity,
  raw: unknown,
): ValidatedResponses {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new StudioStoreError(400, 'Invalid request')
  }

  if (kind === 'flashcards') {
    const parsed = flashcardResponsesSchema.safeParse(raw)
    if (!parsed.success) throw new StudioStoreError(400, 'Invalid request')
    const total = snapshot.kind === 'flashcards' ? snapshot.cards.length : 0
    const selfRecall: Record<string, 'recalled' | 'missed'> = {}
    for (const [key, value] of Object.entries(parsed.data.selfRecall)) {
      const idx = Number(key)
      if (!Number.isInteger(idx) || idx < 0 || idx >= total) {
        throw new StudioStoreError(400, 'Invalid request')
      }
      selfRecall[String(idx)] = value
    }
    // Phase 3G: typed answers are validated against the same index bounds.
    // Whitespace-only entries are dropped (an attempt that was never made is
    // not evidence); everything else is stored trimmed, verbatim.
    const typedRecall: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed.data.typedRecall)) {
      const idx = Number(key)
      if (!Number.isInteger(idx) || idx < 0 || idx >= total) {
        throw new StudioStoreError(400, 'Invalid request')
      }
      const trimmed = value.trim()
      if (trimmed.length > 0) typedRecall[String(idx)] = trimmed
    }
    return { selfRecall, ...(Object.keys(typedRecall).length > 0 ? { typedRecall } : {}) }
  }

  if (kind === 'mini-test') {
    const parsed = miniTestResponsesSchema.safeParse(raw)
    if (!parsed.success) throw new StudioStoreError(400, 'Invalid request')
    if (snapshot.kind !== 'mini-test' || parsed.data.answers.length !== snapshot.questions.length) {
      throw new StudioStoreError(400, 'Invalid request')
    }
    for (let i = 0; i < snapshot.questions.length; i++) {
      const a = parsed.data.answers[i]
      if (a != null && a >= snapshot.questions[i].options.length) {
        throw new StudioStoreError(400, 'Invalid request')
      }
    }
    return { answers: parsed.data.answers }
  }

  // concept-map / steps / formula: no objective learner responses exist —
  // recording any would invent evidence. Completion for these kinds carries
  // no responses payload at all.
  throw new StudioStoreError(400, 'Invalid request')
}

// ─── Server-computed result summaries ─────────────────────────────────────────

function computeResult(kind: (typeof ACTIVITY_KINDS)[number], snapshot: StudioActivity, responses: ValidatedResponses | null, progress: ValidatedProgress | null): StudioActivityResult {
  if (kind === 'mini-test' && snapshot.kind === 'mini-test') {
    // The ONLY score in the system is recomputed here, server-side, from the
    // validated snapshot + validated answers. Client scores are never stored.
    const answers = responses?.answers ?? (progress?.answers as (number | null)[] | undefined) ?? snapshot.questions.map(() => null)
    const score = scoreMiniTest(snapshot.questions, answers)
    return { type: 'mini-test', correct: score.correct, answered: score.answered, total: score.total, percent: score.percent }
  }
  if (kind === 'flashcards' && snapshot.kind === 'flashcards') {
    const marks = responses?.selfRecall ?? {}
    const marked = Object.keys(marks)
    const recalled = marked.filter(k => marks[k] === 'recalled').length
    // Phase 3G: graded-recall counts are recomputed here, server-side, from
    // the stored snapshot + validated typed answers via the SAME pure helper
    // the UI uses for immediate feedback. Client verdicts are never stored.
    // The graded block is present only when at least one card was attempted.
    const typed = responses?.typedRecall ?? {}
    const typedKeys = Object.keys(typed)
    let graded: StudioGradedRecallSummary | undefined
    if (typedKeys.length > 0) {
      let correct = 0
      let partial = 0
      let incorrect = 0
      for (const key of typedKeys) {
        const card = snapshot.cards[Number(key)]
        const verdict = card ? gradeTypedRecall(card.back, typed[key]) : 'incorrect'
        if (verdict === 'correct') correct++
        else if (verdict === 'partial') partial++
        else incorrect++
      }
      graded = { attempted: typedKeys.length, correct, partial, incorrect }
    }
    return {
      type: 'flashcards',
      cardsTotal: snapshot.cards.length,
      cardsReviewed: marked.length,
      recalled,
      missed: marked.length - recalled,
      ...(graded ? { graded } : {}),
    }
  }
  if (kind === 'steps' && snapshot.kind === 'steps') {
    const maxReached = typeof progress?.maxStepReached === 'number' ? progress.maxStepReached : -1
    return { type: 'steps', stepsStudied: Math.min(Math.max(maxReached + 1, 0), snapshot.steps.length), stepsTotal: snapshot.steps.length }
  }
  if (kind === 'formula' && snapshot.kind === 'formula') {
    // Verified/illustrative distinction is copied verbatim from the validated
    // snapshot — never recomputed, never upgraded. No result row = illustrative.
    const result = snapshot.result
    return {
      type: 'formula',
      verified: result?.verified === true,
      illustrative: result ? result.illustrative : true,
    }
  }
  // concept-map: factual context only (map size) — no correctness, no mastery.
  return { type: 'concept-map', conceptsTotal: snapshot.kind === 'concept-map' ? snapshot.nodes.length : 0 }
}

// ─── DTO mappers ──────────────────────────────────────────────────────────────

function toHistoryItem(row: StudioActivityRow, snapshot: StudioActivity | null): StudioHistoryItemDTO {
  const kind = normalizeKind(row.kind)
  return {
    id: row.id,
    kind: kind ?? 'concept-map',
    topic: row.topic,
    status: normalizeStatus(row.status),
    grounding: normalizeGrounding(row.grounding),
    ...(row.documentTitle ? { documentTitle: row.documentTitle } : {}),
    ...(row.responseLanguage ? { responseLanguage: row.responseLanguage as StudioHistoryItemDTO['responseLanguage'] } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    result: row.resultJson ? safeParse<StudioActivityResult | null>(row.resultJson, null) : null,
    // The kind tag rides on the result; a malformed snapshot keeps the row
    // listed (status/times stay truthful) with its stored result summary.
    ...(snapshot === null && kind === null ? {} : {}),
  }
}

function toRecord(row: StudioActivityRow, snapshot: StudioActivity | null): StudioActivityRecordDTO | null {
  if (!snapshot) return null
  const item = toHistoryItem(row, snapshot)
  return {
    ...item,
    ...(row.documentId ? { documentId: row.documentId } : {}),
    activity: snapshot,
    progress: row.progressJson ? safeParse<Record<string, unknown> | null>(row.progressJson, null) : null,
    responses: row.responsesJson ? safeParse<StudioActivityResponses | null>(row.responsesJson, null) : null,
  }
}

// ─── Evidence roll-up (bounded, honest) ───────────────────────────────────────

export function summarizeEvidence(items: StudioHistoryItemDTO[]): StudioEvidenceSummaryDTO {
  const summary: StudioEvidenceSummaryDTO = {
    total: items.length,
    inProgress: 0,
    completed: 0,
    abandoned: 0,
    miniTestsCompleted: 0,
    miniTestPercentAvg: null,
    cardsReviewed: 0,
    cardsRecalled: 0,
  }
  let percentSum = 0
  for (const item of items) {
    if (item.status === 'IN_PROGRESS') summary.inProgress++
    else if (item.status === 'COMPLETED') summary.completed++
    else summary.abandoned++
    if (item.result?.type === 'mini-test') {
      summary.miniTestsCompleted++
      percentSum += item.result.percent
    }
    if (item.result?.type === 'flashcards') {
      summary.cardsReviewed += item.result.cardsReviewed
      summary.cardsRecalled += item.result.recalled
    }
  }
  if (summary.miniTestsCompleted > 0) {
    summary.miniTestPercentAvg = Math.round(percentSum / summary.miniTestsCompleted)
  }
  return summary
}

// ─── Store API (all reads/writes scoped by { id, guestId }) ───────────────────

/** Persist a freshly generated + validated activity. Returns the new record id. */
export async function saveGeneratedActivity(input: {
  guestId: string
  activity: StudioActivity
  topic: string
  grounding: 'document' | 'general'
  documentId?: string | null
  documentTitle?: string | null
  responseLanguage?: string | null
}): Promise<string> {
  const row = await db.riisheStudioActivity.create({
    data: {
      guestId: input.guestId,
      kind: input.activity.kind,
      topic: input.topic,
      status: 'IN_PROGRESS',
      grounding: input.grounding,
      documentId: input.documentId ?? null,
      documentTitle: input.documentTitle ?? null,
      responseLanguage: input.responseLanguage ?? null,
      activityVersion: STUDIO_SCHEMA_VERSION,
      activityJson: JSON.stringify(input.activity),
    },
  })
  return row.id
}

/** Compact history (most recently updated first) + honest evidence roll-up. */
export async function listStudioActivities(guestId: string, take = 50): Promise<{ items: StudioHistoryItemDTO[]; evidence: StudioEvidenceSummaryDTO }> {
  const rows = await db.riisheStudioActivity.findMany({
    where: { guestId },
    orderBy: { updatedAt: 'desc' },
    take,
  })
  const items = rows.map(r => toHistoryItem(r as StudioActivityRow, parseActivitySnapshot(r as StudioActivityRow)))
  return { items, evidence: summarizeEvidence(items) }
}

/** Full record for resume/review. Returns null when the id is not this guest's. */
export async function getStudioActivity(guestId: string, id: string): Promise<StudioActivityRecordDTO | null> {
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return null
  const row = (await db.riisheStudioActivity.findFirst({
    where: { id: parsedId.data, guestId },
  })) as StudioActivityRow | null
  if (!row) return null
  const snapshot = parseActivitySnapshot(row)
  // Touch last-accessed best-effort — never blocks or fails the read.
  try {
    await db.riisheStudioActivity.update({
      where: { id: row.id },
      data: { lastAccessedAt: new Date() },
    })
  } catch {
    // ignore
  }
  return toRecord(row, snapshot)
}

/** Save UI progress and/or interaction evidence on an IN_PROGRESS activity. */
export async function saveStudioProgress(
  guestId: string,
  id: string,
  rawProgress: unknown,
  rawResponses?: unknown,
): Promise<void> {
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) throw new StudioStoreError(404, 'Activity not found')
  const row = (await db.riisheStudioActivity.findFirst({
    where: { id: parsedId.data, guestId },
  })) as StudioActivityRow | null
  if (!row) throw new StudioStoreError(404, 'Activity not found')
  const kind = normalizeKind(row.kind)
  const snapshot = parseActivitySnapshot(row)
  if (!kind || !snapshot) throw new StudioStoreError(409, 'This activity can no longer be updated.')
  if (row.status !== 'IN_PROGRESS') {
    throw new StudioStoreError(409, 'Only an in-progress activity can be updated.')
  }
  if (rawProgress === undefined && rawResponses === undefined) {
    throw new StudioStoreError(400, 'Invalid request')
  }

  let progressJson: string | undefined
  let responsesJson: string | undefined
  if (rawProgress !== undefined) {
    progressJson = JSON.stringify(validateProgress(kind, snapshot, rawProgress))
  }
  if (rawResponses !== undefined) {
    // Evidence is only recorded for kinds with real learner responses; other
    // kinds reject any payload (no invented evidence).
    responsesJson = JSON.stringify(validateResponses(kind, snapshot, rawResponses))
  }

  await db.riisheStudioActivity.update({
    where: { id: row.id },
    data: {
      ...(progressJson !== undefined ? { progressJson } : {}),
      ...(responsesJson !== undefined ? { responsesJson } : {}),
      lastAccessedAt: new Date(),
    },
  })
}

/**
 * Complete an IN_PROGRESS activity exactly once. A repeated completion is
 * idempotent: the stored summary is returned unchanged, nothing is re-recorded,
 * and no duplicate completion row or score can appear.
 */
export async function completeStudioActivity(
  guestId: string,
  id: string,
  rawResponses: unknown,
): Promise<{ record: StudioActivityRecordDTO; alreadyCompleted: boolean }> {
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) throw new StudioStoreError(404, 'Activity not found')
  const row = (await db.riisheStudioActivity.findFirst({
    where: { id: parsedId.data, guestId },
  })) as StudioActivityRow | null
  if (!row) throw new StudioStoreError(404, 'Activity not found')
  const kind = normalizeKind(row.kind)
  const snapshot = parseActivitySnapshot(row)
  if (!kind || !snapshot) throw new StudioStoreError(409, 'This activity can no longer be updated.')

  if (row.status === 'COMPLETED') {
    const existing = toRecord(row, snapshot)
    if (!existing) throw new StudioStoreError(409, 'This activity can no longer be updated.')
    return { record: existing, alreadyCompleted: true }
  }
  if (row.status !== 'IN_PROGRESS') {
    // ABANDONED is terminal — a discarded activity cannot be completed.
    throw new StudioStoreError(409, 'A discarded activity cannot be completed.')
  }

  let responses: ValidatedResponses | null = null
  if (kind === 'flashcards' || kind === 'mini-test') {
    // The request payload wins; when absent, fall back to the stored evidence
    // (completion stays robust even if the client does not re-send marks).
    // Phase 3G, flashcards only: the merge is FIELD-level (selfRecall from the
    // request, typedRecall falls back to the stored evidence when the request
    // omits it) — typed answers saved mid-session must never be silently
    // dropped by a completion payload that only re-sends self-marks.
    const storedSource = row.responsesJson ? safeParse<Record<string, unknown> | null>(row.responsesJson, null) : null
    const requestSource = (rawResponses ?? null) as Record<string, unknown> | null
    const source =
      kind === 'flashcards' && requestSource !== null && typeof requestSource === 'object'
        ? { ...(storedSource ?? {}), ...requestSource }
        : (requestSource ?? storedSource)
    responses = validateResponses(kind, snapshot, source)
  } else if (rawResponses !== null && rawResponses !== undefined) {
    // These kinds have no objective responses — anything sent is malformed.
    throw new StudioStoreError(400, 'Invalid request')
  }

  const progress = row.progressJson ? safeParse<Record<string, unknown> | null>(row.progressJson, null) : null
  const result = computeResult(kind, snapshot, responses, progress)

  const updated = (await db.riisheStudioActivity.update({
    where: { id: row.id },
    data: {
      status: 'COMPLETED',
      ...(responses ? { responsesJson: JSON.stringify(responses) } : {}),
      resultJson: JSON.stringify(result),
      completedAt: new Date(),
      lastAccessedAt: new Date(),
    },
  })) as StudioActivityRow

  const record = toRecord(updated, snapshot)
  if (!record) throw new StudioStoreError(409, 'This activity can no longer be updated.')
  return { record, alreadyCompleted: false }
}

/** Abandon an IN_PROGRESS activity (explicit student action; idempotent). */
export async function abandonStudioActivity(guestId: string, id: string): Promise<void> {
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) throw new StudioStoreError(404, 'Activity not found')
  const row = (await db.riisheStudioActivity.findFirst({
    where: { id: parsedId.data, guestId },
  })) as StudioActivityRow | null
  if (!row) throw new StudioStoreError(404, 'Activity not found')
  if (row.status === 'ABANDONED') return // idempotent
  if (row.status !== 'IN_PROGRESS') {
    throw new StudioStoreError(409, 'A completed activity cannot be discarded.')
  }
  await db.riisheStudioActivity.update({
    where: { id: row.id },
    data: { status: 'ABANDONED', lastAccessedAt: new Date() },
  })
}

/** Hard-delete one history record (the row carries everything — no orphans). */
export async function deleteStudioActivity(guestId: string, id: string): Promise<void> {
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) throw new StudioStoreError(404, 'Activity not found')
  // deleteMany with the ownership scope: a foreign id deletes nothing (and
  // reports 404 — the caller cannot distinguish missing from foreign).
  const deleted = await db.riisheStudioActivity.deleteMany({
    where: { id: parsedId.data, guestId },
  })
  if (deleted.count === 0) throw new StudioStoreError(404, 'Activity not found')
}
