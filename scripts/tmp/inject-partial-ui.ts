// Inject a synthetic READY document with FAILED + SKIPPED section outcomes to
// verify the honest-accounting UI renders — then remove it. No AI calls.
import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'

const db = new PrismaClient()
const GUEST = '759f7313-a98d-4ba1-b2ea-58c6645eb004' // the browser guest (owns the CUET doc)
const UP = 'db/uploads'

// 1-page minimal real PDF so the file endpoint/streaming doesn't break the UI
const buf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 72 720 Td (Synthetic partial doc) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n9\n%%EOF',
)
const hash = createHash('sha256').update(buf).digest('hex')
const storedPath = `${UP}/synth_partial_${hash.slice(0, 8)}.pdf`
writeFileSync(storedPath, buf)

const analysis = {
  title: 'Synthetic Partial Coverage Doc',
  summary: 'Synthetic analysis used only to verify the partial-coverage UI.',
  topics: [
    { id: 't1', name: 'Photosynthesis', subtopics: [], pages: [1], level: 1, parentId: null, pageVerified: true },
    { id: 't2', name: 'Respiration', subtopics: [], pages: [1], level: 1, parentId: null, pageVerified: true },
  ],
  definitions: [], keyFacts: [], formulas: [], misconceptions: [],
  keyPages: [1], unreadableSections: [],
  studyGaps: ['2 sections failed — retry the analysis to include them.'],
  coverageNote: 'Analysed 1 of 3 readable pages — 2 sections failed and can be retried without losing the sections that succeeded. 1 image-only page would need OCR.',
  pipelineVersion: 3,
  coverage: {
    totalPages: 4, readablePages: 3, scannedPages: 1,
    analysedPages: 1, unanalysedPages: 2, skippedPages: 0,
    unitsTotal: 3, unitsOk: 1, unitsFailed: 2, unitsSkipped: 0,
    complete: false,
  },
  sectionOutcomes: [
    { index: 0, title: 'Chapter 1 Photosynthesis', label: 'Chapter 1 Photosynthesis (page 1)', fromPage: 1, toPage: 1, status: 'OK' },
    { index: 1, title: 'Chapter 2 Respiration', label: 'Chapter 2 Respiration (pages 2–3)', fromPage: 2, toPage: 3, status: 'FAILED', error: 'AI analysis failed for this section' },
    { index: 2, title: null, label: 'pages 4', fromPage: 4, toPage: 4, status: 'SKIPPED', error: 'The AI provider\'s safety filter refused to process this section\'s text (dense lists of names or categories are a known trigger). Its pages are accounted as skipped, not analysed — no content was invented for them.' },
  ],
  structure: { kind: 'TOC_GUIDED', tocValidated: true, tocEntries: 5, headingCount: 4, printedPageOffset: null, printedRomanFrontMatter: false },
}

const doc = await db.studyDocument.create({
  data: {
    guestId: GUEST, title: 'Synthetic Partial Coverage Doc', originalName: 'synthetic-partial.pdf',
    storedPath, mimeType: 'application/pdf', fileSize: buf.length, pageCount: 4,
    contentHash: hash, status: 'READY',
    statusDetail: 'Ready (partial) — analysed 1/3 sections covering 1 of 3 readable pages. Retry analysis to cover the rest.',
    extractionJson: JSON.stringify([{ page: 1, chars: buf.length, text: 'Synthetic partial doc body text photosynthesis respiration', scanned: false }]),
    analysisJson: JSON.stringify(analysis),
  },
})
console.log('injected synthetic doc:', doc.id)
await db.$disconnect()
