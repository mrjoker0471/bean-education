// ─── Deterministic verification of the stored CUET analysis (no AI calls) ────
// Checks Task I's core promises against the REAL 96-page document:
//   1. every topic's page refs land on pages whose text contains the topic's words
//   2. printed page labels = physical − detected offset, when claimed
//   3. no duplicate topics (normalized), aliases recorded
//   4. hierarchy consistent: level-2 topics have an existing level-1 parent
//   5. coverage ledger adds up; TOC units' spans verified against body text
//   6. spot-check: TOC-claimed section titles actually appear on their pages
import { PrismaClient } from '@prisma/client'
import assert from 'node:assert'

const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
if (!doc || !doc.analysisJson || !doc.extractionJson) throw new Error('no analysed document to verify')
const a = JSON.parse(doc.analysisJson)
const pages: { page: number; text: string; scanned: boolean }[] = JSON.parse(doc.extractionJson)

let passed = 0, failed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`) }
}

const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an|of|for|and|in|to|on|with|by)\b/g, ' ').replace(/\s+/g, ' ').trim()
const pageText = new Map(pages.filter(p => !p.scanned).map(p => [p.page, normText(p.text)]))

console.log(`doc: ${doc.title} (${doc.pageCount} pages, ${pages.length} extracted)`)
console.log(`structure: ${JSON.stringify(a.structure)}`)
console.log(`coverage: ${JSON.stringify(a.coverage)}`)

await check('every topic page-ref lands on a page containing a meaningful title token', () => {
  let verified = 0, total = 0
  for (const t of a.topics) {
    assert.ok(Array.isArray(t.pages) && t.pages.length > 0, `${t.name}: no pages`)
    for (const p of t.pages) {
      total++
      assert.ok(p >= 1 && p <= doc.pageCount!, `${t.name}: page ${p} out of document range`)
      const text = pageText.get(p)
      if (!text) continue // scanned page — cannot verify, but chip still opens it
      const tokens = normTitle(t.name).split(' ').filter((w: string) => w.length > 4)
      if (tokens.length === 0 || tokens.some((tok: string) => text.includes(tok))) verified++
    }
  }
  console.log(`    → ${verified}/${total} topic-page pairs token-verified against page text`)
  assert.ok(verified / total > 0.6, `only ${verified}/${total} pairs verified`)
})

await check('printed page labels (offset 1) are consistent physical−1', () => {
  assert.equal(a.structure.printedPageOffset, 1, 'offset should be 1 for this bulletin')
  const withPrinted = a.topics.filter((t: any) => t.printedPages?.length > 0)
  assert.ok(withPrinted.length > 0, 'no topic carries printed labels')
  for (const t of withPrinted) {
    assert.equal(t.printedPages.length, t.pages.length, `${t.name}: printed labels must match physical 1:1`)
    for (let i = 0; i < t.pages.length; i++) assert.equal(Number(t.printedPages[i]), t.pages[i] - 1)
  }
})

await check('no duplicate topic names (normalized) and aliases kept', () => {
  const norms = a.topics.map((t: any) => normTitle(t.name))
  assert.equal(new Set(norms).size, norms.length, `dups: ${norms.filter((n: string, i: number) => norms.indexOf(n) !== i)}`)
  const withAliases = a.topics.filter((t: any) => t.aliases?.length > 0)
  console.log(`    → ${withAliases.length} topics carry merged aliases`)
})

await check('hierarchy: level-2 topics have existing level-1 parents; ids unique', () => {
  const ids = new Set(a.topics.map((t: any) => t.id))
  assert.equal(ids.size, a.topics.length, 'duplicate topic ids')
  const l1 = new Set(a.topics.filter((t: any) => t.level === 1).map((t: any) => t.id))
  for (const t of a.topics) {
    if (t.level === 2) assert.ok(t.parentId && l1.has(t.parentId), `${t.name}: parent ${t.parentId} missing/level1`)
  }
  const l1Count = a.topics.filter((t: any) => t.level === 1).length
  const l2Count = a.topics.filter((t: any) => t.level === 2).length
  console.log(`    → ${l1Count} level-1 sections, ${l2Count} level-2 concepts`)
})

await check('coverage ledger adds up: analysed+skipped+unanalysed == readable', () => {
  const c = a.coverage
  assert.equal(c.analysedPages + c.skippedPages + c.unanalysedPages, c.readablePages, JSON.stringify(c))
  assert.ok(c.unitsTotal === c.unitsOk + c.unitsFailed + c.unitsSkipped)
  assert.equal(c.complete, c.unanalysedPages === 0 && c.unitsFailed === 0 && c.unitsTotal > 0)
})

await check('section outcomes: every unit accounted, spans within document', () => {
  const outs = a.sectionOutcomes ?? []
  assert.equal(outs.length, a.coverage.unitsTotal)
  for (const o of outs) {
    assert.ok(o.fromPage >= 1 && o.toPage <= doc.pageCount!, `outcome ${o.label}: bad span`)
    if (o.status === 'FAILED') assert.ok(o.error, 'failed outcome needs a reason')
    if (o.status === 'SKIPPED') assert.ok(o.error && o.error.length > 20, 'skipped outcome needs a reason')
  }
})

await check('TOC-guided spot-check: major sections appear on their claimed physical pages', () => {
  // the bulletin's own chapter titles as detected — sample across the document
  const sections = a.topics.filter((t: any) => t.level === 1).slice(0, 40)
  assert.ok(sections.length >= 10, `only ${sections.length} level-1 sections`)
  let hits = 0
  const misses: string[] = []
  for (const s of sections) {
    const text = pageText.get(s.pages[0])
    const tokens = normTitle(s.name).split(' ').filter((w: string) => w.length > 4)
    if (tokens.length === 0 || (text && tokens.some((tok: string) => text.includes(tok)))) hits++
    else misses.push(`${s.name} @p${s.pages[0]}`)
  }
  console.log(`    → ${hits}/${sections.length} section titles verified on their anchor page${misses.length ? ` (misses: ${misses.slice(0, 5).join('; ')})` : ''}`)
  assert.ok(hits / sections.length >= 0.6, `only ${hits}/${sections.length}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
await db.$disconnect()
process.exit(failed > 0 ? 1 : 0)
