// ─── Phase 7: Career profile (student-owned, PRIVATE by default) ─────────────
// GET returns the caller's own profile (created lazily as PRIVATE on first
// read). POST creates it explicitly; PATCH updates fields or changes
// visibility. Visibility changes are honored immediately by discovery and
// profile endpoints (PAUSED hides without destroying the consent choice).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { CAREER_VISIBILITY } from '@/lib/career'
import { careerProfileCreateSchema, careerProfileUpdateSchema } from '@/lib/career-schema'
import { toCareerProfileDTO } from '@/lib/career-dto'
import { appendCareerAudit } from '@/lib/career'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let profile = await db.careerProfile.findUnique({ where: { studentId: student.id } })
    if (!profile) {
      profile = await db.careerProfile.create({
        data: { studentId: student.id, visibility: CAREER_VISIBILITY.PRIVATE },
      })
    }
    const eligibility = await db.careerEligibilityReview.findUnique({ where: { studentId: student.id } })
    return NextResponse.json(
      {
        profile: toCareerProfileDTO(profile),
        eligibility: eligibility
          ? { status: eligibility.status, requestedAt: eligibility.requestedAt?.toISOString() ?? null, reviewedAt: eligibility.reviewedAt?.toISOString() ?? null, decisionReason: eligibility.decisionReason }
          : { status: 'NOT_ELIGIBLE', requestedAt: null, reviewedAt: null, decisionReason: null },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/profile GET]', err)
    return NextResponse.json({ error: 'Could not load your career profile.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = careerProfileCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid profile details' }, { status: 400 })
    const input = parsed.data

    const existing = await db.careerProfile.findUnique({ where: { studentId: student.id } })
    if (existing) return NextResponse.json({ profile: toCareerProfileDTO(existing), unchanged: true })

    const created = await db.careerProfile.create({
      data: {
        studentId: student.id,
        headline: input.headline ?? null,
        summary: input.summary ?? null,
        preferredRoleTypes: JSON.stringify(input.preferredRoleTypes ?? []),
        preferredSkills: JSON.stringify(input.preferredSkills ?? []),
        preferredLocations: JSON.stringify(input.preferredLocations ?? []),
        workModes: JSON.stringify(input.workModes ?? []),
        publicSlug: input.publicSlug ?? null,
        visibility: CAREER_VISIBILITY.PRIVATE, // always starts private
      },
    })
    await appendCareerAudit(db, {
      entityType: 'CAREER_PROFILE',
      entityId: created.id,
      actorId: student.id,
      actorRole: student.role,
      action: 'PROFILE_CREATED',
    })
    return NextResponse.json({ profile: toCareerProfileDTO(created) }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'That portfolio address is already taken.' }, { status: 409 })
    }
    console.error('[api/career/profile POST]', err)
    return NextResponse.json({ error: 'Could not create your career profile.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = careerProfileUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid profile details' }, { status: 400 })
    const input = parsed.data

    const profile = await db.careerProfile.findUnique({ where: { studentId: student.id } })
    if (!profile) return NextResponse.json({ error: 'Create your career profile first.' }, { status: 404 })

    const updated = await db.careerProfile.update({
      where: { studentId: student.id },
      data: {
        headline: input.headline ?? undefined,
        summary: input.summary ?? undefined,
        preferredRoleTypes: input.preferredRoleTypes ? JSON.stringify(input.preferredRoleTypes) : undefined,
        preferredSkills: input.preferredSkills ? JSON.stringify(input.preferredSkills) : undefined,
        preferredLocations: input.preferredLocations ? JSON.stringify(input.preferredLocations) : undefined,
        workModes: input.workModes ? JSON.stringify(input.workModes) : undefined,
        publicSlug: input.publicSlug === undefined ? undefined : input.publicSlug,
        // PAUSED/PRIVATE take effect immediately for discovery; the eligibility
        // review (APPROVED status) is a separate, unchanged server-side gate.
        visibility: input.visibility ?? undefined,
      },
    })
    if (input.visibility && input.visibility !== profile.visibility) {
      await appendCareerAudit(db, {
        entityType: 'CAREER_PROFILE',
        entityId: updated.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'VISIBILITY_CHANGED',
        detail: `${profile.visibility}->${input.visibility}`,
      })
    }
    return NextResponse.json({ profile: toCareerProfileDTO(updated) })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'That portfolio address is already taken.' }, { status: 409 })
    }
    console.error('[api/career/profile PATCH]', err)
    return NextResponse.json({ error: 'Could not update your career profile.' }, { status: 500 })
  }
}
