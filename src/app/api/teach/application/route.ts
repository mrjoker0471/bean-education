// ─── BEAN Teach (Phase 4A): teacher application lifecycle ────────────────────
// GET    /api/teach/application — the signed-in student's own application
//        status (null when NOT_APPLIED). Never exposes other applicants.
// POST   /api/teach/application — first application (SUBMIT) or resubmission
//        after rejection (RESUBMIT). Duplicate simultaneous applications are
//        prevented by the unique studentId constraint (→ 409).
// PATCH  /api/teach/application — edits where permitted. Verification-relevant
//        edits return the application to PENDING (RESUBMIT from REJECTED/
//        PENDING; EDIT_REVIEW from APPROVED — an approved teacher whose
//        qualifications change must be re-reviewed; classes stay hidden from
//        the marketplace until an admin re-approves). Review history is
//        append-only and never erased.
//
// Privacy: the form deliberately does NOT collect date of birth, bank details
// or government identity documents. Review notes stay private (applicant +
// admins only). Guests are refused (401); there is no public application data.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { appendAudit, AUDIT_ACTION, AUDIT_ENTITY, TEACH_STATUS, toApplicationDTO, VERIFICATION_RELEVANT_FIELDS, isValidOptionalUrl } from '@/lib/teach'
import { teachApplicationPatchSchema, teachApplicationSchema } from '@/lib/teach-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the current student's application status.
export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    const profile = await db.teacherProfile.findUnique({ where: { studentId: student.id } })
    if (!profile) {
      return NextResponse.json({ application: null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const history = await db.teachAuditEvent.findMany({
      where: { entityType: AUDIT_ENTITY.TEACHER_PROFILE, entityId: profile.id },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ application: toApplicationDTO(profile, history) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/teach/application GET]', err)
    return NextResponse.json({ error: 'Could not load your application — please try again.' }, { status: 500 })
  }
}

// POST — create (SUBMIT) or resubmit after rejection (RESUBMIT).
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = teachApplicationSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid application — check every field and try again.' }, { status: 400 })
    }
    const data = parsed.data
    if (!isValidOptionalUrl(data.portfolioUrl ?? null)) {
      return NextResponse.json({ error: 'Portfolio URL must be a valid http(s) link.' }, { status: 400 })
    }

    const profileData = {
      teachingName: data.teachingName,
      headline: data.headline,
      bio: data.bio,
      subjectsJson: JSON.stringify(data.subjects),
      levelsJson: JSON.stringify(data.levels),
      languagesJson: JSON.stringify(data.languages),
      qualificationsText: data.qualificationsText,
      experienceYears: data.experienceYears,
      portfolioUrl: data.portfolioUrl || null,
    }

    const existing = await db.teacherProfile.findUnique({ where: { studentId: student.id } })
    if (existing) {
      if (existing.verificationStatus === TEACH_STATUS.PENDING) {
        return NextResponse.json({ error: 'Your application is already under review — edit it instead of resubmitting.' }, { status: 409 })
      }
      if (existing.verificationStatus === TEACH_STATUS.APPROVED) {
        return NextResponse.json({ error: 'You are an approved teacher — edit your profile instead of resubmitting.' }, { status: 409 })
      }
      // REJECTED → correct + resubmit. Same row (unique studentId), previous
      // review history preserved in TeachAuditEvent.
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.teacherProfile.update({
          where: { id: existing.id },
          data: {
            ...profileData,
            verificationStatus: TEACH_STATUS.PENDING,
            isPublished: false,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
          },
        })
        await appendAudit(tx, {
          entityType: AUDIT_ENTITY.TEACHER_PROFILE,
          entityId: row.id,
          actorId: student.id,
          actorRole: student.role,
          action: AUDIT_ACTION.RESUBMIT,
          detail: 'Applicant corrected their information and resubmitted after rejection.',
        })
        return row
      })
      return NextResponse.json({ application: toApplicationDTO(updated, []) }, { status: 200 })
    }

    // First application.
    try {
      const created = await db.$transaction(async (tx) => {
        const row = await tx.teacherProfile.create({
          data: { studentId: student.id, ...profileData, verificationStatus: TEACH_STATUS.PENDING },
        })
        await appendAudit(tx, {
          entityType: AUDIT_ENTITY.TEACHER_PROFILE,
          entityId: row.id,
          actorId: student.id,
          actorRole: student.role,
          action: AUDIT_ACTION.SUBMIT,
          detail: 'Teacher application submitted.',
        })
        return row
      })
      return NextResponse.json({ application: toApplicationDTO(created, []) }, { status: 201 })
    } catch (err) {
      // Race: two simultaneous submits — the unique studentId constraint wins.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'An application already exists for this account.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('[api/teach/application POST]', err)
    return NextResponse.json({ error: 'Could not submit your application — please try again.' }, { status: 500 })
  }
}

// PATCH — edit fields where permitted; verification-relevant edits re-trigger review.
export async function PATCH(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = teachApplicationPatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid update — check the fields and try again.' }, { status: 400 })
    }
    const data = parsed.data
    if (data.portfolioUrl !== undefined && !isValidOptionalUrl(data.portfolioUrl)) {
      return NextResponse.json({ error: 'Portfolio URL must be a valid http(s) link.' }, { status: 400 })
    }

    const profile = await db.teacherProfile.findUnique({ where: { studentId: student.id } })
    if (!profile) {
      return NextResponse.json({ error: 'No teacher application found — submit one first.' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (data.teachingName !== undefined) updates.teachingName = data.teachingName
    if (data.headline !== undefined) updates.headline = data.headline
    if (data.bio !== undefined) updates.bio = data.bio
    if (data.subjects !== undefined) updates.subjectsJson = JSON.stringify(data.subjects)
    if (data.levels !== undefined) updates.levelsJson = JSON.stringify(data.levels)
    if (data.languages !== undefined) updates.languagesJson = JSON.stringify(data.languages)
    if (data.qualificationsText !== undefined) updates.qualificationsText = data.qualificationsText
    if (data.experienceYears !== undefined) updates.experienceYears = data.experienceYears
    if (data.portfolioUrl !== undefined) updates.portfolioUrl = data.portfolioUrl || null

    const touchesVerificationRelevant = VERIFICATION_RELEVANT_FIELDS.some((f) => data[f] !== undefined)
    const touchesVisibility = data.isPublished !== undefined

    if (touchesVisibility && profile.verificationStatus !== TEACH_STATUS.APPROVED) {
      return NextResponse.json({ error: 'Marketplace visibility is available to approved teachers only.' }, { status: 409 })
    }
    if (!touchesVerificationRelevant && !touchesVisibility) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    // Re-review rule: an APPROVED teacher who edits verification-relevant
    // details loses the silent-preserving shortcut — the profile returns to
    // PENDING, is unpublished, and their classes vanish from the public
    // marketplace until an admin re-approves.
    const forcesReReview = touchesVerificationRelevant && profile.verificationStatus === TEACH_STATUS.APPROVED
    const resubmitsFromReview = touchesVerificationRelevant && profile.verificationStatus !== TEACH_STATUS.APPROVED

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.teacherProfile.update({
        where: { id: profile.id },
        data: {
          ...updates,
          ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
          ...(forcesReReview
            ? { verificationStatus: TEACH_STATUS.PENDING, isPublished: false, reviewedBy: null, reviewedAt: null, reviewNote: null }
            : {}),
        },
      })
      if (forcesReReview) {
        await appendAudit(tx, {
          entityType: AUDIT_ENTITY.TEACHER_PROFILE,
          entityId: row.id,
          actorId: student.id,
          actorRole: student.role,
          action: AUDIT_ACTION.EDIT_REVIEW,
          detail: 'Approved teacher edited verification-relevant details — profile returned to PENDING for re-review.',
        })
      } else if (resubmitsFromReview) {
        await appendAudit(tx, {
          entityType: AUDIT_ENTITY.TEACHER_PROFILE,
          entityId: row.id,
          actorId: student.id,
          actorRole: student.role,
          action: AUDIT_ACTION.RESUBMIT,
          detail: 'Applicant edited their application.',
        })
      } else if (touchesVisibility) {
        await appendAudit(tx, {
          entityType: AUDIT_ENTITY.TEACHER_PROFILE,
          entityId: row.id,
          actorId: student.id,
          actorRole: student.role,
          action: 'PUBLISH_TOGGLE',
          detail: `Teacher set marketplace visibility to ${data.isPublished ? 'published' : 'unpublished'}.`,
        })
      }
      return row
    })

    return NextResponse.json({ application: toApplicationDTO(updated, []) })
  } catch (err) {
    console.error('[api/teach/application PATCH]', err)
    return NextResponse.json({ error: 'Could not update your application — please try again.' }, { status: 500 })
  }
}
