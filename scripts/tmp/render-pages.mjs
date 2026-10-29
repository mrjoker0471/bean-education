import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
const buf = Buffer.from(await readFile(doc.storedPath))
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 })
const pdf = await task.promise
await mkdir('/tmp/pagecheck', { recursive: true })
for (const pn of [1, 35, 69, 70, 76, 79, 85, 95, 96]) {
  const page = await pdf.getPage(pn)
  const viewport = page.getViewport({ scale: 1.2 })
  const canvas = document.createElement('canvas') // placeholder — node path below
  await page.cleanup()
}
console.log('node canvas not available — trying alternative')
await db.$disconnect()
