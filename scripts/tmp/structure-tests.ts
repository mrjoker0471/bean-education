// ─── Unit tests: structure detection + topic canonicalisation (no AI calls) ──
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
import { canonicalizeTopics, normalizeTitle, verifyPages } from '../../src/lib/riishe/dedupe'

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('── normalizeTitle ──')
check('punctuation/case/articles collapse to one form', () => {
  assert.equal(normalizeTitle('About the National Testing Agency (NTA)'), normalizeTitle('About National Testing Agency NTA'))
})
check('plural/wording variants merge via canonicalizeTopics, not raw equality', () => {
  const idxX = new Map([[3, 'tests subject covered mode of examination scheme']])
  const out = canonicalizeTopics([
    T('Tests / Subjects covered under CUET (UG) – 2026', [], [3], 0, null, 3, 3),
    T('Tests/Subject covered', [], [3], 0, null, 3, 3),
  ], { pageTextIndex: idxX })
  assert.equal(out.length, 1, JSON.stringify(out.map(t => t.name)))
})
check('distinct concepts stay distinct', () => {
  assert.notEqual(normalizeTitle('Reservation Policy'), normalizeTitle('Eligibility Criteria'))
})

console.log('── textbook-toc.pdf ──')
await checkAsync('extracts with line structure', async () => {
  const buf = readFileSync('/tmp/riishe-test-docs/textbook-toc.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  assert.ok(ex.numPages === 18, `expected 18 pages, got ${ex.numPages}`)
  assert.ok(ex.pages[1].text.includes('\n'), 'page 2 should have line breaks')
  globalThis.__tb = ex
})
await checkAsync('detects TOC-guided structure with validated contents', async () => {
  const ex = globalThis.__tb
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
  assert.equal(s.kind, 'TOC_GUIDED', `kind was ${s.kind}`)
  assert.equal(s.tocValidated, true, `tocValidated=${s.tocValidated} entries=${s.toc.length}`)
  assert.ok(s.toc.length >= 8, `toc entries ${s.toc.length}`)
  assert.ok(s.headings.length >= 8, `headings ${s.headings.length}`)
  const chTitles = s.headings.filter(h => /Chapter/.test(h.title)).length
  assert.ok(chTitles >= 8, `chapter headings ${chTitles}`)
  globalThis.__tbs = s
})
await checkAsync('detects printed page offset of 2', async () => {
  const s = globalThis.__tbs
  assert.equal(s.printed.offset, 2, `offset ${s.printed.offset}`)
})
await checkAsync('units cover every readable page exactly once', async () => {
  const ex = globalThis.__tb
  const s = globalThis.__tbs
  const readable = ex.pages.filter(p => !p.scanned && p.text.length > 0).map(p => p.page).sort((a, b) => a - b)
  const covered = s.units.flatMap(u => { const out = []; for (let i = u.fromPage; i <= u.toPage; i++) out.push(i); return out }).sort((a, b) => a - b)
  assert.deepEqual(covered, readable, 'unit pages must equal readable pages')
  // no overlaps
  const seen = new Set()
  for (const u of s.units) for (let p = u.fromPage; p <= u.toPage; p++) { assert.ok(!seen.has(p), `page ${p} double-covered`); seen.add(p) }
})
await checkAsync('section units carry the chapter titles', async () => {
  const s = globalThis.__tbs
  const titles = s.units.filter(u => u.kind === 'SECTION').map(u => u.title)
  assert.ok(titles.some(t => t && t.includes('Photosynthesis')), `got: ${JSON.stringify(titles.slice(0, 4))}`)
  assert.ok(titles.some(t => t && t.includes('Chemical Bonding')))
})

console.log('── lecture-notes.pdf (no TOC, unnumbered headings) ──')
await checkAsync('detects heading-guided or unstructured — never a fake TOC', async () => {
  const buf = readFileSync('/tmp/riishe-test-docs/lecture-notes.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
  assert.ok(['HEADING_GUIDED', 'UNSTRUCTURED'].includes(s.kind), `kind was ${s.kind}`)
  assert.equal(s.tocValidated, false, 'no TOC should be validated')
  assert.equal(s.printed.offset, null, 'no printed numbers here')
  const readable = ex.pages.filter(p => !p.scanned && p.text.length > 0).map(p => p.page).sort((a, b) => a - b)
  const covered = s.units.flatMap(u => { const out = []; for (let i = u.fromPage; i <= u.toPage; i++) out.push(i); return out }).sort((a, b) => a - b)
  assert.deepEqual(covered, readable, 'must still cover the whole document')
})

console.log('── question-paper.pdf ──')
await checkAsync('classified as QUESTION_PAPER, not exploded into per-question topics', async () => {
  const buf = readFileSync('/tmp/riishe-test-docs/question-paper.pdf')
  const ex = await extractPdfPages(new Uint8Array(buf))
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })
  assert.equal(s.kind, 'QUESTION_PAPER', `kind was ${s.kind}`)
})

console.log('── canonicalizeTopics ──')
const idx = new Map([
  [3, 'photosynthesis converts light energy into chemical energy stored in glucose light reactions happen in the thylakoid membrane'],
  [4, 'dark reactions also called the calvin cycle happen in the stroma of the chloroplast'],
  [5, 'glycolysis happens in the cytoplasm and yields two atp per glucose'],
])

function T(name, subtopics, pages, unitIndex, unitTitle, fromPage, toPage) {
  return { name, subtopics, pages, unitIndex, unitTitle, unitFromPage: fromPage, unitToPage: toPage }
}

check('merges exact-normalised duplicates from different sections', () => {
  const out = canonicalizeTopics([
    T('Photosynthesis Overview', [], [3], 0, 'Chapter 1 Photosynthesis Overview', 3, 4),
    T('photosynthesis overview', [], [4], 1, 'Chapter 1 Photosynthesis Overview', 3, 4),
  ], { pageTextIndex: idx })
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'Photosynthesis Overview')
  assert.ok(out[0].aliases.length >= 1, `aliases: ${out[0].aliases}`)
})
check('merges near-duplicate wordings (TOC vs body heading)', () => {
  const out = canonicalizeTopics([
    T('About the National Testing Agency', [], [3], 0, null, 3, 4),
    T('About National Testing Agency (NTA)', [], [3], 1, null, 3, 4),
  ], { pageTextIndex: idx })
  assert.equal(out.length, 1, JSON.stringify(out.map(t => t.name)))
})
check('merges containment duplicates like Eligibility / Eligibility Criteria in the same area', () => {
  const out = canonicalizeTopics([
    T('Eligibility', [], [3], 0, null, 3, 4),
    T('Eligibility Criteria', [], [3], 1, null, 3, 4),
  ], { pageTextIndex: idx })
  assert.equal(out.length, 1, JSON.stringify(out.map(t => t.name)))
})
check('does NOT merge distinct concepts with similar names in different areas', () => {
  const idx2 = new Map([
    [2, 'reservations for obc sc st candidates follow the central list'],
    [3, 'reservations for obc sc st candidates follow the central list'],
    [40, 'eligibility criteria require the candidate to have passed class twelve'],
    [41, 'eligibility criteria require the candidate to have passed class twelve'],
  ])
  const out = canonicalizeTopics([
    T('Reservation Policy', [], [2, 3], 0, 'Chapter 3 Reservation', 2, 3),
    T('Eligibility Criteria', [], [40, 41], 6, 'Chapter 7 Eligibility', 40, 41),
  ], { pageTextIndex: idx2 })
  assert.equal(out.length, 2, JSON.stringify(out.map(t => t.name)))
})
check('level-2 assignment under the parent heading topic', () => {
  const out = canonicalizeTopics([
    T('Chapter 1 Photosynthesis Overview', [], [3, 4], 0, 'Chapter 1 Photosynthesis Overview', 3, 4, ),
    T('Light Reactions', [], [3], 0, 'Chapter 1 Photosynthesis Overview', 3, 4),
    T('Dark Reactions', [], [4], 1, 'Chapter 1 Photosynthesis Overview', 3, 4),
  ].map(x => ({ ...x })), { pageTextIndex: idx })
  const parent = out.find(t => t.name === 'Chapter 1 Photosynthesis Overview')
  const light = out.find(t => t.name === 'Light Reactions')
  assert.ok(parent, 'parent present')
  assert.ok(light, 'child present')
  assert.equal(light.level, 2)
  assert.equal(light.parentId, parent.id)
  assert.equal(parent.level, 1)
})
check('subtopic near-duplicates are merged within a topic', () => {
  const out = canonicalizeTopics([
    T('Photosynthesis', ['light reactions', 'Light Reactions', 'the light  reactions'], [3], 0, null, 3, 4),
  ], { pageTextIndex: idx })
  assert.equal(out[0].subtopics.length, 1, JSON.stringify(out[0].subtopics))
})
check('output is deterministic across runs', () => {
  const input = [
    T('Cell Respiration', ['glycolysis'], [5], 2, 'Chapter 2 Cell Respiration', 5, 6),
    T('cell respiration', [], [5], 3, 'Chapter 2 Cell Respiration', 5, 6),
    T('Respiration', [], [5], 3, 'Chapter 2 Cell Respiration', 5, 6),
  ]
  const a = canonicalizeTopics(input, { pageTextIndex: idx })
  const b = canonicalizeTopics(input, { pageTextIndex: idx })
  assert.deepEqual(a, b)
})
check('unanchored topics carry pageVerified=false when no page supports them', () => {
  const emptyIdx = new Map([[9, 'completely unrelated words about geography']])
  const out = canonicalizeTopics([
    T('Quantum Entanglement', [], [9], 0, null, 9, 9),
  ], { pageTextIndex: emptyIdx })
  assert.equal(out[0].pageVerified, false)
  assert.deepEqual(out[0].pages, [9], 'falls back to unit range honestly')
})

console.log('── verifyPages ──')
check('keeps only in-range pages whose text contains the title tokens', () => {
  const r = verifyPages('Glycolysis', [5, 99], { fromPage: 5, toPage: 5 }, idx, null)
  assert.deepEqual(r.pages, [5])
  assert.equal(r.verified, true)
})
check('drops out-of-range claims even when the topic exists elsewhere', () => {
  const r = verifyPages('Glycolysis', [99], { fromPage: 3, toPage: 4 }, idx, null)
  assert.deepEqual(r.pages, [])
  assert.equal(r.verified, false)
})
check('anchored page is always kept', () => {
  const r = verifyPages('The Heart', [4], { fromPage: 4, toPage: 4 }, new Map([[4, 'x y z']]), 4)
  assert.deepEqual(r.pages, [4])
  assert.equal(r.verified, true)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
