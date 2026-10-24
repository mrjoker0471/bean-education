import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadContentMaps, serializeExam } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim()
    const category = searchParams.get('category')?.trim()
    const state = searchParams.get('state')?.trim()
    const featured = searchParams.get('featured') === '1'

    const where: Record<string, unknown> = {}
    if (featured) where.featured = true
    if (category) where.categorySlug = category
    if (state) where.state = { contains: state }

    if (search) {
      const cond = { contains: search }
      where.OR = [
        { name: cond },
        { shortName: cond },
        { authority: cond },
        { state: cond },
        { description: cond },
        { category: { is: { name: cond } } },
      ]
    }

    const [rows, { topicCounts, noteCounts }] = await Promise.all([
      db.exam.findMany({
        where,
        include: { _count: { select: { questions: true, resources: true, templates: true } } },
        orderBy: [{ featured: 'desc' }, { name: 'asc' }],
        take: 200,
      }),
      loadContentMaps(),
    ])

    return NextResponse.json({
      exams: rows.map(e => serializeExam(e, topicCounts, noteCounts)),
      total: rows.length,
    })
  } catch (err) {
    console.error('[api/exams]', err)
    return NextResponse.json({ error: 'Failed to search exams' }, { status: 500 })
  }
}
