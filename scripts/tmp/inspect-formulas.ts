import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
const a = JSON.parse(doc.analysisJson!)
console.log('════ stored formulas ════')
for (const f of a.formulas) console.log(`• ${f}`)
const pages = JSON.parse(doc.extractionJson!)
for (const pn of [59, 60]) {
  const p = pages.find((x: any) => x.page === pn)
  console.log(`════ page ${pn} (chars=${p.chars}) ════`)
  console.log(p.text.slice(0, 2600))
}
await db.$disconnect()
