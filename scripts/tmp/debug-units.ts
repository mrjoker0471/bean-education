import { readFileSync } from 'node:fs'
import { extractPdfPages } from '../../src/lib/riishe/extract'
import { buildUnits, detectStructure, normKey } from '../../src/lib/riishe/structure'
const buf = readFileSync('/tmp/riishe-test-docs/textbook-toc.pdf')
const ex = await extractPdfPages(new Uint8Array(buf))
const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
const readable = ex.pages.filter(p => !p.scanned && p.text.length > 0)
const anchors = s.headings.filter(h => h.level === 1).sort((a, b) => a.page - b.page || a.lineIdx - b.lineIdx)
console.log('anchors:', anchors.map(a => `${a.page}:"${a.title}"`).join(' | '))
const deduped = []
for (const a of anchors) {
  const prev = deduped[deduped.length - 1]
  if (prev && prev.page === a.page && normKey(prev.title) === normKey(a.title)) continue
  deduped.push(a)
}
console.log('deduped:', deduped.length)
