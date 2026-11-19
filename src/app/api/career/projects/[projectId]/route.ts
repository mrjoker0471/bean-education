// ─── Phase 7: Career project edit / remove (owner-only) ──────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { projectUpdateSchema } from '@/lib/career-schema'
import { toProjectDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ projectId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { projectId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = projectUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid project details' }, { status: 400 })
    const input = parsed.data

    const existing = await db.careerProject.findFirst({ where: { id: projectId, studentId: student.id } })
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const updated = await db.careerProject.update({
      where: { id: existing.id },
      data: {
        title: input.title ?? undefined,
        description: input.description ?? undefined,
        category: input.category === undefined ? undefined : input.category,
        skillsUsed: input.skillsUsed ? JSON.stringify(input.skillsUsed) : undefined,
        projectUrl: input.projectUrl === undefined ? undefined : input.projectUrl,
        startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null,
        visibility: input.visibility ?? undefined,
        status: input.status ?? undefined,
      },
    })
    return NextResponse.json({ project: toProjectDTO(updated) })
  } catch (err) {
    console.error('[api/career/projects/[projectId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the project.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { projectId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const existing = await db.careerProject.findFirst({ where: { id: projectId, studentId: student.id } })
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    await db.careerProject.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/career/projects/[projectId] DELETE]', err)
    return NextResponse.json({ error: 'Could not remove the project.' }, { status: 500 })
  }
}
