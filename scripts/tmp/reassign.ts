import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
await db.studyDocument.update({ where: { id: doc!.id }, data: { guestId: '759f7313-a98d-4ba1-b2ea-58c6645eb004' } })
console.log('reassigned', doc!.id, 'to browser guest')
await db.$disconnect()
