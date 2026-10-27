import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
import { readFileSync } from 'node:fs'
async function main() {
  const buf = readFileSync('db/uploads/cmvq6rfxg0001t2vh9m6m4cu8.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  console.log('scanned pages:', ex.pages.filter(p => p.scanned).map(p => p.page))
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
  console.log('kind:', s.kind, 'tocValidated:', s.tocValidated, 'tocPages:', s.tocPages)
  console.log('printed:', JSON.stringify(s.printed))
  console.log('\n--- TOC ENTRIES (' + s.toc.length + ') ---')
  for (const e of s.toc) console.log(`  [p${e.page === null ? '?' : e.page}] ${e.title}`)
  console.log('\n--- HEADINGS (' + s.headings.length + ') ---')
  for (const h of s.headings) console.log(`  L${h.level} p${h.page} toc=${h.fromToc} score=${h.score} :: ${h.title}`)
  console.log('\n--- UNITS (' + s.units.length + ') ---')
  for (const u of s.units) console.log(`  #${u.index} ${u.kind} L${u.level} ${u.fromPage}-${u.toPage} chars=${u.chars} :: ${u.title ?? '(none)'}`)
}
main()
