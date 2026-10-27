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

check('fair cap: every level-1 topic survives, level-2 trimmed round-robin (never the whole tail)', () => {
  const SUBJECTS = ['Algebra Foundations', 'Trigonometry Ratios', 'Kinematics Basics', 'Cell Division', 'Chemical Equilibrium', 'Optics Principles', 'Electrostatics Laws', 'Thermodynamics Rules', 'Genetics Patterns', 'Human Digestion', 'Plant Hormones', 'Wave Motion', 'Gravitation Theory', 'Periodic Trends', 'Acids and Bases', 'Nervous System', 'Endocrine Glands', 'Ecosystem Dynamics', 'Probability Theory', 'Statistics Methods', 'Number Theory', 'Mensuration Formulas', 'Light Reflection', 'Sound Propagation', 'Friction Forces', 'Magnetism Effects', 'Nuclear Physics', 'Organic Chemistry', 'Coordination Compounds', 'Vector Algebra']
  const CONCEPTS = ['Definition Scope', 'Core Postulates', 'Key Derivations', 'Worked Examples', 'Common Exceptions']
  const inputs = []
  const pageTextIndex = new Map()
  for (let s = 0; s < 30; s++) {
    const parent = `Chapter ${s + 1} ${SUBJECTS[s]}`
    inputs.push(T(parent, [], [s + 1], s, parent, s + 1, s + 1, true))
    for (let c = 0; c < 5; c++) {
      inputs.push(T(`${SUBJECTS[s]} ${CONCEPTS[c]}`, [], [s + 1], s, parent, s + 1, s + 1))
    }
    pageTextIndex.set(s + 1, `${SUBJECTS[s].toLowerCase()} concept text page ${s + 1}`)
  }
  const out = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 60 })
  const l1 = out.filter(t => t.level === 1)
  assert.equal(l1.length, 30, `all 30 L1 topics must survive, got ${l1.length}`)
  assert.ok(out.length <= 60, `cap respected: ${out.length}`)
  // children spread over the WHOLE document (round-robin), not amputated by page order
  const parentsWithChildren = new Set(out.filter(t => t.level === 2).map(t => t.parentId))
  assert.ok(parentsWithChildren.size === 30, `parents keeping children: ${parentsWithChildren.size}/30`)
  // first and last chapters both keep children — the back of the document is intact
  const lastParent = l1.find(t => t.name.startsWith('Chapter 30'))
  assert.ok(out.some(t => t.level === 2 && t.parentId === lastParent.id), 'last chapter keeps a child')
})

check('re-analysis determinism: canonicalizeTopics is a pure function of its inputs', () => {
  const inputs = [
    T('Photosynthesis', ['light reactions'], [3], 0, null, 3, 4),
    T('photosynthesis  overview', [], [4], 1, null, 3, 4),
    T('Photosynthesis Overview', [], [3, 4], 2, null, 3, 4),
  ]
  const a = canonicalizeTopics(inputs, { pageTextIndex: idx, maxTopics: 2 })
  const b = canonicalizeTopics(inputs, { pageTextIndex: idx, maxTopics: 2 })
  assert.deepEqual(a, b)
})

console.log('── TOC wrapped-row joining (real-world wrap patterns) ──')
function pageOf(lines, page) {
  const text = lines.join('\n')
  return { page, chars: text.length, text, scanned: false }
}
check('wrapped rows join; fragments never become sections', () => {
  const toc = pageOf([
    'CUET(UG) 2026- INFORMATION BULLETIN',
    'Index',
    'Chapter-1 Introduction 13-14',
    'Chapter-2 Examination Scheme 15',
    '6. VI Procedure to be adopted for compilation of NTA Score',
    'for Multi Shifts Papers in CUET (UG) 2026 58-67',
    '8. VIII Certificate regarding physical limitation in an Examinee',
    'to Write 71',
    '10. X Letter of Undertaking for using Own Scribe 73',
  ], 1)
  const body = pageOf(['Some chapter body text about examinations and scoring rules for the test.'], 2)
  const s = detectStructure([toc, body], 2, { maxUnitChars: 6000 })
  const titles = s.toc.map(e => e.title)
  assert.ok(!titles.some(t => t.startsWith('for Multi')), `fragment leaked: ${JSON.stringify(titles)}`)
  assert.ok(!titles.some(t => t === 'to Write'), `fragment leaked: ${JSON.stringify(titles)}`)
  assert.ok(titles.some(t => t.includes('for Multi Shifts Papers')), JSON.stringify(titles))
  assert.ok(titles.some(t => t.includes('Examinee to Write')), JSON.stringify(titles))
  assert.ok(titles.some(t => t.includes('Letter of Undertaking')), JSON.stringify(titles))
})
check('pure-number wrap tail completes the pending title ("2026 74-94")', () => {
  const toc = pageOf([
    'Index',
    'Appendix X Replica of the online Application Form of CUET (UG) –',
    '2026 74-94',
    'Appendix Y List of Centres 80',
    'Appendix Z Fee Refund Procedure 84',
    'Appendix W Cutting Marks Procedure 88',
    'Appendix V Answer Sheet Review 92',
  ], 1)
  const body = pageOf(['Appendix body content with enough words to be a real page of the document.'], 2)
  const s = detectStructure([toc, body], 2, { maxUnitChars: 6000 })
  const e = s.toc.find(e => e.title.includes('Replica'))
  assert.ok(e, `missing: ${JSON.stringify(s.toc)}`)
  assert.ok(e.title.includes('2026'), e.title)
  assert.equal(e.page, 74)
})
check('standalone wrapped page number completes a pending title ("72")', () => {
  const toc = pageOf([
    'Index',
    '9. IX Certificate for person with specified disability covered',
    'under the definition of Section 2 (s) of the RPwD Act,',
    '2016 but not covered under the definition of Section',
    '2(r) of the said Act i.e. persons having less than 40%',
    'disability and having difficulty in writing',
    '72',
    '10. X Letter of Undertaking 73',
    '11. XI Application Form Replica 74',
    '12. XII Fee Receipt Copy 76',
    '13. XIII Hall Ticket Sample 78',
    '14. XIV Results Notification 80',
  ], 1)
  const body = pageOf(['Ordinary body text to make a second page of the document for validation.'], 2)
  const s = detectStructure([toc, body], 2, { maxUnitChars: 6000 })
  const e = s.toc.find(e => e.title.includes('Certificate for person'))
  assert.ok(e, `missing: ${JSON.stringify(s.toc)}`)
  assert.equal(e.page, 72)
})
check('dense data-list pages are NOT contents pages (code-prefixed rows)', () => {
  const rows = []
  const cities = ['Ahmedabad', 'Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Kolkata', 'Mumbai', 'Patna', 'Pune', 'Surat']
  for (let i = 0; i < 40; i++) rows.push(`${101 + i}  ${cities[i % cities.length]}  Zone ${(i % 4) + 1}`)
  const listPage = pageOf(['List of Examination Centres', 'Centre Code  City  Zone', ...rows], 2)
  const toc = pageOf(['Index', 'Chapter 1 Alpha Topic ......... 3', 'Chapter 2 Beta Topic ......... 4', 'Chapter 3 Gamma Topic ......... 5', 'Chapter 4 Delta Topic ......... 6'], 1)
  const bodies = [3, 4, 5, 6].map(p => pageOf([`Chapter body text page ${p} with enough words to be a real readable page here.`], p))
  const s = detectStructure([toc, ...bodies, listPage], 6, { maxUnitChars: 6000 })
  const junk = s.toc.filter(e => /^\d{2,}\s/.test(e.title))
  assert.equal(junk.length, 0, `data rows leaked into TOC: ${JSON.stringify(junk.slice(0, 3))}`)
  assert.ok(s.toc.length >= 4, `real entries kept: ${s.toc.length}`)
})

console.log('── verifyPages ──')
check('keeps only in-range pages whose text contains the title tokens', () => {
  const r = verifyPages('Glycolysis', [5, 99], [{ fromPage: 5, toPage: 5 }], idx, null)
  assert.deepEqual(r.pages, [5])
  assert.equal(r.verified, true)
})
check('drops out-of-range claims even when the topic exists elsewhere', () => {
  const r = verifyPages('Glycolysis', [99], [{ fromPage: 3, toPage: 4 }], idx, null)
  assert.deepEqual(r.pages, [])
  assert.equal(r.verified, false)
})
check('anchored page is always kept', () => {
  const r = verifyPages('The Heart', [4], [{ fromPage: 4, toPage: 4 }], new Map([[4, 'x y z']]), 4)
  assert.deepEqual(r.pages, [4])
  assert.equal(r.verified, true)
})
check('a topic merged from several chunks of one long section keeps its FULL page span', () => {
  const idxMulti = new Map([
    [40, 'list of examination cities for cuet begins here ahmedabad bengaluru'],
    [41, 'more cities chennai delhi exam cities continue'],
    [44, 'cities continued guwahati hyderabad'],
    [47, 'cities end visakhapatnam'],
  ])
  const r = verifyPages(
    'III List of Examination Cities for CUET (UG) - 2026',
    [40, 41, 42, 43, 44, 45, 46, 47],
    [{ fromPage: 40, toPage: 43 }, { fromPage: 44, toPage: 47 }],
    idxMulti,
    40,
  )
  assert.deepEqual(r.pages, [40, 41, 44, 47], `got ${JSON.stringify(r.pages)}`)
  assert.equal(r.verified, true)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
