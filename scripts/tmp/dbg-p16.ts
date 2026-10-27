import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!)
for (const p of [14, 16]) {
  console.log(`=== page ${p} lines 1-28 ===`)
  console.log(pages[p-1].text.split('\n').slice(0, 28).map((l,i)=>`${i}: ${JSON.stringify(l.slice(0,80))}`).join('\n'))
}
await db.$disconnect()
