import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { unlink } from 'node:fs/promises'
import { sameOrigin, requireStudent, destroyCurrentSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — permanently delete the signed-in student's account and every row they
// own. Runs even when rows were claimed from a guestId: all where-clauses are
// studentId-based, and claimed rows carry studentId by definition. Rows owned
// by OTHER students (same guestId, studentId already set elsewhere) are never
// touched. Files on disk are unlinked after the DB transaction commits.
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const student = await requireStudent()
  if (!student) {
    return NextResponse.json({ error: 'Sign in to delete your account.' }, { status: 401 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }

  const candidate = (raw ?? {}) as Record<string, unknown>
  if (candidate.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm account deletion.' }, { status: 400 })
  }

  try {
    const files: string[] = await db.$transaction(async tx => {
      // Collect first (inside the transaction — no race between read and delete).
      const attempts = await tx.attempt.findMany({ where: { studentId: student.id }, select: { id: true } })
      const docs = await tx.studyDocument.findMany({
        where: { studentId: student.id },
        select: { id: true, storedPath: true },
      })

      // Explanations reference attempts via a plain FK (no cascade) — clean them first.
      await tx.riisheExplanation.deleteMany({ where: { attemptId: { in: attempts.map(a => a.id) } } })

      await tx.attempt.deleteMany({ where: { studentId: student.id } })
      await tx.riisheChatTurn.deleteMany({ where: { studentId: student.id } })
      // Phase 3B: personal learning intelligence rows reference attempts by
      // plain FKs — purge them before the attempts they cite.
      await tx.mistakeRecord.deleteMany({ where: { studentId: student.id } })
      await tx.learningAction.deleteMany({ where: { studentId: student.id } })
      await tx.studyPlanTask.deleteMany({ where: { studentId: student.id } })
      await tx.revisionScheduleItem.deleteMany({ where: { studentId: student.id } })
      await tx.topicMastery.deleteMany({ where: { studentId: student.id } })
      // Deleting documents cascades RiisheTests and RiisheQuestions (schema onDelete).
      await tx.riisheTest.deleteMany({ where: { studentId: student.id } })
      await tx.studyDocument.deleteMany({ where: { studentId: student.id } })
      await tx.studyGoal.deleteMany({ where: { studentId: student.id } })
      await tx.session.deleteMany({ where: { studentId: student.id } })
      // Goals and sessions also cascade from the Student row — deleted above for clarity.
      await tx.student.delete({ where: { id: student.id } })

      return docs.map(d => d.storedPath)
    })

    // Files live outside the DB cascade — unlink best-effort, never block deletion.
    await Promise.all(files.map(p => unlink(p).catch(() => undefined)))

    // The session rows are gone; clear the stale cookie so the client is a guest again.
    await destroyCurrentSession()

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/auth/account/delete]', err)
    return NextResponse.json({ error: 'Could not delete your account — please try again.' }, { status: 500 })
  }
}
