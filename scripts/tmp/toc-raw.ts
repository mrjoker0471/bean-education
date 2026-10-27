import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!)
for (const p of [3,4,5]) {
  console.log(`===== page ${p} =====`)
  console.log(pages[p-1].text.split('\n').slice(0,40).join('\n'))
}
await db.$disconnect()
