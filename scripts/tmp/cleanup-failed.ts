import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const failed = await db.riisheTest.findMany({ where: { status: 'FAILED' } })
for (const t of failed) {
  await db.riisheQuestion.deleteMany({ where: { testId: t.id } })
  await db.riisheTest.delete({ where: { id: t.id } })
}
console.log('deleted', failed.length, 'failed test rows')
await db.$disconnect()
