import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const docs = await db.studyDocument.findMany({ select: { id: true, title: true, status: true, pageCount: true, guestId: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } })
for (const d of docs) console.log(d.id, '|', d.status, '|', d.pageCount, '|', d.guestId, '|', d.title.slice(0, 60))
console.log('total:', docs.length)
await db.$disconnect()
