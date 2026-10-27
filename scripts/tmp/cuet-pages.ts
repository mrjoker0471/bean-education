import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!)
for (const p of [5, 6, 7]) {
  console.log(`=== page ${p} (first 22 lines) ===`)
  console.log(pages[p-1].text.split('\n').slice(0, 22).join('\n'))
}
console.log('=== page 20 last 4 lines ===', JSON.stringify(pages[19].text.split('\n').slice(-4)))
console.log('=== page 30 last 4 lines ===', JSON.stringify(pages[29].text.split('\n').slice(-4)))
console.log('=== page 50 last 4 lines ===', JSON.stringify(pages[49].text.split('\n').slice(-4)))
console.log('=== page 90 last 4 lines ===', JSON.stringify(pages[89].text.split('\n').slice(-4)))
await db.$disconnect()
