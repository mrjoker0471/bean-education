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

    const [explanationsDeleted, chatDeleted, attemptsDeleted, testsDeleted, docsDeleted] = await db.$transaction([
      db.riisheExplanation.deleteMany({ where: { attemptId: { in: attemptIds.map(a => a.id) } } }),
      db.riisheChatTurn.deleteMany({ where: { guestId } }),
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
      },
    })
  } catch (err) {
    console.error('[api/account DELETE]', err)
    return NextResponse.json({ error: 'Could not delete your data — please try again.' }, { status: 500 })
  }
}
