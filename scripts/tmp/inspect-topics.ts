import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const a = JSON.parse(doc!.analysisJson!)
console.log('== topics:', a.topics.length, '==')
for (const t of a.topics) {
  console.log(`L${t.level} [${t.id}] "${t.name}" parent=${t.parentId ?? '-'} pages=[${t.pages.slice(0,8).join(',')}${t.pages.length>8?'…':''}]${t.aliases?.length?` aliases=[${t.aliases.join('|')}]`:''}${t.printedPages?` printed=[${t.printedPages.slice(0,4).join(',')}]`:''}${t.pageVerified===false?' ⚠UNVERIFIED':''}`)
}
console.log('\n== failed sections ==')
for (const o of a.sectionOutcomes ?? []) if (o.status === 'FAILED') console.log(JSON.stringify(o))
console.log('\n== subtopic counts ==')
const many = a.topics.filter((t:any)=>t.subtopics.length>0)
console.log(many.slice(0,10).map((t:any)=>`${t.name}: ${t.subtopics.slice(0,5).join(' | ')}`).join('\n'))
await db.$disconnect()
