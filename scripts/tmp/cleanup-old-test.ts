import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const old = await db.riisheTest.findFirst({ where: { id: 'cmvq8unww0003t2vhnjqrs8pj' } })
if (old) {
  await db.riisheQuestion.deleteMany({ where: { testId: old.id } })
  await db.riisheTest.delete({ where: { id: old.id } })
  console.log('deleted stale mislabelled test row')
} else console.log('already gone')
await db.$disconnect()
