// Builds small fixture PDFs for the Riishe edge-case E2E:
//   broken.pdf  – starts with %PDF- then garbage (real parse failure)
//   scanned.pdf – valid PDF, but every page has <32 chars (image-only simulation)
//   thin.pdf    – 2 pages, sparse content (analysis READY, generation should honestly fail)
//   small.pdf   – 3 pages of well-structured content (analysis COMPLETE + small validated test)
// Run: bun scripts/make-fixtures.ts
import { writeFile } from 'node:fs/promises'

/** Minimal but structurally valid PDF writer (Helvetica text, N pages). */
function buildPdf(pages: string[]): Buffer {
  const objects: string[] = []
  const pageCount = pages.length
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`)
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`)
  pages.forEach((text, i) => {
    const pageId = 4 + i * 2
    const contentId = pageId + 1
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    )
    // wrap lines at ~90 chars to mimic real pages
    const lines: string[] = []
    for (const raw of text.split('\n')) {
      for (let k = 0; k < raw.length; k += 90) lines.push(raw.slice(k, k + 90))
    }
    const stream = lines.map((l, ln) => `BT /F1 11 Tf 50 ${740 - ln * 16} Td (${l.replace(/([()\\])/g, '\\$1')}) Tj ET`).join('\n')
    objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`)
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(out.length)
    out += obj
  }
  const xrefStart = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const paragraph = (t: string, n: number) => Array(n).fill(t).join(' ')

const smallPages = [
  paragraph('Chapter 1 Fundamental Duties of Citizens. The Constitution of India originally listed ten fundamental duties in Article 51A. ', 14) +
    'Duty one requires every citizen to abide by the Constitution and respect its ideals and institutions, the National Flag and the National Anthem. ' +
    paragraph('Duty two cherishes the noble ideals of the freedom struggle. ', 8),
  paragraph('Chapter 2 Directive Principles. The Directive Principles of State Policy are contained in Part IV of the Constitution, Articles 36 to 51. ', 12) +
    'Article 39 directs the State to secure adequate means of livelihood and equal pay for equal work for both men and women. ' +
    paragraph('Article 40 organises village panchayats. ', 10),
  paragraph('Chapter 3 Amendment Procedure. Article 368 governs the amendment of the Constitution. ', 10) +
    'A majority of the total membership of each House and a majority of not less than two-thirds of the members present and voting is required for most amendments. ' +
    paragraph('Ratification by half the state legislatures is needed for federal provisions. ', 9),
]

const thinPages = [
  'Page one. Brief note about the lactiferous ducts and alveoli of the human breast.',
  'Page two. The ampulla stores milk synthesized by the alveolar glands during lactation.',
]

const scannedPages = ['Hi', 'Yo']

await writeFile('/tmp/riishe-fixtures/broken.pdf', Buffer.from('%PDF-1.4\nthis is not really a pdf structure at all, just truncated garbage bytes \x00\x01\x02'))
await writeFile('/tmp/riishe-fixtures/scanned.pdf', buildPdf(scannedPages))
await writeFile('/tmp/riishe-fixtures/thin.pdf', buildPdf(thinPages))
await writeFile('/tmp/riishe-fixtures/small.pdf', buildPdf(smallPages))
console.log('fixtures written to /tmp/riishe-fixtures/')
