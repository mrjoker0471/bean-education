import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tests = await db.riisheTest.findMany({ orderBy: { createdAt: 'desc' }, take: 3 })
for (const t of tests) console.log(`- ${t.status} req=${t.requestedCount} detail=${t.statusDetail?.slice(0,140)}`)
await db.$disconnect()
