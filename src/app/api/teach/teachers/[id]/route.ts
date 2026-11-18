// ─── BEAN Teach (Phase 4A): public teacher profile detail ────────────────────
// GET /api/teach/teachers/:id — public profile details for an APPROVED +
// published teacher, plus their upcoming PUBLISHED classes. Private review
// notes, email addresses and account fields are never returned. A profile that
// is pending, rejected or unpublished is invisible to the public (404).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toPublicTeacher, toPublicClass } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const profile = await db.teacherProfile.findUnique({ where: { id } })
    if (!profile || profile.verificationStatus !== 'APPROVED' || !profile.isPublished) {
      return NextResponse.json({ error: 'Teacher not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    const classes = await db.classSession.findMany({
      where: { teacherProfileId: profile.id, status: 'PUBLISHED', startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 50,
    })

    const publicProfile = toPublicTeacher(profile, classes.length)
    return NextResponse.json(
      {
        teacher: {
          ...publicProfile,
          // Class detail page also shows reviewed qualifications/experience —
          // these were part of the approved profile, so they are public.
          qualificationsText: profile.qualificationsText,
        },
        classes: classes.map((c) => toPublicClass(c, profile)),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/teach/teachers/:id GET]', err)
    return NextResponse.json({ error: 'Could not load the teacher profile — please try again.' }, { status: 500 })
  }
}
