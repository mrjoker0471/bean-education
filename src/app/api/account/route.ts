import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { deleteStoredFile } from '@/lib/riishe/pipeline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
})

/**
 * DELETE — privacy control: permanently delete everything this guest owns
 * (uploads on disk, documents, analyses, practice sets, questions, attempts,
 * explanations and chat turns). Called from Settings with an explicit
 * confirmation. The guest identity itself stays on the device until the
 * student resets their session locally.
 */
export async function DELETE(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId } = parsed.data

    // Files first (they live outside the DB cascade)
    const docs = await db.studyDocument.findMany({
      where: { guestId },
      select: { id: true, storedPath: true },
    })
    await Promise.all(docs.map(d => deleteStoredFile(d.storedPath)))

    const attemptIds = await db.attempt.findMany({
      where: { guestId },
      select: { id: true },
    })

    const [explanationsDeleted, chatDeleted, mistakesDeleted, actionsDeleted, planDeleted, revisionDeleted, masteryDeleted, studioDeleted, attemptsDeleted, testsDeleted, docsDeleted] = await db.$transaction([
      db.riisheExplanation.deleteMany({ where: { attemptId: { in: attemptIds.map(a => a.id) } } }),
      db.riisheChatTurn.deleteMany({ where: { guestId } }),
      // Phase 3B: learning rows reference attempts by plain FKs — purge them
      // before the attempts they cite.
      db.mistakeRecord.deleteMany({ where: { guestId } }),
      db.learningAction.deleteMany({ where: { guestId } }),
      db.studyPlanTask.deleteMany({ where: { guestId } }),
      db.revisionScheduleItem.deleteMany({ where: { guestId } }),
      db.topicMastery.deleteMany({ where: { guestId } }),
      // Phase 3F: Studio activity records (self-contained rows — no orphans).
      db.riisheStudioActivity.deleteMany({ where: { guestId } }),
      db.attempt.deleteMany({ where: { guestId } }),
      db.riisheTest.deleteMany({ where: { guestId } }),
      db.studyDocument.deleteMany({ where: { guestId } }),
    ])

    return NextResponse.json({
      ok: true,
      deleted: {
        documents: docsDeleted.count,
        tests: testsDeleted.count,
        attempts: attemptsDeleted.count,
        explanations: explanationsDeleted.count,
        chatTurns: chatDeleted.count,
        files: docs.length,
        learningRows: mistakesDeleted.count + actionsDeleted.count + planDeleted.count + revisionDeleted.count + masteryDeleted.count,
        studioActivities: studioDeleted.count,
      },
    })
  } catch (err) {
    console.error('[api/account DELETE]', err)
    return NextResponse.json({ error: 'Could not delete your data — please try again.' }, { status: 500 })
  }
}
