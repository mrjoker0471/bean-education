// Refresh the stored analysis of a document by re-running ONLY the deterministic
// Stage-4 merge (structure detection + topic canonicalisation) over the stored
// extraction and stored per-section parts. Zero AI calls — used after a merge-
// logic fix so the live analysis reflects the current pipeline exactly.
import { PrismaClient } from '@prisma/client'
import { collectTopicInputs } from '../../src/lib/riishe/pipeline'
import { detectStructure } from '../../src/lib/riishe/structure'
import { canonicalizeTopics } from '../../src/lib/riishe/dedupe'
import { PIPELINE_VERSION } from '../../src/lib/riishe/types'
const db = new PrismaClient()

const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
if (!doc) throw new Error('no document')
const a = JSON.parse(doc.analysisJson!)
if (!a._parts || !doc.extractionJson) throw new Error('stored analysis lacks parts/extraction — cannot re-merge without AI')

const pages = JSON.parse(doc.extractionJson!)
const structure = detectStructure(pages, doc.pageCount ?? pages.length, { maxUnitChars: 6000 })
const units = structure.units
const parts = a._parts

const pageTextIndex = new Map<number, string>()
for (const p of pages) if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))

const inputs = collectTopicInputs(parts, units, new Map(), structure.tocPages)
const topics = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 200, maxSubtopicsPerTopic: 12 })

if (structure.printed.offset !== null) {
  const off = structure.printed.offset
  for (const t of topics) {
    const labels = t.pages.map(p => p - off).filter(n => n >= 1).map(String)
    if (labels.length === t.pages.length && labels.length > 0) t.printedPages = labels
  }
}

const merged = {
  ...a,
  topics,
  keyPages: [...new Set(topics.flatMap(t => t.pages.slice(0, 3)))].filter(p => p >= 1).sort((x, y) => x - y).slice(0, 60),
  pipelineVersion: PIPELINE_VERSION,
  structure: {
    kind: structure.kind,
    tocValidated: structure.tocValidated,
    tocEntries: structure.toc.length,
    headingCount: structure.headings.length,
    printedPageOffset: structure.printed.offset,
    printedRomanFrontMatter: structure.printed.romanFrontMatter,
  },
}
console.log('re-merged topics:', topics.length)
const norm = topics.map(t => t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
console.log('exact dups:', topics.length - new Set(norm).size)
console.log('back-half topics:', topics.filter(t => (t.pages[0] ?? 0) >= 44).length)
const cov = merged.coverage!
await db.studyDocument.update({
  where: { id: doc.id },
  data: {
    analysisJson: JSON.stringify(merged),
    status: 'READY',
    statusDetail: cov.complete
      ? `Ready — ${topics.length} topic${topics.length === 1 ? '' : 's'} across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}; all ${cov.readablePages} readable page${cov.readablePages === 1 ? '' : 's'} accounted for${cov.unitsSkipped > 0 ? ` (${cov.unitsSkipped} skipped with reason)` : ''}.`
      : `Ready (partial) — analysed ${cov.unitsOk}/${cov.unitsTotal} sections covering ${cov.analysedPages} of ${cov.readablePages} readable pages.`,
  },
})
console.log('stored analysis refreshed (pipelineVersion', PIPELINE_VERSION + ', status READY)')
await db.$disconnect()
