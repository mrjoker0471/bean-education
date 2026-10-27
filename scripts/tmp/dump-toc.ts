import { extractPdfPages } from '../../src/lib/riishe/extract'
import { readFileSync } from 'node:fs'
async function main() {
  const buf = readFileSync('db/uploads/cmvq6rfxg0001t2vh9m6m4cu8.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  console.log('numPages:', ex.numPages, 'scanned:', ex.scannedPages)
  // TOC pages are usually 2-5 physical. Dump pages 2..5 raw lines
  for (const p of ex.pages.filter(p => p.page >= 2 && p.page <= 5)) {
    console.log(`\n===== PHYSICAL PAGE ${p.page} =====`)
    console.log(p.text.split('\n').map(l => l.trim()).filter(Boolean).join('\n'))
  }
}
main()
