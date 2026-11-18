import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse, shuffle } from '@/lib/serialize'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  templateId: z.string().optional(),
  examId: z.string().optional(),
  subjectId: z.string().optional(),
  topicId: z.string().optional(),
  type: z.enum(['TOPIC', 'SUBJECT', 'MIXED', 'REVISION']).optional(),
})

interface TestConfig {
  count: number
  durationMin: number
  marksPerQuestion: number
  negativeMark: number
}

// Phase 2A PYQ review workflow: REJECTED PYQ rows must never be selected for a
// test (unverified PYQ rows may still appear — they are simply not yet
// reviewed; rejected ones are confirmed wrong/unsuitable by a reviewer).
// Applied to every availability count and question selection below.
const SELECTABLE_QUESTION = { verificationStatus: { not: 'REJECTED' } } as const

// Honour the exam's REAL marking scheme & pace when its stage pattern defines
// one (e.g. CUET UG: +5 correct, −1 wrong, 50 Q / 60 min → 1.2 min per question).
function cfgFromStagePattern(
  patternJson: string | null,
  count: number,
  fallbackDurationMin?: number,
): TestConfig {
  const pat = safeParse<{ durationMin?: number; totalQuestions?: number; totalMarks?: number; negativeMark?: number; marksPerQuestion?: number } | null>(patternJson, null)
  if (!pat || !pat.durationMin || !pat.totalQuestions) {
    return { count, durationMin: fallbackDurationMin ?? count, marksPerQuestion: 1, negativeMark: 0 }
  }
  const minutesPerQ = pat.durationMin / pat.totalQuestions
  // Marks per correct answer: explicit override (CUET UG: 5), else the exam's real
  // marks-per-question average from its official pattern (JEE: +4, TNPSC: +1.5 …).
  const derived = pat.totalMarks ? Math.round((pat.totalMarks / pat.totalQuestions) * 100) / 100 : 1
  return {
    count,
    durationMin: Math.max(5, Math.round(count * minutesPerQ)),
    marksPerQuestion: pat.marksPerQuestion ?? derived,
    negativeMark: pat.negativeMark ?? 0,
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { guestId, templateId, examId, subjectId, topicId } = parsed.data

    let filter: { examId?: string; subjectId?: string; topicId?: string } = {}
    let config: TestConfig | null = null
    let title = 'Practice Test'
    let examLabel = ''
    let resumeKey = ''
    let revisionQuestionIds: string[] | null = null
    let attemptExamId: string | null = null // exam scoping for revision/progress (topic/subject starts resolve it too)

    if (templateId) {
      const tpl = await db.testTemplate.findUnique({ where: { id: templateId }, include: { exam: true } })
      if (!tpl) return NextResponse.json({ error: 'Test not found' }, { status: 404 })
      config = safeParse<TestConfig>(tpl.configJson, { count: 10, durationMin: 10, marksPerQuestion: 1, negativeMark: 0 })
      filter = { examId: tpl.examId ?? undefined, subjectId: tpl.subjectId ?? undefined, topicId: tpl.topicId ?? undefined }
      filter = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as typeof filter
      title = tpl.title
      examLabel = tpl.exam?.shortName ?? tpl.exam?.name ?? ''
      attemptExamId = tpl.examId
      resumeKey = `tpl:${tpl.id}`
    } else if (topicId) {
      const topic = await db.topic.findUnique({
        where: { id: topicId },
        include: { unit: { include: { subject: { include: { stage: { include: { exam: true } } } } } } },
      })
      if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
      const exam = topic.unit.subject.stage.exam
      const available = await db.question.count({ where: { topicId, ...SELECTABLE_QUESTION } })
      if (available < 4) {
        return NextResponse.json({ error: 'Not enough questions yet for a topic test — try the subject or mixed test instead.' }, { status: 409 })
      }
      const count = Math.min(10, available)
      config = cfgFromStagePattern(topic.unit.subject.stage.patternJson, count)
      filter = { topicId }
      title = `${topic.name} — Topic Practice`
      examLabel = exam.shortName ?? exam.name
      attemptExamId = exam.id
      resumeKey = `topic:${topicId}`
    } else if (examId && subjectId) {
      const subject = await db.subject.findUnique({ where: { id: subjectId }, include: { stage: { include: { exam: true } } } })
      if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
      const available = await db.question.count({ where: { subjectId, ...SELECTABLE_QUESTION } })
      if (available < 4) return NextResponse.json({ error: 'Not enough questions available yet.' }, { status: 409 })
      const count = Math.min(15, available)
      config = cfgFromStagePattern(subject.stage.patternJson, count)
      filter = { subjectId }
      title = `${subject.name} — Practice Test`
      examLabel = subject.stage.exam.shortName ?? subject.stage.exam.name
      attemptExamId = subject.stage.exam.id
      resumeKey = `subject:${subjectId}`
    } else if (examId) {
      const exam = await db.exam.findUnique({ where: { id: examId } })
      if (!exam) return NextResponse.json({ error: 'Examination not found' }, { status: 404 })

      if (parsed.data.type === 'REVISION') {
        // Revision test — built ONLY from this guest's actual wrong answers in this exam.
        const pastAttempts = await db.attempt.findMany({
          where: { guestId, examId, status: { in: ['SUBMITTED', 'TIMED_OUT'] } },
          select: { questionIdsJson: true, answersJson: true },
          orderBy: { startedAt: 'desc' },
          take: 30,
        })
        const answered = new Map<string, number>()
        for (const attempt of pastAttempts) {
          const ids = safeParse<string[]>(attempt.questionIdsJson, [])
          const answers = safeParse<Record<string, number>>(attempt.answersJson, {})
          for (const qid of ids) {
            const selected = answers[qid]
            if (selected === undefined || selected < 0) continue
            answered.set(qid, selected)
          }
        }
        if (answered.size > 0) {
          const rows = await db.question.findMany({
            where: { id: { in: [...answered.keys()] }, examId, ...SELECTABLE_QUESTION },
            select: { id: true, correctIndex: true },
          })
          revisionQuestionIds = rows
            .filter(r => answered.get(r.id) !== r.correctIndex)
            .map(r => r.id)
        }
        if (!revisionQuestionIds || revisionQuestionIds.length < 4) {
          return NextResponse.json({
            error: 'Not enough wrong answers to build a revision test yet — take a practice test first.',
          }, { status: 409 })
        }
        const firstStage = await db.stage.findFirst({
          where: { examId }, orderBy: { order: 'asc' },
        })
        const count = Math.min(15, revisionQuestionIds.length)
        config = cfgFromStagePattern(firstStage?.patternJson ?? null, count)
        filter = { examId }
        title = `${exam.shortName ?? exam.name} — Revision (my mistakes)`
        examLabel = exam.shortName ?? exam.name
        attemptExamId = exam.id
        resumeKey = `revision:${examId}`
      } else {
        const available = await db.question.count({ where: { examId, ...SELECTABLE_QUESTION } })
        if (available < 4) return NextResponse.json({ error: 'Not enough questions available yet for this exam.' }, { status: 409 })
        const count = Math.min(25, available)
        const firstStage = await db.stage.findFirst({ where: { examId }, orderBy: { order: 'asc' } })
        config = cfgFromStagePattern(firstStage?.patternJson ?? null, count, Math.max(20, count))
        filter = { examId }
        title = `${exam.shortName ?? exam.name} — Mixed Practice`
        examLabel = exam.shortName ?? exam.name
        attemptExamId = exam.id
        resumeKey = `exam:${examId}`
      }
    } else {
      return NextResponse.json({ error: 'Specify a template, topic, subject or exam' }, { status: 400 })
    }
    if (!config) {
      return NextResponse.json({ error: 'Could not build a test configuration' }, { status: 400 })
    }

    // Resume: return the existing unfinished attempt for the same scope & guest
    const existing = await db.attempt.findFirst({
      where: {
        guestId,
        status: 'IN_PROGRESS',
        title,
      },
      orderBy: { startedAt: 'desc' },
    })
    if (existing) {
      const stillValid = Date.now() - existing.startedAt.getTime() < (config.durationMin + 5) * 60_000
      if (stillValid) {
        return NextResponse.json({ attemptId: existing.id, resumed: true })
      }
      await db.attempt.update({ where: { id: existing.id }, data: { status: 'ABANDONED' } })
    }

    // Select questions server-side (never expose answers at this stage)
    let chosen: string[]
    if (revisionQuestionIds) {
      chosen = shuffle(revisionQuestionIds).slice(0, config.count)
    } else {
      const ids = await db.question.findMany({
        where: { ...filter, ...SELECTABLE_QUESTION },
        select: { id: true },
      })
      chosen = shuffle(ids.map(q => q.id)).slice(0, config.count)
    }
    if (chosen.length < 4) {
      return NextResponse.json({ error: 'Not enough questions available.' }, { status: 409 })
    }

    void resumeKey
    const attempt = await db.attempt.create({
      data: {
        guestId,
        templateId: templateId ?? null,
        examId: attemptExamId,
        title,
        examLabel,
        topicId: filter.topicId ?? null,
        subjectId: filter.subjectId ?? null,
        configJson: JSON.stringify(config),
        questionIdsJson: JSON.stringify(chosen),
        answersJson: JSON.stringify({}),
        status: 'IN_PROGRESS',
      },
    })

    return NextResponse.json({ attemptId: attempt.id, resumed: false })
  } catch (err) {
    console.error('[api/tests/start]', err)
    return NextResponse.json({ error: 'Could not start the test' }, { status: 500 })
  }
}
