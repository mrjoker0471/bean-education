import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const a = JSON.parse(doc!.analysisJson!)
console.log('status:', doc!.status, '| statusDetail:', doc!.statusDetail)
console.log('coverage:', JSON.stringify(a.coverage))
console.log('structure:', JSON.stringify(a.structure))
console.log('topics:', a.topics.length)
const norms = a.topics.map((t:any) => t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
console.log('exact duplicate names:', a.topics.length - new Set(norms).size)
// back-half check
const back = a.topics.filter((t:any) => (t.pages[0] ?? 0) >= 44)
console.log('\ntopics anchored at pages 44+ (previously ALL dropped):', back.length)
for (const t of back.slice(0, 20)) console.log(`  L${t.level} "${t.name}" pages=[${t.pages.slice(0,5).join(',')}]`)
// fragment titles check
const frag = a.topics.filter((t:any) => /^(for |to Write|under the |2016 )/i.test(t.name.trim()))
console.log('\nfragment-title topics (must be 0):', frag.length, frag.map((t:any)=>t.name))
// unverified pages
const unv = a.topics.filter((t:any) => t.pageVerified === false)
console.log('unverified-page topics:', unv.length, unv.map((t:any)=>t.name).slice(0,5))
// page sanity
const maxPage = doc!.pageCount
const bad = a.topics.filter((t:any) => t.pages.some((p:number) => p < 1 || p > maxPage))
console.log('topics with out-of-range pages (must be 0):', bad.length)
// failed/skipped outcomes
const bad2 = (a.sectionOutcomes ?? []).filter((o:any) => o.status !== 'OK')
console.log('non-OK sections:', bad2.length, JSON.stringify(bad2))
// L1 section titles sample from the back
console.log('\nL1 topics:')
for (const t of a.topics.filter((t:any)=>t.level===1)) console.log(`  [${t.id}] "${t.name}" pages=[${t.pages[0]}-${t.pages[t.pages.length-1]}]`)
await db.$disconnect()
