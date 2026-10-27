import { readFileSync } from 'node:fs'
import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
const buf = readFileSync('/tmp/riishe-test-docs/textbook-toc.pdf')
const ex = await extractPdfPages(new Uint8Array(buf))
const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
console.log('kind:', s.kind, 'tocValidated:', s.tocValidated, 'headings:', s.headings.length)
console.log('headings:', s.headings.map(h => `p${h.page} L${h.level} "${h.title}"`).join('\n  '))
console.log('units:')
for (const u of s.units) console.log(`  #${u.index} [${u.kind}] "${u.title}" pages ${u.fromPage}-${u.toPage} chars=${u.chars}`)
