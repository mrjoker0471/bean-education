import { buildUnits, type HeadingHit } from '../../src/lib/riishe/structure'
import type { ExtractedPage } from '../../src/lib/riishe/extract'
// 4 synthetic pages, 2 L1 anchors on pages 1 and 3
const pages: ExtractedPage[] = [1,2,3,4].map(p => ({ page: p, chars: 500, text: Array.from({length: 10}, (_,i) => `line ${i} of page ${p} with some content words here`).join('\n'), scanned: false }))
const headings: HeadingHit[] = [
  { title: 'Chapter 1 Alpha', page: 1, lineIdx: 0, level: 1, score: 7, fromToc: true },
  { title: 'Chapter 2 Beta', page: 3, lineIdx: 0, level: 1, score: 7, fromToc: true },
]
const units = buildUnits(pages, headings, 'TOC_GUIDED', { maxUnitChars: 6000 })
for (const u of units) console.log(`#${u.index} [${u.kind}] "${u.title}" ${u.fromPage}-${u.toPage} chars=${u.chars}`)
