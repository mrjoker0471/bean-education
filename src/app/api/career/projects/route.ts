// ─── Phase 7: Career projects (student-owned, PRIVATE by default) ────────────
// Students individually choose which projects are SHARED; external links must
// be HTTPS; private drafts are never exposed in any shared DTO.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { projectCreateSchema } from '@/lib/career-schema'
import { toProjectDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const projects = await db.careerProject.findMany({
      where: { studentId: student.id },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json({ projects: projects.map(toProjectDTO) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/career/projects GET]', err)
    return NextResponse.json({ error: 'Could not load your projects.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = projectCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid project details' }, { status: 400 })
    const input = parsed.data

    const project = await db.careerProject.create({
      data: {
        studentId: student.id,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        skillsUsed: JSON.stringify(input.skillsUsed ?? []),
        projectUrl: input.projectUrl ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        visibility: input.visibility ?? 'PRIVATE',
        status: 'ACTIVE',
      },
    })
    return NextResponse.json({ project: toProjectDTO(project) }, { status: 201 })
  } catch (err) {
    console.error('[api/career/projects POST]', err)
    return NextResponse.json({ error: 'Could not create the project.' }, { status: 500 })
  }
}
