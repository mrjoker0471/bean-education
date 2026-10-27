import { PrismaClient } from '@prisma/client'
import { detectStructure } from '../../src/lib/riishe/structure'
import { canonicalizeTopics } from '../../src/lib/riishe/dedupe'
import type { ExtractedPage } from '../../src/lib/riishe/extract'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const a = JSON.parse(doc!.analysisJson!)
const pages = JSON.parse(doc!.extractionJson!) as ExtractedPage[]
const structure = detectStructure(pages, doc!.pageCount ?? 96, { maxUnitChars: 6000 })
const parts = a._parts
const pageTextIndex = new Map<number, string>()
for (const p of pages) if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
// replicate collectTopicInputs
const inputs: any[] = []
for (const u of structure.units) {
  if (u.kind === 'SECTION' && u.title) inputs.push({ name: u.title, subtopics: [], pages: Array.from({length: u.toPage-u.fromPage+1},(_,i)=>u.fromPage+i), unitIndex: u.index, unitTitle: u.title, unitFromPage: u.fromPage, unitToPage: u.toPage, anchored: true })
}
for (const u of structure.units) {
  const part = parts[u.index]
  if (!part) continue
  const isIndexEcho = u.kind === 'FRONT' && structure.tocPages.some(tp => tp >= u.fromPage && tp <= u.toPage)
  if (isIndexEcho) continue
  for (const t of part.topics ?? []) inputs.push({ name: String(t?.name??'').trim(), subtopics: t.subtopics ?? [], pages: t.pages ?? [], unitIndex: u.index, unitTitle: u.title, unitFromPage: u.fromPage, unitToPage: u.toPage })
}
console.log('topic inputs:', inputs.length)
const all = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 100000, maxSubtopicsPerTopic: 12 })
console.log('after merge (no cap):', all.length)
const capped = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 80, maxSubtopicsPerTopic: 12 })
console.log('after merge (cap 80):', capped.length, '— dropped:', all.slice(80).length)
console.log('\n== topics from pages 44+ (dropped by cap) ==')
for (const t of all.filter(t => (t.pages[0] ?? 0) >= 44)) console.log(`L${t.level} "${t.name}" pages=[${t.pages.slice(0,6).join(',')}]`)
await db.$disconnect()
