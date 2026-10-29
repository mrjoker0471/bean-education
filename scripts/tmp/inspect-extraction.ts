import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
if (!doc) { console.log('NOT FOUND'); process.exit(0) }
const pages = JSON.parse(doc.extractionJson!)
console.log('pages stored:', pages.length)
const scanned = pages.filter((p: any) => p.scanned)
console.log('scanned pages:', JSON.stringify(scanned.map((p: any) => ({ page: p.page, chars: p.chars, text: p.text.slice(0, 100) }))))
const contentless = [35,69,70,71,76,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95]
for (const pn of contentless) {
  const p = pages.find((x: any) => x.page === pn)
  console.log(`--- page ${pn} (chars=${p.chars}) ---`)
  console.log(JSON.stringify(p.text.slice(0, 300)))
}
await db.$disconnect()
