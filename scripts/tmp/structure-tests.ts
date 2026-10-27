// ─── Unit tests: structure detection + topic canonicalisation (no AI calls) ──
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { extractPdfPages } from '../../src/lib/riishe/extract'
import { detectStructure, detectPrintedPages, verifyTocLayer } from '../../src/lib/riishe/structure'
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

function T(name, subtopics, pages, unitIndex, unitTitle, fromPage, toPage, anchored) {
  // Mirrors the real pipeline contract: collectTopicInputs marks unit-title
  // topics anchored:true + origin 'SOURCE_HEADING'; model output is unanchored.
  return { name, subtopics, pages, unitIndex, unitTitle, unitFromPage: fromPage, unitToPage: toPage, ...(anchored ? { anchored: true, origin: 'SOURCE_HEADING' } : {}) }
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
    T('Chapter 1 Photosynthesis Overview', [], [3, 4], 0, 'Chapter 1 Photosynthesis Overview', 3, 4, true),
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

// ═══ Task I regressions: structure fidelity, origin layers, evidence ═════════

console.log('── Task I: origin-aware dedupe (no cross-section fusing) ──')
check('appendix heading is NEVER fused with a same-words topic from another chapter', () => {
  // Regression: "I List of Central Universities" (appendix, pages 36-37) was
  // merged with "List of Central Universities" mentioned in Chapter-1 (p14).
  const idxA = new Map([
    [14, 'about central universities the list of central universities act 2009'],
    [36, 'appendix i list of central universities central university of rajasthan'],
    [37, 'central university of gujarat central university of kerala'],
  ])
  const out = canonicalizeTopics([
    T('Chapter-1 Introduction', [], [14, 15], 2, 'Chapter-1 Introduction', 14, 15, true),
    T('List of Central Universities', ['Central Universities Act'], [14], 2, 'Chapter-1 Introduction', 14, 15),
    T('I List of Central Universities', [], [36, 37], 8, 'I List of Central Universities', 36, 37, true),
  ], { pageTextIndex: idxA })
  // three honest topics: the chapter heading, the chapter's own inferred
  // mention, and the appendix — the last two NEVER fuse
  assert.equal(out.length, 3, `wrong grouping: ${JSON.stringify(out.map(t => t.name))}`)
  const appendix = out.find(t => t.origin === 'SOURCE_HEADING' && t.numbering === 'I')
  assert.ok(appendix, 'appendix stays a source heading')
  assert.equal(appendix.numbering, 'I')
  assert.deepEqual(appendix.pages, [36, 37])
  const chapterHeading = out.find(t => t.name === 'Chapter-1 Introduction')
  assert.ok(chapterHeading && chapterHeading.level === 1)
  const inferred = out.find(t => t.origin === 'AI_INFERRED')
  assert.ok(inferred, 'chapter mention stays an inferred topic')
  assert.equal(inferred.level, 2, 'chapter mention sits under its own section')
  assert.equal(inferred.parentId, chapterHeading?.id)
})
check('model echo of a section title merges INTO the source heading (never renamed)', () => {
  const idxB = new Map([[19, 'chapter 4 reservation provisions for reservation categories']])
  const out = canonicalizeTopics([
    T('Chapter-4 Reservation', [], [19], 0, 'Chapter-4 Reservation', 19, 19, true),
    T('Chapter 4 Reservation', [], [19], 1, 'Chapter-4 Reservation', 19, 20),
  ], { pageTextIndex: idxB })
  assert.equal(out.length, 1, JSON.stringify(out.map(t => t.name)))
  assert.equal(out[0].origin, 'SOURCE_HEADING')
  assert.equal(out[0].name, 'Chapter-4 Reservation', 'document wording wins')
  assert.equal(out[0].numbering, 'Chapter-4')
  assert.ok((out[0].aliases ?? []).length >= 1, 'echo kept as alias')
})
check('near-identical inferred topics in the same section merge ("Rough Work" pattern)', () => {
  const idxC = new Map([
    [56, 'rough work may be done on the blank sheets provided in the test book'],
    [58, 'rough work guidelines hand over the rough sheets to the invigilator'],
  ])
  const out = canonicalizeTopics([
    T('Rough Work', [], [56], 4, 'V Computer Based Test (CBT) Guidelines', 56, 56),
    T('Rough Work Guidelines', [], [58], 6, 'V Computer Based Test (CBT) Guidelines', 58, 58),
  ], { pageTextIndex: idxC })
  assert.equal(out.length, 1, `kept separate: ${JSON.stringify(out.map(t => t.name))}`)
})
check('similar inferred topics in DIFFERENT sections stay separate', () => {
  const idxD = new Map([
    [26, 'rough work on the sheets provided during the examination instructions'],
    [56, 'rough work may be done on the blank sheets provided in the test book'],
  ])
  const out = canonicalizeTopics([
    T('Rough Work', [], [26], 2, 'Chapter-8 Important instructions for the candidates', 26, 26),
    T('Rough Work', [], [56], 4, 'V Computer Based Test (CBT) Guidelines', 56, 56),
  ], { pageTextIndex: idxD })
  assert.equal(out.length, 2, `fused across sections: ${JSON.stringify(out.map(t => t.name))}`)
})
check('chunk continuations of one long section merge into ONE source topic', () => {
  const idxE = new Map([
    [7, 'important information and dates at a glance fee structure dates'],
    [8, 'important information and dates at a glance application details'],
    [9, 'important information and dates at a glance eligibility window'],
  ])
  const out = canonicalizeTopics([
    T('Important Information and Dates at a Glance', [], [7, 8], 1, 'Important Information and Dates at a Glance', 7, 8, true),
    T('Important Information and Dates at a Glance', [], [9], 2, 'Important Information and Dates at a Glance', 9, 9, true),
  ], { pageTextIndex: idxE })
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].pages, [7, 8, 9])
  assert.equal(out[0].origin, 'SOURCE_HEADING')
})
check('inferred topic attaches to the section that produced it (no self-parent, ever)', () => {
  const idxF = new Map([
    [16, 'examination scheme mode of examination computer based test'],
    [17, 'examination scheme marking scheme four marks'],
  ])
  const out = canonicalizeTopics([
    T('Chapter-2 Examination Scheme', [], [16], 0, 'Chapter-2 Examination Scheme', 16, 16, true),
    T('Chapter-2 Examination Scheme', [], [17], 1, 'Chapter-2 Examination Scheme', 17, 17, true),
    T('Mode of Examination', [], [16], 0, 'Chapter-2 Examination Scheme', 16, 16),
    T('Marking Scheme', [], [17], 1, 'Chapter-2 Examination Scheme', 17, 17),
  ], { pageTextIndex: idxF })
  const parent = out.find(t => t.name === 'Chapter-2 Examination Scheme')
  assert.ok(parent)
  for (const t of out) assert.notEqual(t.parentId, t.id, 'self-parent found')
  const mode = out.find(t => t.name === 'Mode of Examination')
  assert.equal(mode?.level, 2)
  assert.equal(mode?.parentId, parent?.id)
})

console.log('── Task I: subtopic evidence filter (no invented/garbled keywords) ──')
check('garbled subtopic fragments are dropped, real entries survive', () => {
  const idxG = new Map([[55, 'technical issues malfunction replacement time adjustment on screen keyboard']])
  const out = canonicalizeTopics([
    T('Technical Issues', ['alfunction', 'replacement', 'time adjustment', 'Invented Category'], [55], 3, 'V Computer Based Test (CBT) Guidelines', 55, 55),
  ], { pageTextIndex: idxG })
  const subs = out[0].subtopics
  assert.ok(!subs.includes('alfunction'), `garbled kept: ${JSON.stringify(subs)}`)
  assert.ok(!subs.includes('Invented Category'), `invented kept: ${JSON.stringify(subs)}`)
  assert.ok(subs.includes('replacement'), `real dropped: ${JSON.stringify(subs)}`)
  assert.ok(subs.includes('time adjustment'), `real dropped: ${JSON.stringify(subs)}`)
})
check('page verification is word-boundary based ("rate" is not supported by "moderate")', () => {
  const r = verifyPages('Interest Rate', [9], [{ fromPage: 9, toPage: 9 }], new Map([[9, 'a moderate pace of growth was observed']]), null)
  // the unit-range fallback keeps the page honestly, but it is NOT verified
  assert.deepEqual(r.pages, [9])
  assert.equal(r.verified, false)
  const r2 = verifyPages('Interest Rate', [9], [{ fromPage: 9, toPage: 9 }], new Map([[9, 'the interest rate was revised moderate growth']]), null)
  assert.deepEqual(r2.pages, [9])
  assert.equal(r2.verified, true)
})

console.log('── Task I: TOC layer (original structure recorded honestly) ──')
// pageOf() from the wrapped-row section above is reused
check('image-reprint appendix is KEPT as a section and recorded honestly', () => {
  const toc = pageOf([
    'Index',
    'Chapter-1 Alpha Foundations 2',
    'Chapter-2 Beta Concepts 3',
    '7. VII The Gazette of India notification related to PwD',
    'candidates 4',
    '8. VIII Certificate regarding physical limitation 5',
  ], 1)
  const p2 = pageOf(['Alpha foundations chapter body text with enough words to be a real readable page.'], 2)
  const p3 = pageOf(['Beta concepts chapter body text with enough words to be a real readable page too.'], 3)
  const p4 = pageOf(['Appendix VII'], 4) // image-only reprint: only the heading survived extraction
  const p5 = pageOf(['Certificate regarding physical limitation in an Examinee to Write the body.'], 5)
  const s = detectStructure([toc, p2, p3, p4, p5], 5, { maxUnitChars: 6000 })
  assert.equal(s.kind, 'TOC_GUIDED', `kind ${s.kind}`)
  // the section EXISTS (never dropped into a neighbour's range)
  const gazetteUnit = s.units.find(u => u.title && u.title.includes('Gazette'))
  assert.ok(gazetteUnit, `no Gazette unit: ${JSON.stringify(s.units.map(u => u.title))}`)
  assert.equal(gazetteUnit.fromPage, 4)
  // the TOC layer records the entry with its own numbering
  const entry = s.tocLayer.find(e => e.title.includes('Gazette'))
  assert.ok(entry, 'toc layer missing the Gazette entry')
  assert.equal(entry.number, 'VII')
  assert.equal(entry.matchPage, 4, 'the body heading line "Appendix VII" is evidence')
  assert.equal(entry.matched, true)
  // fully-unreadable claimed page → honest unverified record, entry never vanishes
  const p4scanned = { page: 4, chars: 8, text: '', scanned: true }
  const s2 = detectStructure([toc, p2, p3, p4scanned, p5], 5, { maxUnitChars: 6000 })
  const entry2 = s2.tocLayer.find(e => e.title.includes('Gazette'))
  assert.ok(entry2, 'entry vanished when the claimed page is scanned')
  assert.equal(entry2.matched, false)
  assert.ok(entry2.note && /image-only|no readable text/i.test(entry2.note), `note: ${entry2.note}`)
  // a scanned page cannot form a readable analysis unit — but the NEXT section
  // still starts at its own page (VII's pages never swallow VIII's)
  const unitVIII = s2.units.find(u => u.title && u.title.includes('Certificate'))
  assert.ok(unitVIII, 'next section missing')
  assert.equal(unitVIII.fromPage, 5)
})
check('"9. IX"-style numeral rows keep their numbering through wrapped titles', () => {
  const toc = pageOf([
    'Index',
    '9. IX',
    'Certificate for person with specified disability covered',
    'under the definition of Section 2 (s) of the RPwD Act,',
    '2016 but not covered under the definition of Section',
    '2(r) of the said Act i.e. persons having less than 40%',
    'disability and having difficulty in writing',
    '72',
    '10. X Letter of Undertaking 73',
    '11. XI Application Form Replica 74',
    '12. XII Fee Receipt Copy 76',
    '13. XIII Hall Ticket Sample 78',
  ], 1)
  const body = pageOf(['Certificate for person with specified disability covered under the definition of Section 2 (s) of the RPwD Act 2016.'], 2)
  const s = detectStructure([toc, body], 2, { maxUnitChars: 6000 })
  const e = s.toc.find(x => x.title.includes('Certificate for person'))
  assert.ok(e, 'entry missing')
  assert.equal(e.number, 'IX', `number was ${e.number}`)
  assert.ok(e.title.includes('difficulty in writing'), `title truncated: ${e.title}`)
})
check('wrapped TOC titles are not truncated at 90 characters', () => {
  const longTitle = '9. IX Certificate for person with specified disability covered under the definition of Section 2 (s) of the RPwD Act, 2016 but not covered under the definition of Section 2(r) of the said Act i.e. persons having less than 40% disability and having difficulty in writing'
  const toc = pageOf(['Index', '9. IX', longTitle.replace(/^9\. IX /, ''), '190', '10. X Letter of Undertaking 191', '11. XI Application Form Replica 192', '12. XII Fee Receipt Copy 193', '13. XIII Hall Ticket Sample 194'], 1)
  const body = pageOf(['Certificate body page with the disability definition text for verification purposes.'], 2)
  const s = detectStructure([toc, body], 2, { maxUnitChars: 6000 })
  const e = s.toc.find(x => x.title.includes('Certificate'))
  assert.ok(e && e.title.includes('difficulty in writing'), `truncated: ${e?.title}`)
})
check('verifyTocLayer reports matched/unmatched counts the pipeline can store', () => {
  const toc = pageOf(['Index', 'Chapter-1 One 2', 'Chapter-2 Two 3', 'Chapter-3 Three 4', 'Chapter-4 Four 5'], 1)
  const bodies = [2, 3, 4, 5].map(p => pageOf([`Chapter body page ${p} with enough words to be a real readable page here.`], p))
  const readable = bodies
  const layer = verifyTocLayer(
    [{ title: 'Chapter-1 One', page: 2, number: 'Chapter-1' }, { title: 'Chapter-2 Two', page: 3, number: 'Chapter-2' }, { title: 'Chapter-3 Three', page: 4, number: 'Chapter-3' }, { title: 'Chapter-4 Four', page: 5, number: 'Chapter-4' }],
    readable,
    0,
  )
  assert.equal(layer.length, 4)
  assert.equal(layer.filter(e => e.matched).length, 4)
  const empty = verifyTocLayer([{ title: 'Chapter-9 Nine', page: 40, number: 'Chapter-9' }], readable, 1)
  assert.equal(empty[0].matched, false)
  assert.ok(empty[0].note)
})
check('printed page labels are recorded as per-page evidence', () => {
  const pages = [
    pageOf(['Cover page with artwork only'], 1),
    pageOf(['Page |1', 'Introduction body text with plenty of readable words for the check.'], 2),
    pageOf(['Page |2', 'Second body text with plenty of readable words for the check here.'], 3),
    pageOf(['Page |3', 'Third body text with plenty of readable words for the check too.'], 4),
    pageOf(['Page |4', 'Fourth body text with plenty of readable words for the check end.'], 5),
    pageOf(['Page |5', 'Fifth body text with plenty of readable words for the check fin.'], 6),
  ]
  const printed = detectPrintedPages(pages)
  assert.equal(printed.offset, 1)
  assert.equal(printed.labels[2], '1')
  assert.equal(printed.labels[6], '5')
  assert.equal(printed.labels[1], undefined, 'no label invented for the cover')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
