import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
const pages = JSON.parse(doc.extractionJson!)
for (const pn of [68]) {
  const p = pages.find((x: any) => x.page === pn)
  console.log(`════ page ${pn} (chars=${p.chars}) ════`)
  console.log(p.text)
}
await db.$disconnect()
