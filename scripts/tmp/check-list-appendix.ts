// Deterministic check of the list-appendix archetype (no AI)
import { readFileSync } from 'node:fs'
import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
const buf = readFileSync('/tmp/riishe-test-docs/list-appendix.pdf')
const ex = await extractPdfPages(new Uint8Array(buf))
console.log('pages:', ex.numPages, 'scanned:', ex.scannedPages)
const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
console.log('kind:', s.kind, 'tocValidated:', s.tocValidated, 'entries:', s.toc.length)
for (const e of s.toc) console.log(`  p${e.page} "${e.title}"`)
console.log('units:')
for (const u of s.units) console.log(`  #${u.index} [${u.kind}] "${u.title}" ${u.fromPage}-${u.toPage} chars=${u.chars}`)
// coverage of readable pages by units
const readable = ex.pages.filter(p => !p.scanned && p.text.length > 0).map(p => p.page).sort((a,b)=>a-b)
const covered = s.units.flatMap(u => { const o=[]; for (let i=u.fromPage;i<=u.toPage;i++) o.push(i); return o }).sort((a,b)=>a-b)
console.log('units cover every readable page exactly once:', JSON.stringify(covered) === JSON.stringify(readable))
