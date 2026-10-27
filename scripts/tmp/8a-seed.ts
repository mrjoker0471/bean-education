// Task 8-a E2E seed: synthetic v4/v3/empty analyses to verify the reworked
// Analysis tab in the browser. DELETED after verification (see 8a-cleanup).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const GUEST = 'e2e-8a-guest'

const v4Analysis = {
  title: 'Structure & coverage E2E (v4)',
  summary: 'Synthetic v4 analysis verifying the three-layer Analysis tab: document structure, AI study topics, study notes and the honesty panel.',
  pipelineVersion: 4,
  topics: [
    { id: 't-h1', name: 'Chapter-1 The Union and its Territory', subtopics: [], pages: [2, 3, 4, 5], level: 1, parentId: null, aliases: ['The Union and its Territory'], pageVerified: true, origin: 'SOURCE_HEADING', titleSource: 'toc', numbering: 'Chapter-1', tocPrintedPage: 1, tocMatchPage: 2, structureVerified: true },
    { id: 't-h2', name: 'Chapter-2 Citizenship', subtopics: [], pages: [6, 7, 8], level: 1, parentId: null, aliases: [], pageVerified: true, origin: 'SOURCE_HEADING', titleSource: 'toc', numbering: 'Chapter-2', tocPrintedPage: 5, tocMatchPage: 6, structureVerified: true },
    { id: 't-h3', name: 'Chapter-3 Fundamental Rights', subtopics: [], pages: [9, 10, 11, 12], level: 1, parentId: null, aliases: [], pageVerified: true, origin: 'SOURCE_HEADING', titleSource: 'toc', numbering: 'Chapter-3', tocPrintedPage: 8, tocMatchPage: null, structureVerified: false },
    { id: 't-h4', name: 'Directive Principles of State Policy', subtopics: [], pages: [13, 14], level: 1, parentId: null, aliases: [], pageVerified: true, origin: 'SOURCE_HEADING', titleSource: 'body', numbering: null, tocPrintedPage: null, tocMatchPage: null, structureVerified: true },
    { id: 't-a1', name: 'Union and territory definitions', subtopics: ['Article 2', 'Article 3'], pages: [3], level: 2, parentId: 't-h1', aliases: [], pageVerified: true, origin: 'AI_INFERRED', titleSource: 'inferred' },
    { id: 't-a2', name: 'Citizenship by descent', subtopics: [], pages: [7], level: 2, parentId: 't-h2', aliases: [], pageVerified: true, origin: 'AI_INFERRED', titleSource: 'inferred' },
    { id: 't-a3', name: 'A very long inferred study topic title that should truncate gracefully on a 390px wide mobile viewport without causing any horizontal overflow whatsoever', subtopics: [], pages: [15], level: 1, parentId: null, aliases: [], pageVerified: true, origin: 'AI_INFERRED', titleSource: 'inferred' },
  ],
  definitions: [
    { term: 'State', meaning: 'For the purposes of the synthetic analysis, the term "State" is used to verify that definition cards keep their page badges after the rework.', page: 9 },
  ],
  keyFacts: ['Synthetic key fact one — page chips open the reader.', 'Synthetic key fact two.'],
  formulas: ['validity = (a + b) / c'],
  misconceptions: [
    { misconception: 'Synthetic misconception: fundamental rights are absolute.', correction: 'They are subject to reasonable restrictions (synthetic correction).', page: 10 },
  ],
  keyPages: [2, 9],
  unreadableSections: ['Page 20 (appendix scan) — image-only'],
  studyGaps: ['No synthetic study material covers emergency provisions.'],
  coverageNote: 'Synthetic coverage note: one section failed and one was skipped, so this analysis is honestly incomplete.',
  coverage: { totalPages: 20, readablePages: 18, scannedPages: 2, analysedPages: 12, unanalysedPages: 2, skippedPages: 4, unitsTotal: 6, unitsOk: 4, unitsFailed: 1, unitsSkipped: 1, complete: false },
  sectionOutcomes: [
    { index: 0, title: 'Chapter-1 The Union and its Territory', label: 'Chapter-1 The Union and its Territory (pages 2–5)', fromPage: 2, toPage: 5, status: 'OK' },
    { index: 3, title: null, label: 'Section 4 (pages 15–16)', fromPage: 15, toPage: 16, status: 'FAILED', error: 'The AI provider rate-limited this section — retry the analysis to cover it.' },
    { index: 4, title: null, label: 'Section 5 (pages 17–18)', fromPage: 17, toPage: 18, status: 'SKIPPED', error: 'Skipped: the provider safety filter refused this text.' },
  ],
  structure: {
    kind: 'TOC_GUIDED',
    tocValidated: true,
    tocEntries: 5,
    headingCount: 4,
    printedPageOffset: 1,
    printedRomanFrontMatter: true,
    toc: [
      { title: 'Chapter-1 The Union and its Territory', number: 'Chapter-1', printedPage: 1, physicalPage: 2, level: 1, matched: true, matchPage: 2 },
      { title: 'Chapter-2 Citizenship', number: 'Chapter-2', printedPage: 5, physicalPage: 6, level: 1, matched: true, matchPage: 6 },
      { title: 'Chapter-3 Fundamental Rights', number: 'Chapter-3', printedPage: 8, physicalPage: null, level: 1, matched: false, matchPage: null, note: 'Listed in the contents table, but this section could not be located in the document body at the expected page.' },
      { title: '4. Directive Principles of State Policy', number: '4', printedPage: 12, physicalPage: 13, level: 1, matched: true, matchPage: 13 },
      { title: '1.1 Sub-part example entry', number: '1.1', printedPage: 2, physicalPage: 3, level: 2, matched: true, matchPage: 3 },
    ],
    headings: [{ title: 'Chapter-1 The Union and its Territory', page: 2, level: 1, fromToc: true }],
    tocMatched: 4,
    tocUnmatched: 1,
    printedLabels: { '1': 'i', '2': '1' },
    tocPages: [1],
  },
}

const v3Analysis = {
  title: 'Old-shape analysis (v3)',
  summary: 'Synthetic v3-shaped analysis (no origin/structure fields) verifying the defensive rendering path.',
  topics: [
    { id: 'v3-h1', name: 'Introduction', subtopics: [], pages: [1, 2], level: 1, parentId: null, aliases: [], pageVerified: true },
    { id: 'v3-h2', name: 'Methods', subtopics: [], pages: [3, 4, 5], level: 1, parentId: null, aliases: [], pageVerified: true },
    { id: 'v3-a1', name: 'Sampling strategy', subtopics: ['Stratified', 'Cluster'], pages: [4], level: 2, parentId: 'v3-h2', aliases: [], pageVerified: true },
  ],
  definitions: [{ term: 'Population', meaning: 'Synthetic definition to confirm page badges render in the v3 path.', page: 2 }],
  keyFacts: ['Old analyses still render sensibly.'],
  formulas: [],
  misconceptions: [],
  keyPages: [1],
  unreadableSections: [],
  studyGaps: [],
  coverageNote: 'Synthetic v3 coverage note — complete analysis, no failed sections.',
  coverage: { totalPages: 5, readablePages: 5, scannedPages: 0, analysedPages: 5, unanalysedPages: 0, skippedPages: 0, unitsTotal: 2, unitsOk: 2, unitsFailed: 0, unitsSkipped: 0, complete: true },
  sectionOutcomes: [
    { index: 0, title: 'Introduction', label: 'Introduction (pages 1–2)', fromPage: 1, toPage: 2, status: 'OK' },
    { index: 1, title: 'Methods', label: 'Methods (pages 3–5)', fromPage: 3, toPage: 5, status: 'OK' },
  ],
}

const emptyAnalysis = {
  title: 'Empty analysis',
  summary: 'Synthetic analysis with no topics at all — both layers must show honest empty lines.',
  topics: [],
  definitions: [],
  keyFacts: [],
  formulas: [],
  misconceptions: [],
  keyPages: [],
  unreadableSections: [],
  studyGaps: [],
  coverageNote: 'Nothing was inferred from this document.',
  coverage: { totalPages: 2, readablePages: 2, scannedPages: 0, analysedPages: 2, unanalysedPages: 0, skippedPages: 0, unitsTotal: 1, unitsOk: 1, unitsFailed: 0, unitsSkipped: 0, complete: true },
}

const extraction = JSON.stringify(
  Array.from({ length: 20 }, (_, i) => ({ page: i + 1, chars: 900, text: `Synthetic page ${i + 1} text. `, scanned: false })),
)

async function upsert(title: string, analysis: unknown, pageCount: number) {
  const existing = await db.studyDocument.findFirst({ where: { guestId: GUEST, title } })
  if (existing) return existing.id
  const doc = await db.studyDocument.create({
    data: {
      guestId: GUEST,
      title,
      originalName: '8a-e2e-fixture.pdf',
      storedPath: 'cmvp14hcb004iqv1cdruiyjrb.pdf',
      mimeType: 'application/pdf',
      fileSize: 9646,
      pageCount,
      status: 'READY',
      statusDetail: 'Synthetic E2E fixture (task 8-a) — deleted after verification.',
      contentHash: `e2e-8a-${title.replace(/\W+/g, '-').toLowerCase()}`,
      extractionJson: extraction,
      analysisJson: JSON.stringify(analysis),
      examLabel: null,
      subjectLabel: null,
      topicLabel: null,
    },
  })
  return doc.id
}

const v4Id = await upsert('8a fixture — v4 layers', v4Analysis, 20)
const v3Id = await upsert('8a fixture — v3 old shape', v3Analysis, 5)
const emptyId = await upsert('8a fixture — empty analysis', emptyAnalysis, 2)
console.log(JSON.stringify({ guest: GUEST, v4Id, v3Id, emptyId }))
await db.$disconnect()
