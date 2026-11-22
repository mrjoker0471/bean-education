import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { sameOrigin, requireStudent } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
})

// POST — claim guest-owned rows into the signed-in student's account. The where
// clause matches `guestId AND studentId: null`, so rows already owned by another
// student are NEVER deleted or overwritten — guestId stays untouched on every
// row and claim is idempotent (re-claiming claims nothing).
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const student = await requireStudent()
  if (!student) {
    return NextResponse.json({ error: 'Sign in to claim your guest progress.' }, { status: 401 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }

  const candidate = (raw ?? {}) as Record<string, unknown>
  const parsed = bodySchema.safeParse({
    guestId: typeof candidate.guestId === 'string' ? candidate.guestId : undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { guestId } = parsed.data

  try {
    const [attempts, documents, tests, chatTurns, researchSessions, researchCandidates, masteryRows, planTasks, revisionItems, mistakeRows, actionRows, studioActivities] = await db.$transaction([
      db.attempt.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.studyDocument.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.riisheTest.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.riisheChatTurn.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      // Phase 3A: research sessions + discovery candidates join the claim too.
      db.researchSession.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.researchPyqCandidate.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      // Phase 3B: personal learning intelligence state is claimed like everything else.
      db.topicMastery.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.studyPlanTask.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.revisionScheduleItem.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.mistakeRecord.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      db.learningAction.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
      // Phase 3F: Studio activities (validated snapshots + learner evidence)
      // join the claim like every other learner table.
      db.riisheStudioActivity.updateMany({ where: { guestId, studentId: null }, data: { studentId: student.id } }),
    ])

    return NextResponse.json({
      claims: {
        attempts: attempts.count,
        documents: documents.count,
        tests: tests.count,
        chatTurns: chatTurns.count,
        learningRows: masteryRows.count + planTasks.count + revisionItems.count + mistakeRows.count + actionRows.count,
        studioActivities: studioActivities.count,
      },
    })
  } catch (err) {
    console.error('[api/auth/claim-guest]', err)
    return NextResponse.json({ error: 'Could not claim your guest progress — please try again.' }, { status: 500 })
  }
}
