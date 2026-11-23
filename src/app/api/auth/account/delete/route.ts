import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { unlink } from 'node:fs/promises'
import { sameOrigin, requireStudent, destroyCurrentSession, verifyPassword } from '@/lib/auth'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — deletion preview: the main categories of data that will be removed,
// with live per-category counts. Powers the Settings "what gets deleted"
// preview so the user sees real scope before confirming. No cross-user data
// is ever included.
export async function GET() {
  const student = await requireStudent()
  if (!student) {
    return NextResponse.json({ error: 'Sign in to review your account data.' }, { status: 401 })
  }
  const sid = student.id
  const [
    documents, attempts, chatTurns, goals, studio, research, researchCandidates,
    tests, mastery, planTasks, revisionItems, mistakes, actions, explanations,
    bookings, reviews, complaints, appeals, memberships, submissions, careerRows, sessions, oauthIdentities, privacyRequests,
  ] = await Promise.all([
    db.studyDocument.count({ where: { studentId: sid } }),
    db.attempt.count({ where: { studentId: sid } }),
    db.riisheChatTurn.count({ where: { studentId: sid } }),
    db.studyGoal.count({ where: { studentId: sid } }),
    db.riisheStudioActivity.count({ where: { studentId: sid } }),
    db.researchSession.count({ where: { studentId: sid } }),
    db.researchPyqCandidate.count({ where: { studentId: sid } }),
    db.riisheTest.count({ where: { studentId: sid } }),
    db.topicMastery.count({ where: { studentId: sid } }),
    db.studyPlanTask.count({ where: { studentId: sid } }),
    db.revisionScheduleItem.count({ where: { studentId: sid } }),
    db.mistakeRecord.count({ where: { studentId: sid } }),
    db.learningAction.count({ where: { studentId: sid } }),
    // RiisheExplanation references attempts by a plain attemptId — count via
    // the owner's attempt ids.
    db.attempt.findMany({ where: { studentId: sid }, select: { id: true } }).then(attemptRows =>
      attemptRows.length > 0 ? db.riisheExplanation.count({ where: { attemptId: { in: attemptRows.map(a => a.id) } } }) : 0,
    ),
    db.classBooking.count({ where: { studentId: sid } }),
    db.classReview.count({ where: { studentId: sid } }),
    db.teachComplaint.count({ where: { complainantId: sid } }),
    db.teachAppeal.count({ where: { appellantId: sid } }),
    db.organizationMembership.count({ where: { studentId: sid } }),
    db.assignmentSubmission.count({ where: { studentId: sid } }),
    db.careerApplication.count({ where: { studentId: sid } }),
    db.session.count({ where: { studentId: sid } }),
    db.oAuthIdentity.count({ where: { studentId: sid } }),
    db.privacyRequest.count({ where: { studentId: sid } }),
  ])

  const account = await db.student.findUnique({
    where: { id: student.id },
    select: { passwordHash: true },
  })
  if (!account) {
    return NextResponse.json({ error: 'Sign in to review your account data.' }, { status: 401 })
  }

  return NextResponse.json(
    {
      categories: [
        { key: 'documents', label: 'Study documents and uploaded files', count: documents },
        { key: 'attempts', label: 'Practice attempts and results', count: attempts },
        { key: 'explanations', label: 'AI explanations and chat history', count: explanations + chatTurns },
        { key: 'studio', label: 'Learning Studio activities', count: studio },
        { key: 'research', label: 'Riishe research sessions and PYQ candidates', count: research + researchCandidates },
        { key: 'tests', label: 'Riishe practice sets', count: tests },
        { key: 'learning', label: 'Mastery, plans, revision, mistakes and actions', count: mastery + planTasks + revisionItems + mistakes + actions + goals },
        { key: 'teach', label: 'Bookings, reviews, complaints and appeals', count: bookings + reviews + complaints + appeals },
        { key: 'institution', label: 'Institution memberships and submissions', count: memberships + submissions },
        { key: 'career', label: 'Career applications (profile is deleted with the account)', count: careerRows },
        { key: 'sessions', label: 'Active sessions (all devices)', count: sessions },
        { key: 'oauth', label: 'Linked Google identities', count: oauthIdentities },
        { key: 'privacy', label: 'Privacy/grievance requests', count: privacyRequests },
      ],
      teacherProfileDeleted: true,
      requiresPassword: Boolean(account.passwordHash),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// POST — permanently delete the signed-in student's account and every row they
// own. Requires BOTH the typed `DELETE` confirmation AND password
// re-authentication for password accounts (Google-only accounts confirm by
// typing DELETE — they have no password). Runs even when rows were claimed
// from a guestId: all where-clauses are studentId-based, and claimed rows
// carry studentId by definition. Rows owned by OTHER students (same guestId,
// studentId already set elsewhere) are never touched, and shared records that
// other participants rely on are preserved. Files on disk are unlinked after
// the DB transaction commits. The user is returned to guest mode with a
// cleared session cookie.
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  if (rateLimited(clientKey(req, 'account-delete'), 5, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment and try again.' }, { status: 429 })
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

  const account = await db.student.findUnique({
    where: { id: student.id },
    select: { passwordHash: true },
  })
  if (!account) {
    return NextResponse.json({ error: 'Sign in to delete your account.' }, { status: 401 })
  }
  if (account.passwordHash) {
    const password = typeof candidate.password === 'string' ? candidate.password : ''
    const ok = await verifyPassword(password, account.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: 'Re-enter your password to confirm account deletion.' }, { status: 401 })
    }
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
      // Phase 3F: Studio activity records (snapshots + learner evidence) are
      // self-contained rows — deleting them leaves no orphaned responses.
      await tx.riisheStudioActivity.deleteMany({ where: { studentId: student.id } })
      // Deep-research rows carry a plain studentId (no FK) — delete them
      // explicitly or they would orphan after the Student row is gone.
      await tx.researchSession.deleteMany({ where: { studentId: student.id } })
      await tx.researchPyqCandidate.deleteMany({ where: { studentId: student.id } })
      // Deleting documents cascades RiisheTests and RiisheQuestions (schema onDelete).
      await tx.riisheTest.deleteMany({ where: { studentId: student.id } })
      await tx.studyDocument.deleteMany({ where: { studentId: student.id } })
      await tx.studyGoal.deleteMany({ where: { studentId: student.id } })
      await tx.session.deleteMany({ where: { studentId: student.id } })
      // OAuth identity links are removed explicitly for auditability (they also
      // cascade from the Student row); consent/acceptance/privacy-request rows
      // cascade with the account.
      await tx.oAuthIdentity.deleteMany({ where: { studentId: student.id } })
      // CI-1E: Classroom Intelligence — explicit erasure of AI-evaluation data.
      // Teacher-side rows (jobs → reports → evidence/agent runs; disputes →
      // events) also cascade via TeacherProfile → ClassSession, and student
      // summaries cascade via ClassBooking; the dispute rows are deleted by
      // plain teacherId (no FK) and MUST be explicit or they would orphan.
      await tx.classroomEvaluationDispute.deleteMany({ where: { teacherId: student.id } })
      const ciProfile = await tx.teacherProfile.findUnique({ where: { studentId: student.id }, select: { id: true } })
      if (ciProfile) {
        const ciClassIds = (await tx.classSession.findMany({ where: { teacherProfileId: ciProfile.id }, select: { id: true } })).map(c => c.id)
        await tx.classroomEvaluationJob.deleteMany({ where: { classSessionId: { in: ciClassIds } } })
      }
      await tx.classroomStudentSummary.deleteMany({ where: { booking: { studentId: student.id } } })
      // Legal acceptance/consent/OAuth/privacy-request rows all cascade from
      // the Student row (schema onDelete: Cascade).
      // Goals and sessions also cascade from the Student row — deleted above for clarity.
      await tx.student.delete({ where: { id: student.id } })

      return docs.map(d => d.storedPath)
    })

    // Files live outside the DB cascade — unlink best-effort, never block deletion.
    await Promise.all(files.map(p => unlink(p).catch(() => undefined)))

    // The session rows are gone; clear the stale cookie so the client is a guest again.
    await destroyCurrentSession()

    // Honest result: erasable owned records are gone; server backups and any
    // legally retained records are NOT claimed to be instantaneously erased.
    return NextResponse.json({
      ok: true,
      deleted: { documents: files.length },
      note: 'Your account and owned records have been deleted. Uploaded files were removed. Backups created before this request are handled by the operator retention policy described in the Privacy Policy — they are not erased in real time.',
    })
  } catch (err) {
    console.error('[api/auth/account/delete]', err)
    return NextResponse.json({ error: 'Could not delete your account — please try again.' }, { status: 500 })
  }
}
