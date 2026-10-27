// ─── Partial retry test: a failed section is re-run, successes are preserved ──
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { processDocument } from '../../src/lib/riishe/pipeline'

const db = new PrismaClient()
const GUEST = 'e2e-retry-test-guest'
const UP = path.join(process.cwd(), 'db', 'uploads')

async function main() {
  await db.studyDocument.deleteMany({ where: { guestId: GUEST } })
  const buf = readFileSync('/tmp/riishe-test-docs/textbook-toc.pdf')
  const hash = createHash('sha256').update(buf).digest('hex')
  const storedPath = path.join(UP, `e2e_retry_${hash.slice(0, 12)}.pdf`)
  writeFileSync(storedPath, buf)
  const doc = await db.studyDocument.create({
    data: {
      guestId: GUEST, title: 'Economics Notes (retry test)', originalName: 'lecture-notes.pdf', storedPath,
      mimeType: 'application/pdf', fileSize: buf.length, contentHash: hash, status: 'QUEUED',
    },
  })

  // 1 ── full analysis first
  await processDocument(doc.id)
  const ready = await db.studyDocument.findUnique({ where: { id: doc.id } })
  assert.equal(ready!.status, 'READY', ready!.statusDetail ?? '')
  const analysis = JSON.parse(ready!.analysisJson!)
  assert.equal(analysis.coverage.complete, true)
  const parts = analysis._parts as unknown[]
  assert.equal(parts.length, analysis.sectionOutcomes.length)

  // 2 ── simulate a mid-run failure: unit 2's result was lost
  parts[2] = null
  analysis.sectionOutcomes[2].status = 'FAILED'
  analysis.sectionOutcomes[2].error = 'AI analysis failed for this section'
  analysis.coverage.complete = false
  analysis.coverage.unitsOk = parts.filter(Boolean).length
  analysis.coverage.unitsFailed = 1
  // sentinel proving part 0 survives the retry untouched
  ;(parts[0] as { keyFacts: string[] }).keyFacts.unshift('SENTINEL_PRESERVED_FACT_XYZ')
  analysis._parts = parts
  await db.studyDocument.update({
    where: { id: doc.id },
    data: { analysisJson: JSON.stringify(analysis), status: 'READY', statusDetail: 'Ready (partial) — 1 section failed.' },
  })

  // 3 ── partial retry
  await processDocument(doc.id)
  const after = await db.studyDocument.findUnique({ where: { id: doc.id } })
  const a2 = JSON.parse(after!.analysisJson!)
  const checks: [string, () => void][] = [
    ['status READY again', () => assert.equal(after!.status, 'READY')],
    ['coverage complete after retry', () => assert.equal(a2.coverage.complete, true, JSON.stringify(a2.coverage))],
    ['failed unit was re-run (unitsFailed=0)', () => assert.equal(a2.coverage.unitsFailed, 0)],
    ['successful section 0 was preserved, not re-analysed', () => {
      const facts: string[] = a2.keyFacts
      assert.ok(facts.some(f => f.includes('SENTINEL_PRESERVED_FACT_XYZ')), `facts: ${facts.slice(0, 3).join(' | ')}`)
    }],
    ['all units OK in outcomes', () => {
      assert.equal(a2.sectionOutcomes.filter((o: { status: string }) => o.status === 'OK').length, a2.sectionOutcomes.length)
    }],
  ]
  let ok = 0
  for (const [name, fn] of checks) {
    try { fn(); ok++; console.log(`  ✓ ${name}`) } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`) }
  }

  await db.studyDocument.deleteMany({ where: { guestId: GUEST } })
  console.log(`\n${ok}/${checks.length} passed`)
  await db.$disconnect()
  process.exit(ok === checks.length ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
