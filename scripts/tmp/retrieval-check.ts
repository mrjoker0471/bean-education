// Deterministic check: focused generation retrieval leads with the ACTUAL pages
// of a back-half topic (from the corrected analysis) — no AI calls needed.
import { PrismaClient } from '@prisma/client'
import { buildGenerationSections } from '../../src/lib/riishe/generate'
import type { ExtractedPage } from '../../src/lib/riishe/extract'
import type { DocumentAnalysis } from '../../src/lib/riishe/types'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!) as ExtractedPage[]
const analysis = JSON.parse(doc!.analysisJson!) as DocumentAnalysis

for (const focus of [
  ['IV Procedure for Online Payment of Fees and Helpline for Payment-Related Queries'],
  ['V Computer Based Test (CBT) Guidelines'],
  ['Chapter-2 Examination Scheme'],
]) {
  const secs = buildGenerationSections(pages, doc!.pageCount ?? 96, analysis, focus)
  const charTotal = secs.reduce((s, x) => s + x.text.length, 0)
  console.log(`focus "${focus[0].slice(0, 60)}" → ${secs.length} sections, ${charTotal} chars`)
  for (const s of secs.slice(0, 4)) console.log(`   ${s.label}`)
  const first = secs[0]
  const expected = focus[0].startsWith('IV') ? [48, 51] : focus[0].startsWith('V ') ? [52, 58] : [16, 16]
  const ok = first && first.fromPage >= expected[0] - 1 && first.toPage <= expected[1] + 1
  console.log(`   leads with the topic's own pages: ${ok ? 'YES' : 'NO'} (${first?.fromPage}-${first?.toPage})`)
}
await db.$disconnect()
