import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadContentMaps, serializeExam } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [categories, featuredRaw, { topicCounts, noteCounts }] = await Promise.all([
      db.category.findMany({ orderBy: { name: 'asc' } }),
      db.exam.findMany({
        where: { featured: true },
        include: { _count: { select: { questions: true, resources: true, templates: true } } },
        take: 8,
      }),
      loadContentMaps(),
    ])

    const categoryCounts = await db.exam.groupBy({
      by: ['categorySlug'],
      _count: { _all: true },
    })
    const countBySlug = new Map(categoryCounts.map(c => [c.categorySlug, c._count._all]))

    const totals = {
      exams: await db.exam.count(),
      topics: await db.topic.count(),
      notes: await db.note.count(),
      questions: await db.question.count(),
      resources: await db.resource.count(),
      tests: await db.testTemplate.count(),
    }

    // unique original notes authored (canonical library) vs topic links
    const uniqueNotes = await db.$queryRawUnsafe<{ c: number }[]>(
      'SELECT COUNT(DISTINCT canonicalSlug) as c FROM Note'
    )

    return NextResponse.json({
      categories: categories.map(c => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        examCount: countBySlug.get(c.slug) ?? 0,
      })),
      featured: featuredRaw.map(e => serializeExam(e, topicCounts, noteCounts)),
      totals: { ...totals, uniqueNotes: Number(uniqueNotes[0]?.c ?? 0) },
    })
  } catch (err) {
    console.error('[api/catalog]', err)
    return NextResponse.json({ error: 'Failed to load catalogue' }, { status: 500 })
  }
}
