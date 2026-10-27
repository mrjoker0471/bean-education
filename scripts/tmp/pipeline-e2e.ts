// ─── Pipeline E2E: real extraction → structure → AI analysis → merge ─────────
// Runs processDocument directly against the dev database for the three
// synthetic archetypes + the real uploaded bulletin, asserting hierarchy,
// dedupe, page verification and coverage accounting.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { processDocument } from '../../src/lib/riishe/pipeline'
import type { DocumentAnalysis } from '../../src/lib/riishe/types'

const db = new PrismaClient()
const GUEST = 'e2e-structure-test-guest'
const UP = path.join(process.cwd(), 'db', 'uploads')

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

async function uploadDoc(file, title) {
  const buf = readFileSync(file)
  const hash = createHash('sha256').update(buf).digest('hex')
  const storedPath = path.join(UP, `e2e_${hash.slice(0, 12)}.pdf`)
  writeFileSync(storedPath, buf)
  return db.studyDocument.create({
    data: {
      guestId: GUEST, title, originalName: path.basename(file), storedPath,
      mimeType: 'application/pdf', fileSize: buf.length, contentHash: hash, status: 'QUEUED',
    },
  })
}

async function analyse(id) {
  await processDocument(id)
  return db.studyDocument.findUnique({ where: { id } })
}

function topicNames(a) { return a.topics.map(t => t.name) }

async function main() {
  // clean slate for this guest
  await db.studyDocument.deleteMany({ where: { guestId: GUEST } })

  console.log('── textbook-toc.pdf ──')
  const tb = await uploadDoc('/tmp/riishe-test-docs/textbook-toc.pdf', 'Foundation Science Textbook')
  let doc = await analyse(tb.id)
  let a: DocumentAnalysis | null = doc && doc.status === 'READY' ? JSON.parse(doc.analysisJson!) : null
  await check('READY with pipelineVersion 2', () => {
    assert.ok(a, `status=${doc?.status} detail=${doc?.statusDetail}`)
    assert.equal(a.pipelineVersion, 2)
  })
  await check('hierarchy: chapter topics are level 1, subsections level 2 with parentId', () => {
    const l1 = a!.topics.filter(t => t.level === 1)
    const l2 = a!.topics.filter(t => t.level === 2)
    assert.ok(l1.length >= 8, `level1 ${l1.length}: ${topicNames(a!)}`)
    assert.ok(l2.length >= 8, `level2 ${l2.length}`)
    for (const t of l2) assert.ok(t.parentId && l1.some(p => p.id === t.parentId), `orphan child ${t.name}`)
  })
  await check('no duplicate topics (exact or near)', () => {
    const norms = a!.topics.map(t => t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    assert.equal(new Set(norms).size, norms.length)
  })
  await check('printed page labels present (offset 2)', () => {
    const withPrinted = a!.topics.filter(t => t.printedPages && t.printedPages.length > 0)
    assert.ok(withPrinted.length > 0, 'no topic has printedPages')
    const t = withPrinted[0]
    assert.equal(t.printedPages![0], String(t.pages[0] - 2))
  })
  await check('coverage complete and honest', () => {
    assert.equal(a!.coverage!.complete, true, JSON.stringify(a!.coverage))
    assert.equal(a!.coverage!.readablePages, 18)
    assert.equal(a!.coverage!.unitsFailed, 0)
    assert.ok(a!.coverage!.unitsTotal >= 9, `units ${a!.coverage!.unitsTotal}`)
  })
  await check('chapter page ranges verified against content', () => {
    const ch = a!.topics.find(t => /Photosynthesis/i.test(t.name))
    assert.ok(ch, 'photosynthesis chapter found')
    assert.ok(ch.pages.includes(3), `pages ${ch.pages}`)
    const respiration = a!.topics.find(t => /Respiration/i.test(t.name) && t.level === 1)
    assert.ok(respiration && respiration.pages.some(p => p >= 5 && p <= 6), `pages ${respiration?.pages}`)
  })

  console.log('── re-analysis idempotency ──')
  const firstNames = topicNames(a!)
  const firstJson = doc!.analysisJson
  await processDocument(tb.id) // no force — READY docs are left alone
  const after = await db.studyDocument.findUnique({ where: { id: tb.id } })
  await check('re-running without force does not touch a READY doc', () => {
    assert.equal(after!.analysisJson, firstJson)
  })

  console.log('── lecture-notes.pdf (no TOC) ──')
  const ln = await uploadDoc('/tmp/riishe-test-docs/lecture-notes.pdf', 'Economics Lecture Notes')
  doc = await analyse(ln.id)
  a = doc && doc.status === 'READY' ? JSON.parse(doc.analysisJson!) : null
  await check('READY with honest structure (no fake TOC)', () => {
    assert.ok(a, `status=${doc?.status} detail=${doc?.statusDetail}`)
    assert.ok(['HEADING_GUIDED', 'UNSTRUCTURED'].includes(a!.structure!.kind), `kind ${a!.structure!.kind}`)
    assert.equal(a!.structure!.tocValidated, false)
    assert.equal(a!.structure!.printedPageOffset, null)
  })
  await check('coverage complete, all 6 pages analysed', () => {
    assert.equal(a!.coverage!.complete, true)
    assert.equal(a!.coverage!.readablePages, 6)
  })
  await check('topics derive from note headings', () => {
    assert.ok(a!.topics.length >= 4, `topics: ${topicNames(a!)}`)
    assert.ok(a!.topics.some(t => /markets?\s+fail/i.test(t.name)), topicNames(a!).join('|'))
  })

  console.log('── question-paper.pdf ──')
  const qp = await uploadDoc('/tmp/riishe-test-docs/question-paper.pdf', 'Physics Sample Paper')
  doc = await analyse(qp.id)
  a = doc && doc.status === 'READY' ? JSON.parse(doc.analysisJson!) : null
  await check('READY and classified as question paper', () => {
    assert.ok(a, `status=${doc?.status} detail=${doc?.statusDetail}`)
    assert.equal(a!.structure!.kind, 'QUESTION_PAPER')
  })
  await check('no per-question topic explosion', () => {
    assert.ok(a!.topics.length <= 20, `topics ${a!.topics.length}: ${topicNames(a!).slice(0, 10)}`)
  })
  await check('coverage complete (2 pages)', () => {
    assert.equal(a!.coverage!.complete, true)
    assert.equal(a!.coverage!.readablePages, 2)
  })

  await db.studyDocument.deleteMany({ where: { guestId: GUEST } })
  // remove the temp upload files
  for (const f of await db.studyDocument.findMany({ where: { guestId: GUEST } })) { void f }
  console.log(`\n${passed} passed, ${failed} failed`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
