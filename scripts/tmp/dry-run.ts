// ─── Deterministic dry-run: extraction + structure + canonicalisation (no AI) ─
// Proves the non-AI spine of the pipeline behaves correctly on every document
// archetype: coverage-exact units, honest structure kinds, printed pages,
// heading-anchored topic collection and duplicate-free canonicalisation using
// the model's ANALYSIS PROMPT replaced by a trivial deterministic stub.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { extractPdfPages, type ExtractedPage } from '../../src/lib/riishe/extract'
import { detectStructure } from '../../src/lib/riishe/structure'
import { collectTopicInputs } from '../../src/lib/riishe/pipeline'
import { canonicalizeTopics } from '../../src/lib/riishe/dedupe'
import { splitUnitPages } from '../../src/lib/riishe/pipeline'

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`) }
}

/** A deterministic stand-in for the AI's per-section topic extraction: uses
 *  the unit's own heading (anchored) — exercises the same data path. */
function stubParts(units: ReturnType<typeof detectStructure>['units']) {
  return units.map(u => u.title
    ? { topics: [{ name: u.title, subtopics: [], pages: [] }], definitions: [], keyFacts: [], formulas: [], misconceptions: [], unreadable: [] }
    : null)
}

function coverageOf(units: ReturnType<typeof detectStructure>['units'], readable: ExtractedPage[]) {
  const covered = new Set<number>()
  for (const u of units) for (let p = u.fromPage; p <= u.toPage; p++) covered.add(p)
  const readablePages = readable.map(p => p.page)
  return {
    readable: readablePages.length,
    covered: [...covered].filter(p => readablePages.includes(p)).length,
    exact: covered.size === readablePages.length && readablePages.every(p => covered.has(p)),
  }
}

const DOCS: [string, string, string][] = [
  ['textbook-toc.pdf', 'TOC_GUIDED', 'Foundation Science Textbook'],
  ['lecture-notes.pdf', 'HEADING_GUIDED_OR_UNSTRUCTURED', 'Economics Lecture Notes'],
  ['question-paper.pdf', 'QUESTION_PAPER', 'Physics Sample Paper'],
  ['list-appendix.pdf', 'TOC_GUIDED', 'Board Examination Guide'],
]

for (const [file, expectedKind, label] of DOCS) {
  console.log(`── ${file} (${label}) ──`)
  const ex = await extractPdfPages(new Uint8Array(readFileSync(`/tmp/riishe-test-docs/${file}`)))
  const readable = ex.pages.filter(p => !p.scanned && p.text.length > 0)
  const s = detectStructure(ex.pages, ex.numPages, { maxUnitChars: 6000 })

  check('structure kind as expected', () => {
    if (expectedKind === 'HEADING_GUIDED_OR_UNSTRUCTURED') {
      assert.ok(['HEADING_GUIDED', 'UNSTRUCTURED'].includes(s.kind), `got ${s.kind}`)
    } else {
      assert.equal(s.kind, expectedKind, `got ${s.kind}`)
    }
  })
  check('units cover every readable page exactly once', () => {
    const c = coverageOf(s.units, readable)
    assert.ok(c.exact, `readable=${c.readable} covered=${c.covered}`)
  })
  check('no unit exceeds the char budget by more than one page', () => {
    for (const u of s.units) {
      if (u.kind === 'OVERFLOW') continue
      assert.ok(u.chars <= 6000 + 2600, `unit ${u.index} (${u.title ?? 'untitled'}) chars=${u.chars}`)
    }
  })
  check('anchored topic collection + canonicalisation is duplicate-free', () => {
    const parts = stubParts(s.units)
    const pageTextIndex = new Map<number, string>()
    for (const p of ex.pages) if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
    const inputs = collectTopicInputs(parts, s.units, new Map(), s.tocPages)
    const topics = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 200, maxSubtopicsPerTopic: 12 })
    const norms = topics.map(t => t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    assert.equal(new Set(norms).size, norms.length, `dups: ${norms.filter((n, i) => norms.indexOf(n) !== i).slice(0, 5)}`)
    // every unit title survives as a topic (no section silently dropped)
    const unitTitles = s.units.filter(u => u.title).map(u => u.title as string)
    for (const t of unitTitles) {
      assert.ok(topics.some(x => x.name === t), `unit title lost: ${t}`)
    }
  })
  check('content-filter sub-chunk split stays within the unit and covers every page', () => {
    for (const u of s.units) {
      const chunks = splitUnitPages(u)
      let cursor = u.fromPage
      for (const c of chunks) {
        assert.equal(c.fromPage, cursor, `chunk gap in ${u.title ?? u.index}`)
        cursor = c.toPage + 1
      }
      assert.equal(cursor, u.toPage + 1, `chunks must end at unit end (${u.title ?? u.index})`)
    }
  })
  if (s.printed.offset !== null) {
    check(`printed offset ${s.printed.offset}: labels only ever positive; front-matter ranges get none`, () => {
      const parts = stubParts(s.units)
      const pageTextIndex = new Map<number, string>()
      for (const p of ex.pages) if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
      const inputs = collectTopicInputs(parts, s.units, new Map(), s.tocPages)
      const topics = canonicalizeTopics(inputs, { pageTextIndex, maxTopics: 200, maxSubtopicsPerTopic: 12 })
      const off = s.printed.offset!
      let withLabels = 0
      for (const t of topics) {
        // exactly the pipeline's rule: labels only when EVERY page maps ≥1
        const labels = t.pages.map(p => p - off).filter(n => n >= 1).map(String)
        if (labels.length === t.pages.length && labels.length > 0) {
          withLabels++
          for (const l of labels) assert.ok(Number(l) >= 1, `non-positive label ${l} on ${t.name}`)
        }
        // if any page sits in the front matter (printed < 1), NO labels may be claimed
        const touchesFront = t.pages.some(p => p - off < 1)
        if (touchesFront) assert.equal(t.printedPages, undefined, `${t.name} claims printed labels despite front-matter pages`)
      }
      assert.ok(withLabels > 0, 'no topic received printed labels at all')
    })
  }
  console.log(`    kind=${s.kind} toc=${s.toc.length}${s.tocValidated ? '(validated)' : ''} headings=${s.headings.length} units=${s.units.length} offset=${s.printed.offset}`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
