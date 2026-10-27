import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const res = await fetch('http://localhost:3000/api/riishe/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guestId: doc!.guestId,
    documentId: doc!.id,
    focusTopics: ['IV Procedure for Online Payment of Fees and Helpline for Payment-Related Queries'],
    timed: false,
    count: 20,
  }),
})
console.log('POST generate:', res.status, (await res.text()).slice(0, 200))
await db.$disconnect()
