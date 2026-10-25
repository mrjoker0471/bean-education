import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { TopicDetailDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const topic = await db.topic.findUnique({
      where: { id },
      include: {
        unit: {
          include: {
            subject: {
              include: { stage: { include: { exam: true } } },
            },
          },
        },
        notes: true,
        resources: { orderBy: { createdAt: 'asc' } },
        _count: { select: { questions: true, resources: true } },
      },
    })
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    const subject = topic.unit.subject
    const stage = subject.stage
    const exam = stage.exam

    const siblings = await db.topic.findMany({
      where: { unitId: topic.unitId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    })

    let noteSourceRefs: { label: string; url: string }[] | null = null
    const noteRow = topic.notes[0] ?? null
    try { noteSourceRefs = noteRow?.sourceRefs ? JSON.parse(noteRow.sourceRefs) : null } catch { noteSourceRefs = null }

    const dto: TopicDetailDTO = {
      topic: {
        id: topic.id,
        name: topic.name,
        slug: topic.slug,
        description: topic.description,
        canonicalSlug: topic.canonicalSlug,
      },
      breadcrumbs: [
        { label: 'Home', href: '#/' },
        { label: exam.shortName ?? exam.name, href: `#/exam/${exam.slug}` },
        { label: stage.name, href: `#/exam/${exam.slug}?tab=syllabus` },
        { label: subject.name, href: `#/exam/${exam.slug}?tab=syllabus` },
        { label: topic.unit.name, href: `#/exam/${exam.slug}?tab=syllabus` },
        { label: topic.name, href: `#/topic/${topic.id}` },
      ],
      exam: {
        slug: exam.slug,
        name: exam.name,
        shortName: exam.shortName,
        syllabusStatus: exam.syllabusStatus,
        contentNote: exam.contentNote,
      },
      subject: { id: subject.id, name: subject.name },
      siblings,
      note: noteRow
        ? {
            title: noteRow.title,
            markdown: noteRow.markdown,
            version: noteRow.version,
            updatedAt: noteRow.updatedAt.toISOString(),
            sourceRefs: noteSourceRefs,
          }
        : null,
      resources: topic.resources.map(r => ({
        id: r.id,
        title: r.title,
        provider: r.provider,
        type: r.type,
        url: r.url,
        language: r.language,
        accessType: r.accessType,
        verificationStatus: r.verificationStatus as TopicDetailDTO['resources'][number]['verificationStatus'],
        lastChecked: r.lastChecked?.toISOString() ?? null,
        attribution: r.attribution,
        note: r.note,
        fileKind: (r.fileKind ?? null) as TopicDetailDTO['resources'][number]['fileKind'],
        docDate: r.docDate,
      })),
      questionCount: topic._count.questions,
      hasTest: topic._count.questions >= 4,
    }
    void safeParse // keep import used for future pattern parsing
    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/topics/[id]]', err)
    return NextResponse.json({ error: 'Failed to load topic' }, { status: 500 })
  }
}
