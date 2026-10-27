import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const a = JSON.parse(doc!.analysisJson!)
console.log('== all 35 section outcomes ==')
for (const o of a.sectionOutcomes ?? []) console.log(`#${o.index} ${o.status} "${o.title}" ${o.fromPage}-${o.toPage}`)
// reconstruct units coverage
const covered = new Set<number>()
for (const o of a.sectionOutcomes ?? []) for (let p=o.fromPage;p<=o.toPage;p++) covered.add(p)
console.log('readable pages 44-96 covered by units:', [...covered].filter(p=>p>=44).join(','))
await db.$disconnect()
