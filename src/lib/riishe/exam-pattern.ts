// ─── Exam-pattern marking lookup for Riishe tests ────────────────────────────
// When a student associates an upload with an examination ("CUET UG"), Riishe
// can offer that exam's VERIFIED marking scheme for practice scoring. The
// pattern comes from the catalogue's stage pattern rows (seeded only where
// officially verified) — never invented here. Custom practice tests keep
// plain +1/0 scoring; exam-pattern practice is always labelled as practice.

import { db } from '@/lib/db'
import type { ScoringConfig, ScoringModel } from './types'

export interface ExamPatternMatch {
  examSlug: string
  examName: string
  stageName: string
  marksPerQuestion: number
  negativeMark: number
}

/**
 * Match a free-text exam label against the verified catalogue. Returns the
 * first stage pattern that carries an explicit marking scheme. Matching is
 * deliberately conservative: slug equality, short-name or a full-name
 * substring — a fuzzy " resembles" match never counts.
 */
export async function findExamPattern(examLabel: string | null | undefined): Promise<ExamPatternMatch | null> {
  const label = (examLabel ?? '').trim().toLowerCase()
  if (label.length < 3) return null

  const exams = await db.exam.findMany({
    select: {
      id: true, slug: true, name: true, shortName: true,
      stages: { select: { name: true, patternJson: true, order: true }, orderBy: { order: 'asc' } },
    },
    take: 500,
  })

  const clean = (s: string | null) => (s ?? '').trim().toLowerCase()

  // Priority 1: exact short-name match ("cuet ug", "jee main")
  let hit = exams.find(e =>
    clean(e.shortName) === label ||
    clean(e.shortName).replace(/[^a-z0-9]+/g, '') === label.replace(/[^a-z0-9]+/g, ''),
  )
  // Priority 2: slug equality
  if (!hit) hit = exams.find(e => e.slug === label.replace(/[^a-z0-9-]+/g, '-'))
  // Priority 3: full official name contained in the label (or vice versa)
  if (!hit) {
    hit = exams.find(e => {
      const n = clean(e.name)
      return n.length >= 8 && (label.includes(n) || n.includes(label))
    })
  }
  if (!hit) return null

  // First stage with an explicit per-question marks value
  for (const stage of hit.stages) {
    const pattern = safePattern(stage.patternJson)
    if (!pattern || pattern.marksPerQuestion == null) continue
    const mpq = Number(pattern.marksPerQuestion)
    const neg = Number(pattern.negativeMark ?? 0)
    if (!Number.isFinite(mpq) || mpq <= 0) continue
    return {
      examSlug: hit.slug,
      examName: hit.name,
      stageName: stage.name,
      marksPerQuestion: mpq,
      negativeMark: Number.isFinite(neg) && neg > 0 ? neg : 0,
    }
  }
  return null
}

/** Build the ScoringConfig for a new test. */
export function buildScoringConfig(opts: {
  timed: boolean
  count: number
  pattern: ExamPatternMatch | null
}): ScoringConfig {
  const { timed, count, pattern } = opts
  const durationMin = timed ? Math.max(10, count) : 0
  if (pattern) {
    return {
      timed,
      durationMin,
      marksPerQuestion: pattern.marksPerQuestion,
      negativeMark: pattern.negativeMark,
      scoringModel: 'EXAM_PATTERN' as ScoringModel,
      patternLabel: `${pattern.examName} pattern (+${pattern.marksPerQuestion} correct${pattern.negativeMark > 0 ? ` / −${pattern.negativeMark} wrong` : ''}) — practice scoring, not an official result`,
    }
  }
  return {
    timed,
    durationMin,
    marksPerQuestion: 1,
    negativeMark: 0,
    scoringModel: 'CUSTOM' as ScoringModel,
  }
}

function safePattern(json: string | null): { marksPerQuestion?: number; negativeMark?: number } | null {
  if (!json) return null
  try {
    const p = JSON.parse(json) as { marksPerQuestion?: number; negativeMark?: number }
    return p && typeof p === 'object' ? p : null
  } catch {
    return null
  }
}
