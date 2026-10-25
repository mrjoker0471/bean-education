// Feasibility test: server-side PDF text extraction with pdfjs-dist (legacy build)
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Build a small multi-page PDF by hand (raw PDF syntax) for testing
function makePdf(pages) {
  const objects = []
  const pageObjNums = []
  const contentObjNums = []
  // 1: Catalog, 2: Pages, then per page: page obj + content obj. Font = last.
  const nPages = pages.length
  const fontNum = 3 + nPages * 2
  for (let i = 0; i < nPages; i++) {
    const pageNum = 3 + i * 2
    const contentNum = pageNum + 1
    pageObjNums.push(pageNum)
    contentObjNums.push(contentNum)
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${nPages} >>`
  pages.forEach((text, i) => {
    const pn = pageObjNums[i]
    const cn = contentObjNums[i]
    objects[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cn} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/([()\\])/g, '\\$1')}) Tj ET`
    objects[cn] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[fontNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`
  let out = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefStart = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const buf = makePdf([
  'Photosynthesis is the process by which green plants convert light energy into chemical energy.',
  'Page two: chlorophyll absorbs light primarily in the blue and red regions of the spectrum.',
  'Page three: the Calvin cycle fixes carbon dioxide into glucose using ATP and NADPH.',
])

console.log('PDF bytes:', buf.length)
try {
  const doc = await getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise
  console.log('numPages:', doc.numPages)
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const text = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()
    console.log(`page ${p}: len=${text.length} :: ${text.slice(0, 80)}`)
  }
  console.log('EXTRACTION OK')
} catch (err) {
  console.error('EXTRACTION FAILED:', err)
  process.exit(1)
}
