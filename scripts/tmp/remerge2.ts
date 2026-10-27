// Re-run the deterministic merge on the STORED parts of the re-analysed bulletin
// to confirm the multi-unit span fix (no AI calls, pure functions).
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
const all = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 200, maxSubtopicsPerTopic: 12 })
console.log('total topics:', all.length)
const cities = all.find((t:any) => /List of Examination Cities/i.test(t.name))
console.log('cities topic pages:', JSON.stringify(cities?.pages))
const norm = all.map((t:any) => t.name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim())
console.log('exact dups:', all.length - new Set(norm).size)
const backCount = all.filter((t:any) => (t.pages[0] ?? 0) >= 44).length
console.log('back-half topics:', backCount)
await db.$disconnect()
