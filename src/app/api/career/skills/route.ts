// ─── Phase 7: Career skills (student-owned) ──────────────────────────────────
// GET lists the caller's skills ordered by position; POST adds one. The
// verification label is ALWAYS server-forced to SELF_DECLARED on this route —
// INSTITUTION_ISSUED arrives only through real credential issuance, and
// BEAN_ASSESSMENT_VERIFIED cannot be produced anywhere in Phase 7 (no
// assessment process exists).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { SKILL_LIST_MAX } from '@/lib/career'
import { skillCreateSchema } from '@/lib/career-schema'
import { toSkillDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const skills = await db.studentCareerSkill.findMany({
      where: { studentId: student.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ skills: skills.map(toSkillDTO) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/career/skills GET]', err)
    return NextResponse.json({ error: 'Could not load your skills.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = skillCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid skill details' }, { status: 400 })
    const input = parsed.data

    const count = await db.studentCareerSkill.count({ where: { studentId: student.id } })
    if (count >= SKILL_LIST_MAX) {
      return NextResponse.json({ error: `You can list up to ${SKILL_LIST_MAX} skills.` }, { status: 409 })
    }

    const skill = await db.studentCareerSkill.create({
      data: {
        studentId: student.id,
        skillName: input.skillName,
        proficiency: input.proficiency ?? null,
        description: input.description ?? null,
        verificationLabel: 'SELF_DECLARED', // server-forced truthfulness
        position: input.position ?? count,
      },
    })
    return NextResponse.json({ skill: toSkillDTO(skill) }, { status: 201 })
  } catch (err) {
    console.error('[api/career/skills POST]', err)
    return NextResponse.json({ error: 'Could not add the skill.' }, { status: 500 })
  }
}
