// ─── BEAN Classroom Intelligence (CI-5D): expert pack-review rubric ───────────
// Every expert pack review must cover the charter's six sections (A–F). The
// rubric is STRUCTURED: the reviewer records per-section status (OK / ISSUE /
// NOT_ASSESSED) with notes, and the decision rules are enforced in code:
//   • APPROVED requires every section OK (NOT_ASSESSED and ISSUE both refuse).
//   • REJECTED requires at least one ISSUE (a rejection must name its reason).
//   • CHANGES_REQUESTED / RE_REVIEW_REQUESTED require at least one ISSUE or
//     NOT_ASSESSED section (there must be something to change / re-inspect).
// The rubric JSON is stored INSIDE the append-only ClassroomPackReview evidence
// field — the CI-4C append-only decision ledger remains the single authority;
// no alternative store or API exists.

import { z } from 'zod'

export interface RubricSection {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  title: string
  items: string[]
}

export const PACK_REVIEW_RUBRIC: readonly RubricSection[] = [
  {
    id: 'A',
    title: 'Domain scope',
    items: [
      'subject classification is correct',
      'profession relationships are correct',
      'prerequisites are correct',
      'competency levels are correct',
      'no unsupported coverage claims',
    ],
  },
  {
    id: 'B',
    title: 'Knowledge accuracy',
    items: [
      'definitions are correct',
      'reasoning is correct',
      'formulas are correct',
      'procedures are correct',
      'examples are correct',
      'facts vs assumptions vs opinions are clearly distinguished',
    ],
  },
  {
    id: 'C',
    title: 'Source provenance',
    items: [
      'every source exists and is reachable/verifiable',
      'exact licence is recorded per source',
      'intended use is compatible with each licence',
      'citations support the associated claims',
      'superseded material is identified',
      'no unlicensed content is reproduced',
    ],
  },
  {
    id: 'D',
    title: 'Educational value',
    items: [
      'explanations suit the declared learning levels',
      'terminology is correct for the audience',
      'prerequisite progression is sound',
      'examples are appropriate',
      'learning objectives are understandable',
    ],
  },
  {
    id: 'E',
    title: 'Safety',
    items: [
      'professional restrictions are present and correct',
      'jurisdiction limitations are present and correct',
      'high-stakes boundaries are honoured',
      'refusal scenarios are correct',
      'human escalation criteria are present',
    ],
  },
  {
    id: 'F',
    title: 'Benchmark quality',
    items: [
      'fixtures are original (BEAN-authored or licence-compatible)',
      'reference answers are correct',
      'reasoning expectations are valid',
      'edge cases are covered',
      'adversarial cases are covered',
      'insufficient-evidence cases are covered',
    ],
  },
]

export const RUBRIC_SECTION_IDS = PACK_REVIEW_RUBRIC.map((s) => s.id) as ('A' | 'B' | 'C' | 'D' | 'E' | 'F')[]
export const RUBRIC_SECTION_STATUS = ['OK', 'ISSUE', 'NOT_ASSESSED'] as const
export type RubricSectionStatus = (typeof RUBRIC_SECTION_STATUS)[number]

export const packReviewRubricSchema = z.object({
  sections: z
    .record(
      z.enum(RUBRIC_SECTION_IDS as unknown as [string, ...string[]]),
      z.object({
        status: z.enum(RUBRIC_SECTION_STATUS),
        notes: z.string().max(2000).default(''),
      }).strict(),
    )
    .refine(
      (sections) => RUBRIC_SECTION_IDS.every((id) => id in sections),
      { message: 'every rubric section (A–F) must be recorded — NOT_ASSESSED is honest, omission is not' },
    ),
  /** Free-text evidence of what the reviewer actually inspected (beyond the per-section notes). */
  inspected: z.string().min(20, 'evidence of what was inspected is required (min 20 chars)').max(4000),
}).strict()

export type PackReviewRubric = z.infer<typeof packReviewRubricSchema>

export interface RubricCheckResult {
  ok: boolean
  error?: string
  /** Machine-readable per-section summary for the response/UI. */
  summary: { section: string; status: RubricSectionStatus }[]
}

/**
 * Decision-vs-rubric consistency rules. The rubric can never silently disagree
 * with the recorded decision.
 */
export function checkRubricAgainstDecision(decision: string, rubric: PackReviewRubric): RubricCheckResult {
  const summary = RUBRIC_SECTION_IDS.map((id) => ({ section: id, status: rubric.sections[id].status }))
  const issues = summary.filter((s) => s.status === 'ISSUE')
  const notAssessed = summary.filter((s) => s.status === 'NOT_ASSESSED')

  if (decision === 'APPROVED') {
    if (issues.length > 0) {
      return { ok: false, error: `APPROVED requires every rubric section OK — sections with issues: ${issues.map((s) => s.section).join(', ')}`, summary }
    }
    if (notAssessed.length > 0) {
      return { ok: false, error: `APPROVED requires every rubric section assessed — NOT_ASSESSED sections: ${notAssessed.map((s) => s.section).join(', ')}`, summary }
    }
    return { ok: true, summary }
  }
  if (decision === 'REJECTED') {
    if (issues.length === 0) {
      return { ok: false, error: 'REJECTED requires at least one rubric section marked ISSUE with notes — a rejection must name its reason', summary }
    }
    return { ok: true, summary }
  }
  // CHANGES_REQUESTED / RE_REVIEW_REQUESTED
  if (issues.length === 0 && notAssessed.length === 0) {
    return { ok: false, error: `${decision} requires at least one ISSUE or NOT_ASSESSED section — there must be something concrete to change or re-inspect`, summary }
  }
  return { ok: true, summary }
}

/** Compose the evidence payload stored in the append-only review row. */
export function composeRubricEvidence(rubric: PackReviewRubric): string {
  return JSON.stringify({
    kind: 'CI5-DOMAIN-RUBRIC',
    inspected: rubric.inspected,
    sections: rubric.sections,
    rubricVersion: 1,
  })
}
