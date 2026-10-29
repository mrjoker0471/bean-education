import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const guest = 'e2e-upgrade-guest-001'
const docs = await db.studyDocument.findMany({ where: { guestId: guest }, select: { id: true } })
const tests = await db.riisheTest.findMany({ where: { guestId: guest }, select: { id: true } })
for (const t of tests) {
  const qs = await db.riisheQuestion.findMany({ where: { testId: t.id }, select: { id: true } })
  if (qs.length) {
    await db.riisheExplanation.deleteMany({ where: { questionId: { in: qs.map(q => q.id) } } })
    await db.riisheChatTurn.deleteMany({ where: { questionId: { in: qs.map(q => q.id) } } })
  }
  await db.riisheQuestion.deleteMany({ where: { testId: t.id } })
  await db.attempt.deleteMany({ where: { riisheTestId: t.id } })
  await db.riisheTest.delete({ where: { id: t.id } })
}
for (const d of docs) {
  await db.studyDocument.delete({ where: { id: d.id } }).catch(() => {})
  try { await unlink(`/home/z/my-project/db/uploads/${d.id}.pdf`) } catch {}
}
console.log(`cleaned ${tests.length} tests, ${docs.length} docs for ${guest}`)
import { unlink } from 'node:fs/promises'
await db.$disconnect()
