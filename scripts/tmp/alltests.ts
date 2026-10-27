import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tests = await db.riisheTest.findMany({ orderBy: { createdAt: 'desc' } })
console.log('total tests:', tests.length)
for (const t of tests) console.log(`- ${t.id} status=${t.status} created=${t.createdAt.toISOString()} detail=${t.statusDetail?.slice(0,80)}`)
await db.$disconnect()
