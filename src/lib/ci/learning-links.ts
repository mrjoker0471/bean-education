// ─── CI-2D: deterministic learning links for class-level summaries ───────────
// Connects a student's CLASS-LEVEL learning summary to the learning
// infrastructure that ALREADY exists in BEAN — never duplicating it:
//   • related syllabus topics (exam catalogue: stages → subjects → units →
//     topics) — linked to the existing exam study tab;
//   • recommended existing practice (the exam practice tab) and the existing
//     personal Revision planner (#/learning);
//   • relevant curated study resources (EXAM_RESOURCES — official sources).
//
// HARD HONESTY RULES:
//   • Matching is a pure, deterministic token-overlap function over the REAL
//     catalogue data. Nothing is invented: a link exists only if the catalogue
//     entry exists, and `matchedOn` records which concept tokens produced it.
//   • No match → empty lists (the UI says so honestly).
//   • The links are navigation to existing BEAN surfaces; they never claim
//     anything about the individual student (the class-level boundary is
//     preserved — see the student summary's scope note).
//   • Caps keep the card focused: ≤4 topics, ≤2 exam practice links + the
//     revision planner, ≤3 resources.

import { EXAMS, type ExamSeed } from '@/data/exams'
import { EXAM_RESOURCES } from '@/data/resources'

export interface CiSyllabusLink {
  label: string
  detail: string
  href: string
  matchedOn: string[]
}

export interface CiPracticeLink {
  label: string
  detail: string
  href: string
}

export interface CiResourceLink {
  title: string
  provider: string
  accessType: string
  url: string
}

export interface CiLearningLinks {
  syllabusTopics: CiSyllabusLink[]
  practice: CiPracticeLink[]
  resources: CiResourceLink[]
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'about', 'their', 'them', 'they',
  'introduction', 'intro', 'basics', 'basic', 'lesson', 'class', 'topic', 'topics', 'concept',
  'concepts', 'revision', 'review', 'study', 'part', 'parts', 'whole', 'using', 'use', 'used',
  'each', 'when', 'what', 'which', 'how', 'why', 'this', 'that', 'these', 'those', 'more',
])

const TOKEN_MIN_LENGTH = 3

function tokenize(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= TOKEN_MIN_LENGTH && !STOPWORDS.has(t)),
  )]
}

interface CatalogueTopic {
  examSlug: string
  examName: string
  examShort: string
  syllabusStatus: ExamSeed['syllabusStatus']
  featured: boolean
  subjectName: string
  unitName: string
  topicName: string
  topicKey: string
  tokens: string[]
}

let index: CatalogueTopic[] | null = null

function catalogueIndex(): CatalogueTopic[] {
  if (index) return index
  const topics: CatalogueTopic[] = []
  for (const exam of EXAMS) {
    for (const stage of exam.stages) {
      for (const subject of stage.subjects) {
        for (const unit of subject.units) {
          for (const topic of unit.topics) {
            const name = topic.name
            const key = `${exam.slug}|${subject.slug}|${unit.slug}|${topic.slug}`
            if (topics.some((t) => t.topicKey === key)) continue
            topics.push({
              examSlug: exam.slug,
              examName: exam.name,
              examShort: exam.shortName ?? exam.name,
              syllabusStatus: exam.syllabusStatus,
              featured: exam.featured ?? false,
              subjectName: subject.name,
              unitName: unit.name,
              topicName: name,
              topicKey: key,
              tokens: tokenize(`${topic.name} ${topic.name} ${unit.name} ${subject.name}`),
            })
          }
        }
      }
    }
  }
  index = topics
  return topics
}

export interface LearningLinksInput {
  subject: string
  conceptsCovered: string[]
  revisionTopics: string[]
}

/** Pure, deterministic: same input → same output, always. */
export function buildLearningLinks(input: LearningLinksInput): CiLearningLinks {
  const queryTokens = new Set<string>([
    ...tokenize(input.subject),
    ...input.conceptsCovered.flatMap((c) => tokenize(c)),
    ...input.revisionTopics.flatMap((r) => tokenize(r)),
  ])
  if (queryTokens.size === 0) {
    return { syllabusTopics: [], practice: [], resources: [] }
  }

  const catalogue = catalogueIndex()

  // ── Syllabus topic matching ──
  const scored = catalogue
    .map((t) => {
      const matched = t.tokens.filter((tok) => queryTokens.has(tok))
      return { t, matched }
    })
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => {
      if (b.matched.length !== a.matched.length) return b.matched.length - a.matched.length
      const statusOrder = { VERIFIED: 0, PARTIAL: 1, UNVERIFIED: 2 } as const
      if (statusOrder[a.t.syllabusStatus] !== statusOrder[b.t.syllabusStatus]) {
        return statusOrder[a.t.syllabusStatus] - statusOrder[b.t.syllabusStatus]
      }
      if (a.t.featured !== b.t.featured) return a.t.featured ? -1 : 1
      return a.t.topicKey.localeCompare(b.t.topicKey)
    })

  // Dedupe by subject+unit+topic NAME (the same topic can appear in several
  // exams — keep the highest-ranked exam's entry for a focused card).
  const seenNames = new Set<string>()
  const syllabusTopics: CiSyllabusLink[] = []
  for (const s of scored) {
    const dedupeKey = `${s.t.subjectName}|${s.t.unitName}|${s.t.topicName}`.toLowerCase()
    if (seenNames.has(dedupeKey)) continue
    seenNames.add(dedupeKey)
    syllabusTopics.push({
      label: s.t.topicName,
      detail: `${s.t.examShort} · ${s.t.subjectName} · ${s.t.unitName}`,
      href: `#/exam/${s.t.examSlug}?tab=study`,
      matchedOn: [...new Set(s.matched)].slice(0, 3),
    })
    if (syllabusTopics.length >= 4) break
  }

  // ── Practice links for the matched exams (existing exam practice tab) ──
  const practice: CiPracticeLink[] = []
  const seenExams = new Set<string>()
  for (const s of scored) {
    if (seenExams.has(s.t.examSlug)) continue
    seenExams.add(s.t.examSlug)
    practice.push({
      label: `Practise ${s.t.examShort}`,
      detail: `Timed practice from the ${s.t.examName} catalogue`,
      href: `#/exam/${s.t.examSlug}?tab=practice`,
    })
    if (practice.length >= 2) break
  }
  // The existing personal Revision planner — always available, never duplicated.
  practice.push({
    label: 'Open your Revision planner',
    detail: 'Spaced revision for the topics you are tracking on BEAN',
    href: '#/learning',
  })

  // ── Curated resources for the matched exams (official sources only) ──
  const resources: CiResourceLink[] = []
  for (const r of EXAM_RESOURCES) {
    if (!r.examSlug || !seenExams.has(r.examSlug)) continue
    resources.push({
      title: r.title,
      provider: r.provider,
      accessType: r.accessType ?? 'FREE',
      url: r.url,
    })
    if (resources.length >= 3) break
  }

  return { syllabusTopics, practice, resources }
}
