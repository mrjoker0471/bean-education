import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
import { readFileSync } from 'node:fs'
async function main() {
  const buf = readFileSync('db/uploads/cmvq6rfxg0001t2vh9m6m4cu8.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
  console.log('--- UNITS ---')
  for (const u of s.units) console.log(`  #${u.index} ${u.kind} ${u.fromPage}-${u.toPage} :: ${u.title ?? '(front)'}`)
  console.log('\n--- TOC LAYER (majors: matched?) ---')
  for (const e of s.tocLayer.filter(e => e.level === 1)) {
    console.log(`  ${e.matched ? 'MATCH ' : 'UNMATCH'} p${e.printedPage}->phys${e.physicalPage} match=${e.matchPage ?? '-'} num=${e.number ?? '-'} :: ${e.title.slice(0, 70)}${e.note ? ' [' + e.note.slice(0, 60) + ']' : ''}`)
  }
  const unmatched = s.tocLayer.filter(e => !e.matched)
  console.log(`\nmatched=${s.tocLayer.filter(e => e.matched).length}/${s.tocLayer.length}`)
}
main()
