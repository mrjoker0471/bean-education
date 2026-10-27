import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!)
for (const p of [3, 4]) {
  console.log(`=== page ${p} (all lines) ===`)
  console.log(pages[p-1].text.split('\n').join('\n'))
  console.log()
}
await db.$disconnect()
