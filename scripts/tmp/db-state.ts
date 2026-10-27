import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const docs = await db.studyDocument.findMany({ orderBy: { createdAt: 'desc' } })
console.log('docs:', docs.length)
for (const d of docs) {
  console.log(`- ${d.id} guest=${d.guestId} status=${d.status} pages=${d.pageCount} title="${d.title}" file=${d.storedPath}`)
  const a = d.analysisJson ? JSON.parse(d.analysisJson) : null
  if (a) {
    console.log(`  coverage: ${JSON.stringify(a.coverage)}`)
    console.log(`  structure: ${JSON.stringify(a.structure)}`)
    console.log(`  topics: ${a.topics?.length} failedSections: ${(a.sectionOutcomes||[]).filter((o:any)=>o.status==='FAILED').length}`)
  }
  console.log(`  statusDetail: ${d.statusDetail}`)
}
const tests = await db.riisheTest.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })
console.log('tests:', tests.length)
for (const t of tests) console.log(`- ${t.id} doc=${t.documentId} status=${t.status} questions=${t.questionIdsJson ? JSON.parse(t.questionIdsJson).length : 0}`)
await db.$disconnect()
