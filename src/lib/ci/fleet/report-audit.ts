// ─── BEAN Classroom Intelligence (CI-5G): privacy-masked classroom-report audit ──
// The pilot lets an authorised expert reviewer check whether BEAN's ACTUAL
// classroom evaluation reports are accurate against the evidence they cite —
// without ever exposing student personal data and without creating any new
// route around ownership checks.
//
// Hard rules:
//   • The reviewer sees the MASKED evidence view only: student names, emails,
//     private messages, individual academic histories and unrelated teacher
//     profile details are removed/masked. Class metadata is distinguished from
//     actual teaching evidence.
//   • The report version + a sha256 of the audited reportJson bind the review —
//     a changed report refuses (the reviewer audited a version they can prove).
//   • Findings are recorded as supported / unsupported / ambiguous, and the
//     dimensions with NO transcripts (spoken explanations, question handling,
//     individual comprehension, tone/pronunciation, real-time discussion) are
//     marked UNOBSERVABLE — reviewers are never asked to guess.
//   • The Evidence Auditor's findings stay preserved: a review never edits the
//     report; corrections are NEW audit rows.
//   • Teacher disputes flow through the EXISTING Trust workflow
//     (ClassroomEvaluationDispute) — this module creates no bypass.
//   • The pilot's fixture reports are clearly labelled synthetic classroom
//     fixtures (BEAN-authored); no hidden recording, no transcription.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ReviewerProfileRow } from './reviewers'

// ─── Structural DB view (report reads + audit writes) ────────────────────────

export interface ReportAuditDb {
  classroomEvaluationReport: {
    findFirst(args?: Record<string, unknown>): Promise<{
      id: string
      classSessionId: string
      version: number
      status: string
      reportJson: string
      insufficientEvidence: boolean
      requiresHumanReview: boolean
      createdAt: Date
    } | null>
  }
  classroomReportAuditReview: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findMany(args?: Record<string, unknown>): Promise<unknown[]>
  }
}

export function reportAuditDbFromPrisma(client: unknown): ReportAuditDb {
  return client as ReportAuditDb
}

// ─── Masking ─────────────────────────────────────────────────────────────────

/** Keys whose values are removed from any evidence object before reviewer display. */
const MASKED_KEYS = [
  'studentName', 'student_name', 'studentEmail', 'student_email', 'email', 'name',
  'teacherEmail', 'teacher_email', 'phone', 'privateMessage', 'private_message',
  'personalNote', 'personal_note', 'individualHistory', 'individual_history',
  'studentId', 'userId', 'user_id',
]

export interface MaskedReportView {
  reportId: string
  reportVersion: number
  reportChecksum: string
  insufficientEvidence: boolean
  requiresHumanReview: boolean
  classMetadata: Record<string, unknown> | null
  teachingEvidence: Record<string, unknown> | null
  evaluationFindings: unknown
  evidenceAuditorFindings: unknown
  missingEvidenceDisclosed: boolean
  unobservableDimensions: string[]
  maskingNote: string
}

function deepMask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepMask)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (MASKED_KEYS.includes(k)) {
        out[k] = '[masked — not necessary for the review]'
      } else {
        out[k] = deepMask(v)
      }
    }
    return out
  }
  return value
}

/**
 * Dimensions BEAN's current observation model CANNOT observe (no transcripts,
 * structured-only observer): reviewers are told these are unobservable rather
 * than being asked to guess.
 */
export const UNOBSERVABLE_DIMENSIONS = [
  'every spoken explanation',
  'actual question handling',
  'every student interaction',
  'individual student comprehension',
  'teacher tone or pronunciation',
  'real-time classroom discussion quality',
]

/**
 * Build the masked, reviewer-safe view of one report version. The report
 * content is never modified — masking happens at read time, on the way to the
 * reviewer.
 */
export async function buildMaskedReportView(db: ReportAuditDb, reportId: string): Promise<
  | { ok: true; view: MaskedReportView }
  | { ok: false; status: number; error: string }
> {
  const report = await db.classroomEvaluationReport.findFirst({ where: { id: reportId } })
  if (!report) return { ok: false, status: 404, error: 'report not found' }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(report.reportJson) as Record<string, unknown>
  } catch {
    return { ok: false, status: 500, error: 'report payload is not valid JSON — audit refused' }
  }
  const checksum = createHash('sha256').update(report.reportJson).digest('hex')
  const view: MaskedReportView = {
    reportId: report.id,
    reportVersion: report.version,
    reportChecksum: checksum,
    insufficientEvidence: report.insufficientEvidence,
    requiresHumanReview: report.requiresHumanReview,
    classMetadata: deepMask(parsed.classMetadata ?? parsed.class_metadata ?? null) as Record<string, unknown> | null,
    teachingEvidence: deepMask(parsed.teachingEvidence ?? parsed.evidence ?? null) as Record<string, unknown> | null,
    evaluationFindings: deepMask(parsed.findings ?? parsed.evaluation ?? parsed.summary ?? null),
    evidenceAuditorFindings: deepMask(parsed.auditor ?? parsed.evidenceAuditor ?? null),
    missingEvidenceDisclosed: report.insufficientEvidence || parsed.insufficientEvidence === true,
    unobservableDimensions: UNOBSERVABLE_DIMENSIONS,
    maskingNote:
      'Student names, emails, private messages, individual academic histories and unrelated profile details are masked (not necessary for the review). Class metadata is separated from actual teaching evidence. Dimensions without transcripts are marked UNOBSERVABLE — the reviewer is never asked to guess.',
  }
  return { ok: true, view }
}

// ─── Recording the audit review ──────────────────────────────────────────────

const auditReviewSchema = z.object({
  reportId: z.string().min(3).max(80),
  reportChecksum: z.string().min(16).max(64),
  verdict: z.enum(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'NOT_SUPPORTED', 'CORRECTIONS_RECORDED']),
  supportedFindings: z.array(z.string().min(3).max(500)).max(30).default([]),
  unsupportedFindings: z.array(z.string().min(3).max(500)).max(30).default([]),
  ambiguousFindings: z.array(z.string().min(3).max(500)).max(30).default([]),
  unobservableMarkers: z.array(z.string().min(3).max(300)).max(30).default([]),
  rationale: z.string().min(20).max(2000),
}).strict()

export type ReportAuditResult =
  | { ok: true; reviewId: string }
  | { ok: false; status: number; error: string }

/**
 * Record an audit review of a report version. The checksum must match the
 * CURRENT stored report payload (a changed report refuses — corrections are
 * recorded against the new version as NEW audit rows). The Evidence Auditor's
 * findings are never touched.
 */
export async function recordClassroomReportAuditReview(
  db: ReportAuditDb,
  reviewer: ReviewerProfileRow,
  input: unknown,
  assignmentId?: string,
): Promise<ReportAuditResult> {
  const parsed = auditReviewSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid audit review: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  if (reviewer.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: `reviewer is ${reviewer.status} — only an ACTIVE reviewer records report audits` }
  }
  const data = parsed.data
  const view = await buildMaskedReportView(db, data.reportId)
  if (!view.ok) return view
  if (view.view.reportChecksum !== data.reportChecksum) {
    return { ok: false, status: 409, error: `the report changed since it was inspected (audited checksum ${data.reportChecksum.slice(0, 12)}… ≠ current ${view.view.reportChecksum.slice(0, 12)}…) — re-inspect; corrections for the new version are NEW audit rows` }
  }
  // A NOT_SUPPORTED / CORRECTIONS_RECORDED verdict must name concrete findings.
  if ((data.verdict === 'NOT_SUPPORTED' || data.verdict === 'CORRECTIONS_RECORDED') && data.unsupportedFindings.length === 0) {
    return { ok: false, status: 400, error: 'a NOT_SUPPORTED / CORRECTIONS_RECORDED verdict requires concrete unsupported findings — name what the report claims without evidence' }
  }
  const created = await db.classroomReportAuditReview.create({
    data: {
      reportId: view.view.reportId,
      reportVersion: view.view.reportVersion,
      reportChecksum: view.view.reportChecksum,
      reviewerStudentId: reviewer.studentId,
      reviewerCode: reviewer.reviewerCode,
      assignmentId: assignmentId ?? null,
      verdict: data.verdict,
      supportedFindings: JSON.stringify(data.supportedFindings),
      unsupportedFindings: JSON.stringify(data.unsupportedFindings),
      ambiguousFindings: JSON.stringify(data.ambiguousFindings),
      unobservableMarkers: JSON.stringify(data.unobservableMarkers.length ? data.unobservableMarkers : UNOBSERVABLE_DIMENSIONS),
      evidenceAuditorFindingsPreserved: true,
      rationale: data.rationale,
      maskingNote: view.view.maskingNote,
    },
  })
  return { ok: true, reviewId: created.id }
}
