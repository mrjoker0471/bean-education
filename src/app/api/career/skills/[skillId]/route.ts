// ─── Phase 7: Career skill edit / remove (owner-only) ────────────────────────
// PATCH reorders or edits; DELETE removes. Ownership is enforced by looking up
// the row by (id, studentId) — other students' rows are unreachable (404).
// The verification label can never be changed by anyone through this route.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { skillUpdateSchema } from '@/lib/career-schema'
import { toSkillDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ skillId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { skillId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = skillUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid skill details' }, { status: 400 })
    const input = parsed.data

    const existing = await db.studentCareerSkill.findFirst({
      where: { id: skillId, studentId: student.id },
    })
    if (!existing) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })

    const updated = await db.studentCareerSkill.update({
      where: { id: existing.id },
      data: {
        skillName: input.skillName ?? undefined,
        proficiency: input.proficiency ?? undefined,
        description: input.description ?? undefined,
        position: input.position ?? undefined,
        // verificationLabel is intentionally absent — immutable here.
      },
    })
    return NextResponse.json({ skill: toSkillDTO(updated) })
  } catch (err) {
    console.error('[api/career/skills/[skillId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the skill.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { skillId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const existing = await db.studentCareerSkill.findFirst({ where: { id: skillId, studentId: student.id } })
    if (!existing) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    await db.studentCareerSkill.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/career/skills/[skillId] DELETE]', err)
    return NextResponse.json({ error: 'Could not remove the skill.' }, { status: 500 })
  }
}
