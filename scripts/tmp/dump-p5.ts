import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
import { readFileSync } from 'node:fs'
async function main() {
  const buf = readFileSync('db/uploads/cmvq6rfxg0001t2vh9m6m4cu8.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  const p5 = ex.pages.find(p => p.page === 5)!
  console.log('--- PAGE 5 RAW LINES (indexed) ---')
  p5.text.split('\n').forEach((l, i) => console.log(`${String(i).padStart(2)}: |${l}|`))
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
  console.log('\n--- UNITS 5+ ---')
  for (const u of s.units.slice(5)) console.log(`  #${u.index} ${u.kind} L${u.level} ${u.fromPage}-${u.toPage} chars=${u.chars} :: ${u.title ?? '(none)'}`)
  console.log('\n--- PAGE 69 first 15 lines ---')
  console.log(ex.pages.find(p => p.page === 69)!.text.split('\n').slice(0, 15).join('\n'))
  console.log('--- PAGE 72 first 8 lines ---')
  console.log(ex.pages.find(p => p.page === 72)!.text.split('\n').slice(0, 8).join('\n'))
  console.log('--- PAGE 73 first 8 lines ---')
  console.log(ex.pages.find(p => p.page === 73)!.text.split('\n').slice(0, 8).join('\n'))
}
main()
