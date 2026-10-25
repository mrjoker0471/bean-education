import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { ResourceMetaDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/resources/:id
 * Metadata for the integrated PDF viewer: the resource itself plus the
 * exam/subject/topic context so the viewer can build honest "Back to
 * Study Material" / "Back to topic" navigation and hand off context.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const resource = await db.resource.findUnique({
      where: { id },
      include: {
        exam: { select: { slug: true, name: true, shortName: true, authority: true } },
        topic: {
          select: {
            id: true,
            name: true,
            unit: { select: { subject: { select: { name: true, stage: { select: { name: true, exam: { select: { slug: true, name: true, shortName: true, authority: true } } } } } } } },
          },
        },
      },
    })

    if (!resource) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    // Topic-level resources carry their own exam chain; exam-level resources
    // use the direct exam relation.
    const examFromTopic = resource.topic?.unit.subject.stage.exam ?? null
    const exam = resource.exam ?? examFromTopic

    const context: ResourceMetaDTO['context'] = {
      origin: resource.topicId && resource.topic ? 'topic' : exam ? 'exam' : 'none',
      examSlug: exam?.slug ?? null,
      examName: exam?.name ?? null,
      examShortName: exam?.shortName ?? null,
      authority: exam?.authority ?? resource.provider,
      stageName: resource.topic?.unit.subject.stage.name ?? null,
      subjectName: resource.topic?.unit.subject.name ?? null,
      topicId: resource.topic?.id ?? null,
      topicName: resource.topic?.name ?? null,
    }

    const dto: ResourceMetaDTO = {
      resource: {
        id: resource.id,
        title: resource.title,
        provider: resource.provider,
        type: resource.type,
        url: resource.url,
        language: resource.language,
        accessType: resource.accessType,
        verificationStatus: resource.verificationStatus as ResourceMetaDTO['resource']['verificationStatus'],
        lastChecked: resource.lastChecked?.toISOString() ?? null,
        attribution: resource.attribution,
        note: resource.note,
        fileKind: (resource.fileKind ?? null) as ResourceMetaDTO['resource']['fileKind'],
        docDate: resource.docDate,
      },
      context,
    }

    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/resources/[id]]', err)
    return NextResponse.json({ error: 'Failed to load resource' }, { status: 500 })
  }
}
