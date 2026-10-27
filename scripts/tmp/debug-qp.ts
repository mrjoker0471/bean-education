import { readFileSync } from 'node:fs'
import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
const buf = readFileSync('/tmp/riishe-test-docs/question-paper.pdf')
const ex = await extractPdfPages(new Uint8Array(buf))
console.log('pages:', ex.numPages, 'scanned:', ex.scannedPages)
console.log('--- page 1 first 15 lines ---')
console.log(ex.pages[0].text.split('\n').slice(0, 15).join('\n'))
const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
console.log('kind:', s.kind, 'headings:', s.headings.length, 'units:', s.units.length)
console.log('headings sample:', s.headings.slice(0, 6).map(h => `${h.page}:${h.title}`).join(' | '))
// count question lines
let ql = 0, cl = 0
for (const p of ex.pages) for (const line of p.text.split('\n')) { if (line.trim().length >= 12) cl++; if (/^\d{1,3}[.)]\s+\S{10,}/.test(line.trim())) ql++ }
console.log('question lines:', ql, 'content lines:', cl, 'ratio:', (ql / cl).toFixed(3))
console.log('marks mention:', /marks?\s*[:：]|max(?:imum)?\s*marks|time\s*(?:allowed|:)\s*\d/i.test(ex.pages.slice(0, 8).map(p => p.text).join('\n')))
