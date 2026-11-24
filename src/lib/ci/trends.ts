// ─── CI-2C: teacher improvement intelligence (pure, deterministic) ───────────
// Aggregates a teacher's own CURRENT evaluation reports into a longitudinal
// professional-development view. Rules encoded here (mirroring the milestone
// contract):
//
//   • Only authorised, non-retracted CURRENT reports reach this module — the
//     route filters; the pure function assumes nothing about authorisation.
//   • Subjects are never compared as equivalent: every trend is computed per
//     subject group.
//   • A trend is only shown with the number of evaluated classes behind it.
//     Below MIN_TREND_SAMPLE (3) evaluated classes for a subject, the honest
//     state is "insufficient data", never a fabricated direction.
//   • Missing evidence (INSUFFICIENT_EVIDENCE rows) is counted separately and
//     never folded into a negative signal.
//   • No public ranking, no scores, no verified-review conflation: the output
//     is advisory evidence for the teacher alone, with dispute access noted.
//   • Suggestions are a STATIC, authored catalogue matched to recurring
//     improvement categories — never model-invented analytics.
//   • Protected characteristics cannot enter: category and finding enums are
//     closed sets; free text is never aggregated into trends.

import type { FinalReport } from '@/lib/ci/schemas'

/** Minimum evaluated classes (per subject) before any trend direction is shown. */
export const MIN_TREND_SAMPLE = 3

export interface TrendReportInput {
  reportId: string
  version: number
  createdAtIso: string
  subject: string
  report: FinalReport
}

export interface SubjectCoverageTrend {
  subject: string
  evaluatedClasses: number
  coveredObjectives: number
  unverifiableObjectives: number
  /** covered / (covered + unverifiable) across the subject's reports; null when nothing was advertised. */
  coverageRatio: number | null
  sufficientSample: boolean
}

export interface CategoryTrend {
  category: string
  evaluatedCount: number
  insufficientCount: number
  strengthCount: number
  improvementCount: number
  /** Honest note when evidence is mostly missing (never a negative signal). */
  missingEvidenceNote: string | null
  subjectBreakdown: { subject: string; evaluated: number; strengths: number; improvements: number; evaluatedClasses: number }[]
}

export interface ImprovementSignal {
  subject: string
  category: string
  direction: 'improving' | 'steady' | 'needs-attention'
  earlierCount: number
  recentCount: number
  classesCompared: number
  caveat: string
}

export interface RecurringSuggestion {
  text: string
  occurrences: number
  categories: string[]
}

export interface SuggestedResource {
  category: string
  title: string
  description: string
}

export interface TeacherTrends {
  evaluatedClasses: number
  insufficientData: boolean
  subjects: { subject: string; evaluatedClasses: number }[]
  coverage: SubjectCoverageTrend[]
  categories: CategoryTrend[]
  recurringSuggestions: RecurringSuggestion[]
  improvementSignals: ImprovementSignal[]
  suggestedResources: SuggestedResource[]
}

// Static, authored development catalogue — generic pedagogy advice mapped to
// categories. Never model-generated; never presented as an AI judgement.
const RESOURCE_CATALOGUE: Record<string, SuggestedResource> = {
  SUBJECT_ACCURACY: {
    category: 'SUBJECT_ACCURACY',
    title: 'Re-verify taught facts against the source',
    description: 'Before class, re-check any formula, definition or rule you plan to teach from memory against the textbook or syllabus source, and note the check in your lesson notes.',
  },
  EXPLANATION_CLARITY: {
    category: 'EXPLANATION_CLARITY',
    title: 'One concept per explanation',
    description: 'Say the rule, work one routine example, then one edge case, and close with a single check question. Keeping each explanation to one concept makes clarity easier to judge from your own notes.',
  },
  LESSON_STRUCTURE: {
    category: 'LESSON_STRUCTURE',
    title: 'Three-part lesson skeleton',
    description: 'Plan every class as hook → guided practice → independent practice, and time each part. The plan and notes then show the structure the evaluation can verify.',
  },
  SYLLABUS_COVERAGE: {
    category: 'SYLLABUS_COVERAGE',
    title: 'Map advertised objectives before class',
    description: 'List the objectives your title and description advertise, mark which segments address them, and record the mapping in your notes — including anything postponed.',
  },
  TEACHING_PACE: {
    category: 'TEACHING_PACE',
    title: 'Time budget per segment',
    description: 'Allocate minutes per segment in the plan, write actual timings into your notes after class, and adjust the next plan rather than the delivery speed.',
  },
  USE_OF_EXAMPLES: {
    category: 'USE_OF_EXAMPLES',
    title: 'Two worked examples per concept',
    description: 'Prepare one routine and one edge-case worked example per concept; noting them in your lesson notes makes example use visible to the evaluation.',
  },
  STUDENT_INTERACTION: {
    category: 'STUDENT_INTERACTION',
    title: 'Deliberate check-for-understanding moments',
    description: 'Plan one interaction moment per segment. BEAN never records students, so interaction is only evaluable when your own opt-in lesson notes describe it.',
  },
  QUESTION_HANDLING: {
    category: 'QUESTION_HANDLING',
    title: 'Capture questions in your notes',
    description: 'Note the questions asked and how you resolved them. This is the only authorised channel through which question handling can be evaluated.',
  },
  TIME_MANAGEMENT: {
    category: 'TIME_MANAGEMENT',
    title: 'Compare planned vs actual duration',
    description: 'After class, compare the planned duration with what your notes and the verified session record show, and adjust the next plan.',
  },
  LEARNING_RESOURCE_QUALITY: {
    category: 'LEARNING_RESOURCE_QUALITY',
    title: 'Save a whiteboard snapshot per segment',
    description: 'Saving board snapshots per segment gives the evaluation real resource structure to assess (geometry only — never content text).',
  },
}

const CATEGORY_ORDER: readonly string[] = [
  'SUBJECT_ACCURACY',
  'EXPLANATION_CLARITY',
  'LESSON_STRUCTURE',
  'SYLLABUS_COVERAGE',
  'TEACHING_PACE',
  'USE_OF_EXAMPLES',
  'STUDENT_INTERACTION',
  'QUESTION_HANDLING',
  'TIME_MANAGEMENT',
  'LEARNING_RESOURCE_QUALITY',
] as const

function findingCategories(report: FinalReport, bucket: 'strengths' | 'improvements'): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of report[bucket]) {
    if (f.flaggedForReview) continue // advisory-only findings never feed trends
    m.set(f.category, (m.get(f.category) ?? 0) + 1)
  }
  return m
}

/** Build the full trends view. Pure — same inputs, same output, always. */
export function buildTeacherTrends(inputs: TrendReportInput[]): TeacherTrends {
  const ordered = [...inputs].sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso))
  const evaluatedClasses = ordered.length

  // Subject grouping — subjects are never compared as equivalent.
  const bySubject = new Map<string, TrendReportInput[]>()
  for (const r of ordered) {
    const key = r.subject.trim() || 'Unspecified subject'
    const list = bySubject.get(key) ?? []
    list.push(r)
    bySubject.set(key, list)
  }
  const subjects = [...bySubject.entries()]
    .map(([subject, list]) => ({ subject, evaluatedClasses: list.length }))
    .sort((a, b) => b.evaluatedClasses - a.evaluatedClasses || a.subject.localeCompare(b.subject))

  // ── Syllabus coverage trend (per subject) ──
  const coverage: SubjectCoverageTrend[] = subjects.map(({ subject, evaluatedClasses: classes }) => {
    const list = bySubject.get(subject) ?? []
    let covered = 0
    let unverifiable = 0
    for (const r of list) {
      covered += r.report.objectivesCovered.length
      unverifiable += r.report.objectivesUnverifiable.length
    }
    const denom = covered + unverifiable
    return {
      subject,
      evaluatedClasses: classes,
      coveredObjectives: covered,
      unverifiableObjectives: unverifiable,
      coverageRatio: denom > 0 ? Math.round((covered / denom) * 100) / 100 : null,
      sufficientSample: classes >= MIN_TREND_SAMPLE,
    }
  })

  // ── Category trends (across all subjects, with per-subject breakdown) ──
  const categories: CategoryTrend[] = CATEGORY_ORDER.map((category) => {
    let evaluatedCount = 0
    let insufficientCount = 0
    let strengthCount = 0
    let improvementCount = 0
    const subjectBreakdown: CategoryTrend['subjectBreakdown'] = []
    for (const { subject, evaluatedClasses: classes } of subjects) {
      const list = bySubject.get(subject) ?? []
      let ev = 0
      let s = 0
      let i = 0
      for (const r of list) {
        const row = r.report.categories.find((c) => c.category === category)
        if (row?.status === 'EVALUATED') {
          ev += 1
          evaluatedCount += 1
        } else {
          insufficientCount += 1
        }
        s += findingCategories(r.report, 'strengths').get(category) ?? 0
        i += findingCategories(r.report, 'improvements').get(category) ?? 0
      }
      strengthCount += s
      improvementCount += i
      subjectBreakdown.push({ subject, evaluated: ev, strengths: s, improvements: i, evaluatedClasses: classes })
    }
    const missingEvidenceNote =
      evaluatedCount === 0 && insufficientCount > 0
        ? `No evaluated class had an evidence basis for this category yet (${insufficientCount} classes with missing evidence) — this is missing evidence, not a performance signal.`
        : null
    return {
      category,
      evaluatedCount,
      insufficientCount,
      strengthCount,
      improvementCount,
      missingEvidenceNote,
      subjectBreakdown: subjectBreakdown.map(({ subject, evaluated, strengths, improvements, evaluatedClasses }) => ({
        subject,
        evaluated,
        strengths,
        improvements,
        evaluatedClasses,
      })),
    }
  })

  // ── Recurring evidence-backed suggestions (exact text across reports) ──
  const suggestionMap = new Map<string, { occurrences: number; categories: Set<string> }>()
  for (const r of ordered) {
    for (const f of r.report.improvements) {
      if (f.flaggedForReview || !f.suggestion) continue
      const entry = suggestionMap.get(f.suggestion) ?? { occurrences: 0, categories: new Set<string>() }
      entry.occurrences += 1
      entry.categories.add(f.category)
      suggestionMap.set(f.suggestion, entry)
    }
  }
  const recurringSuggestions: RecurringSuggestion[] = [...suggestionMap.entries()]
    .filter(([, v]) => v.occurrences >= 2)
    .map(([text, v]) => ({ text, occurrences: v.occurrences, categories: [...v.categories] }))
    .sort((a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text))
    .slice(0, 6)

  // ── Improvement signals (only where comparable evidence exists) ──
  // Split each subject's ordered reports into an earlier and a recent half.
  // Direction is a conservative count comparison over the three named trend
  // categories, ALWAYS with the sample size shown, and only when the subject
  // has at least MIN_TREND_SAMPLE evaluated classes.
  const SIGNAL_CATEGORIES = ['SYLLABUS_COVERAGE', 'EXPLANATION_CLARITY', 'LESSON_STRUCTURE'] as const
  const improvementSignals: ImprovementSignal[] = []
  for (const { subject, evaluatedClasses: classes } of subjects) {
    if (classes < MIN_TREND_SAMPLE) continue
    const list = bySubject.get(subject) ?? []
    const mid = Math.floor(list.length / 2)
    const earlier = list.slice(0, mid)
    const recent = list.slice(mid)
    for (const category of SIGNAL_CATEGORIES) {
      const count = (bucket: TrendReportInput[]) =>
        bucket.reduce((s, r) => s + (findingCategories(r.report, 'improvements').get(category) ?? 0), 0)
      const strengthsCount = (bucket: TrendReportInput[]) =>
        bucket.reduce((s, r) => s + (findingCategories(r.report, 'strengths').get(category) ?? 0), 0)
      const earlierCount = count(earlier)
      const recentCount = count(recent)
      let direction: ImprovementSignal['direction']
      if (recentCount === 0 && earlierCount > 0) direction = 'improving'
      else if (recentCount > earlierCount) direction = 'needs-attention'
      else if (recentCount === 0 && earlierCount === 0) direction = 'steady'
      else if (recentCount === earlierCount && strengthsCount(recent) > strengthsCount(earlier)) direction = 'improving'
      else direction = 'steady'
      improvementSignals.push({
        subject,
        category,
        direction,
        earlierCount,
        recentCount,
        classesCompared: classes,
        caveat: `Directional signal from ${classes} evaluated classes in ${subject} (small sample — not a measurement). Underlying reports remain open to dispute.`,
      })
    }
  }

  // ── Suggested resources for the top recurring improvement categories ──
  const topImprovementCategories = [...categories]
    .filter((c) => c.improvementCount > 0)
    .sort((a, b) => b.improvementCount - a.improvementCount || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .slice(0, 3)
    .map((c) => c.category)
  const suggestedResources = topImprovementCategories
    .map((category) => RESOURCE_CATALOGUE[category])
    .filter((r): r is SuggestedResource => r !== undefined)

  return {
    evaluatedClasses,
    insufficientData: evaluatedClasses < MIN_TREND_SAMPLE,
    subjects,
    coverage,
    categories,
    recurringSuggestions,
    improvementSignals,
    suggestedResources,
  }
}
