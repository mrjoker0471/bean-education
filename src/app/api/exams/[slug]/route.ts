import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { ExamDetailDTO, StagePatternDTO, TestTemplateDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const exam = await db.exam.findUnique({
      where: { slug },
      include: {
        category: true,
        _count: { select: { questions: true, resources: true, templates: true } },
      },
    })
    if (!exam) return NextResponse.json({ error: 'Examination not found' }, { status: 404 })

    const stages = await db.stage.findMany({
      where: { examId: exam.id },
      orderBy: { order: 'asc' },
      include: {
        subjects: {
          orderBy: { order: 'asc' },
          include: {
            units: {
              orderBy: { order: 'asc' },
              include: {
                topics: {
                  orderBy: { order: 'asc' },
                  include: {
                    _count: { select: { questions: true, resources: true } },
                    notes: { select: { id: true } },
                  },
                },
              },
            },
            _count: { select: { questions: true } },
          },
        },
      },
    })

    const templates = await db.testTemplate.findMany({
      where: { examId: exam.id },
      orderBy: { order: 'asc' },
      include: {
        stage: { select: { name: true } },
        subject: { select: { name: true } },
      },
    })

    const examResources = await db.resource.findMany({
      where: { examId: exam.id, topicId: null },
      orderBy: { createdAt: 'asc' },
    })

    // Question provenance counts — powers the honest question-integrity panel
    const sourceAgg = await db.question.groupBy({
      by: ['sourceType'],
      where: { examId: exam.id },
      _count: { _all: true },
    })
    const questionSources = { ORIGINAL: 0, PYQ_VERIFIED: 0, PYQ_UNVERIFIED: 0 }
    for (const row of sourceAgg) {
      if (row.sourceType === 'ORIGINAL') questionSources.ORIGINAL = row._count._all
      else if (row.sourceType === 'PYQ_VERIFIED') questionSources.PYQ_VERIFIED = row._count._all
      else if (row.sourceType === 'PYQ_UNVERIFIED') questionSources.PYQ_UNVERIFIED = row._count._all
    }

    const topicCountAgg = await db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(t.id) AS c FROM Topic t
      JOIN Unit u ON t.unitId = u.id
      JOIN Subject su ON u.subjectId = su.id
      JOIN Stage s ON su.stageId = s.id
      WHERE s.examId = ?`, exam.id)
    const noteCountAgg = await db.$queryRawUnsafe<{ c: number }[]>(`
      SELECT COUNT(n.id) AS c FROM Note n
      JOIN Topic t ON n.topicId = t.id
      JOIN Unit u ON t.unitId = u.id
      JOIN Subject su ON u.subjectId = su.id
      JOIN Stage s ON su.stageId = s.id
      WHERE s.examId = ?`, exam.id)

    let sourceRefs: { label: string; url: string }[] | null = null
    try { sourceRefs = exam.sourceRefs ? JSON.parse(exam.sourceRefs) : null } catch { sourceRefs = null }

    const dto: ExamDetailDTO = {
      exam: {
        id: exam.id,
        slug: exam.slug,
        name: exam.name,
        shortName: exam.shortName,
        authority: exam.authority,
        categorySlug: exam.categorySlug,
        categoryName: exam.category?.name ?? null,
        state: exam.state,
        description: exam.description,
        featured: exam.featured,
        syllabusStatus: exam.syllabusStatus as ExamDetailDTO['exam']['syllabusStatus'],
        contentNote: exam.contentNote,
        sourceRefs,
        questionSources,
        counts: {
          topics: Number(topicCountAgg[0]?.c ?? 0),
          notes: Number(noteCountAgg[0]?.c ?? 0),
          questions: exam._count.questions,
          resources: exam._count.resources,
          tests: exam._count.templates,
        },
      },
      stages: stages.map(s => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        order: s.order,
        paperNote: s.paperNote,
        pattern: s.patternJson ? safeParse<StagePatternDTO | null>(s.patternJson, null) : null,
        subjects: s.subjects.map(su => ({
          id: su.id,
          slug: su.slug,
          name: su.name,
          description: su.description,
          icon: su.icon,
          order: su.order,
          topicCount: su.units.reduce((a, u) => a + u.topics.length, 0),
          noteCount: su.units.reduce((a, u) => a + u.topics.filter(t => t.notes.length > 0).length, 0),
          questionCount: su._count.questions,
          units: su.units.map(u => ({
            id: u.id,
            slug: u.slug,
            name: u.name,
            order: u.order,
            topics: u.topics.map(t => ({
              id: t.id,
              slug: t.slug,
              name: t.name,
              order: t.order,
              canonicalSlug: t.canonicalSlug,
              noteAvailable: t.notes.length > 0,
              questionCount: t._count.questions,
              resourceCount: t._count.resources,
            })),
          })),
        })),
      })),
      templates: templates.map<TestTemplateDTO>(t => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        description: t.description,
        type: t.type,
        stageName: t.stage?.name ?? null,
        subjectName: t.subject?.name ?? null,
        config: safeParse(t.configJson, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0 }),
      })),
      examResources: examResources.map(r => ({
        id: r.id,
        title: r.title,
        provider: r.provider,
        type: r.type,
        url: r.url,
        language: r.language,
        accessType: r.accessType,
        verificationStatus: r.verificationStatus as ExamDetailDTO['examResources'][number]['verificationStatus'],
        lastChecked: r.lastChecked?.toISOString() ?? null,
        attribution: r.attribution,
        note: r.note,
        fileKind: (r.fileKind ?? null) as ExamDetailDTO['examResources'][number]['fileKind'],
        docDate: r.docDate,
      })),
    }

    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/exams/[slug]]', err)
    return NextResponse.json({ error: 'Failed to load examination' }, { status: 500 })
  }
}
