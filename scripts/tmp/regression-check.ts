// Regression: verify hierarchy, city-list recovery, formula verification,
// fact grounding and coverage accounting for the re-analysed CUET document.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
if (!doc) { console.error('doc missing'); process.exit(1) }
const a = JSON.parse(doc.analysisJson!)
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('══ 1. Hierarchy: 13 main chapters + 11 appendices, independently grouped ══')
const chapters = a.topics.filter((t: any) => t.origin === 'SOURCE_HEADING' && t.group === 'CHAPTER' && t.itemClass !== 'SOURCE_SUBSECTION')
const appendices = a.topics.filter((t: any) => t.origin === 'SOURCE_HEADING' && t.group === 'APPENDIX')
const chapterNums = chapters.map((t: any) => (t.numbering ?? '').match(/\d+/)?.[0]).filter(Boolean)
check('13 main chapters detected', chapters.length === 13, `got ${chapters.length}`)
check('chapters numbered 1..13 in order', JSON.stringify(chapterNums) === JSON.stringify(['1','2','3','4','5','6','7','8','9','10','11','12','13']), JSON.stringify(chapterNums))
check('chapters in source order (pages ascending)', chapters.every((t: any, i: number) => i === 0 || (t.pages[0] ?? 0) >= (chapters[i-1].pages[0] ?? 0)))
check('11 appendices detected', appendices.length === 11, `got ${appendices.length}`)
const romanOf = (s: string) => (s ?? '').match(/(?:IX|VIII|VII|VI|V|IV|III|II|XI|X|I)\b/)?.[0]
const appNums = appendices.map((t: any) => romanOf(t.numbering ?? '') ?? romanOf(t.name))
check('appendices numbered I..XI in order', JSON.stringify(appNums) === JSON.stringify(['I','II','III','IV','V','VI','VII','VIII','IX','X','XI']), JSON.stringify(appNums))
check('appendices NOT inside main-chapter group', appendices.every((t: any) => t.group === 'APPENDIX'))

console.log('══ 2. Section titles match the document index (spot checks vs contents rows) ══')
const expectedTitles = [
  ['Chapter-1', 'Introduction'],
  ['Chapter-2', 'Examination Scheme'],
  ['Chapter-3', 'Eligibility'],
  ['Chapter-4', 'Reservation'],
  ['Chapter-5', 'Choice Of Examination Cities'],
  ['Chapter-6', 'Admit Card'],
  ['Chapter-7', 'Schedule Of Examination'],
  ['Chapter-13', 'Miscellaneous'],
]
for (const [num, title] of expectedTitles) {
  const t = chapters.find((c: any) => (c.numbering ?? '').includes(num.replace('Chapter-', '')))
  check(`${num} title contains "${title}"`, !!t && t.name.toLowerCase().includes(title.toLowerCase()), t?.name)
}
const appIII = appendices.find((t: any) => (t.numbering ?? '').includes('III') || t.name.includes('III'))
check('Appendix III title mentions Examination Cities', !!appIII && /examination cities/i.test(appIII.name), appIII?.name)

console.log('══ 3. Page references: physical + printed, within 96, mapped ══')
const allPages = a.topics.flatMap((t: any) => t.pages)
check('no page reference outside 1..96', allPages.every((p: number) => p >= 1 && p <= 96))
check('every SOURCE_HEADING topic has pages', a.topics.filter((t: any) => t.origin === 'SOURCE_HEADING').every((t: any) => t.pages.length > 0))
const mapped = a.topics.filter((t: any) => t.origin === 'SOURCE_HEADING' && t.pageMapping === 'VERIFIED').length
const unmapped = a.topics.filter((t: any) => t.origin === 'SOURCE_HEADING' && t.pageMapping === 'UNRESOLVED').length
console.log(`  info: SOURCE_HEADING pageMapping — VERIFIED: ${mapped}, UNRESOLVED: ${unmapped}`)
const printedLabels = a.structure?.printedLabels ?? {}
check('printed page labels were read from page edges', Object.keys(printedLabels).length >= 80, `got ${Object.keys(printedLabels).length}`)

console.log('══ 4. Appendix III city list: deterministic recovery ══')
const listTopic = a.topics.find((t: any) => t.list)
if (!listTopic) {
  check('a topic carries the recovered reference list', false)
} else {
  const L = listTopic.list
  check('recovered list exists with header', !!L.header && /S\.No/i.test(L.header), L.header)
  check('entries > 150 across pages 40-43', L.totalEntries > 150, `got ${L.totalEntries}`)
  check('no unreadable rows', L.unreadableRows.length === 0, JSON.stringify(L.unreadableRows))
  check('no serial gaps', L.serialGaps.length === 0, JSON.stringify(L.serialGaps))
  const flat = L.groups.flatMap((g: any) => g.entries)
  check('entries are verbatim city (code) format', flat.every((e: string) => /\([A-Z]{2}\d{2}\)$/.test(e)), flat.find((e: string) => !/\([A-Z]{2}\d{2}\)$/.test(e)))
  check('source order preserved (Andaman first, codes ascending within state)', flat[0].includes('Port Blair') && flat[0].includes('AN01'), flat[0])
  check('geographical grouping present (state labels)', L.groups.filter((g: any) => g.label).length >= 20, `got ${L.groups.filter((g: any) => g.label).length}`)
  // cross-check first and last rows against the raw page text
  const pages = JSON.parse(doc.extractionJson!)
  const p40 = pages.find((p: any) => p.page === 40)
  check('first entry matches page 40 source row', p40.text.includes('Port Blair AN01'))
  const p43 = pages.find((p: any) => p.page === 43)
  const lastEntry = flat[flat.length - 1]
  const lastCode = lastEntry.match(/\((..)\)/)?.[1]
  check('last entry code appears on page 43', p43.text.includes(lastCode), `${lastEntry} vs p43`)
  // serial continuity across the FULL appendix (pages 40-47, incl. AI-analysed part)
  const allSerials = new Set<number>()
  for (const p of pages.filter((p: any) => p.page >= 40 && p.page <= 47)) {
    for (const m of p.text.matchAll(/^(\d{1,3})\s+[A-Z]/gm)) allSerials.add(Number(m[1]))
  }
  let maxSerial = 0, missing: number[] = []
  for (const s of allSerials) maxSerial = Math.max(maxSerial, s)
  for (let i = 1; i <= maxSerial; i++) if (!allSerials.has(i)) missing.push(i)
  check(`full appendix serial continuity (1..${maxSerial})`, missing.length === 0, `missing: ${missing.join(',')}`)
  console.log(`  info: full city list spans pages 40-47 with ${maxSerial} serialised rows; deterministic part covers pages 40-43 (${L.totalEntries} entries)`)
}

console.log('══ 5. Formulas: verbatim + verified + page refs ══')
check('formulas exist', a.formulas.length > 0, `got ${a.formulas.length}`)
for (const f of a.formulas) {
  console.log(`  formula [${f.status}] p${f.page}: ${f.text.slice(0, 90)}`)
}
check('every formula has a page or an explicit NEEDS_REVIEW flag', a.formulas.every((f: any) => (f.page != null && f.page >= 1) || f.status === 'NEEDS_REVIEW'))
check('verified formulas cite pages 1..96', a.formulas.filter((f: any) => f.status === 'VERIFIED').every((f: any) => f.page >= 1 && f.page <= 96))
const percentile = a.formulas.find((f: any) => /percentile/i.test(f.text))
check('percentile formula present and VERIFIED', !!percentile && percentile.status === 'VERIFIED', percentile ? `${percentile.status} p${percentile.page}` : 'missing')
const normScore = a.formulas.find((f: any) => /normali[sz]ed score/i.test(f.text) && /average/i.test(f.text))
console.log(`  info: verbatim Z formula present: ${!!normScore}${normScore ? ` [${normScore.status}] p${normScore.page}` : ''}`)
// verbatim check: source's own typo preserved
const zVerbatim = a.formulas.find((f: any) => f.text.includes('Average of'))
check('Z formula preserves the source\'s own wording/typos (u_A, u_C)', !!zVerbatim && zVerbatim.text.includes('u_C'))
const pages = JSON.parse(doc.extractionJson!)
for (const f of a.formulas.filter((x: any) => x.status === 'VERIFIED' && x.page)) {
  const pageText = (pages.find((p: any) => p.page === f.page)?.text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const toks = f.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t: string) => t.length >= 3)
  const hits = toks.filter((t: string) => pageText.includes(t)).length
  check(`formula tokens found on cited page ${f.page} (${hits}/${toks.length})`, toks.length === 0 || hits / toks.length >= 0.4)
}

console.log('══ 6. Key facts: page-grounded, verified, deduped ══')
const facts = a.keyFacts
check('facts exist', facts.length > 0, `got ${facts.length}`)
const verified = facts.filter((f: any) => f.status === 'VERIFIED')
const unverified = facts.filter((f: any) => f.status === 'UNVERIFIED')
console.log(`  info: facts — ${verified.length} verified, ${unverified.length} unverified, ${facts.filter((f: any) => f.kind === 'verbatim').length} verbatim, ${facts.filter((f: any) => f.kind === 'summary').length} summary`)
check('majority of facts verified against pages', verified.length / Math.max(1, facts.length) >= 0.6, `${verified.length}/${facts.length}`)
check('unverified facts are flagged with a note', unverified.every((f: any) => !!f.note))
check('every verified fact cites a page 1..96', verified.every((f: any) => f.page >= 1 && f.page <= 96))
// token-support re-check (independent of pipeline logic)
let supportFails = 0
for (const f of verified) {
  const pageText = (pages.find((p: any) => p.page === f.page)?.text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const toks = f.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t: string) => t.length >= 5)
  if (toks.length === 0) continue
  const hits = toks.filter((t: string) => pageText.includes(t)).length
  if (hits / toks.length < 0.3) { supportFails++; console.log(`  weak support p${f.page}: ${f.text.slice(0, 80)}`) }
}
check('independent token re-check supports verified facts', supportFails === 0, `${supportFails} weak`)
// duplicate check
const seen: string[] = []
let dups = 0
for (const f of facts) {
  const key = f.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w: string) => w.length > 3).sort().join(' ')
  if (seen.includes(key)) dups++
  else seen.push(key)
}
check('no duplicated facts (token-set exact)', dups === 0, `${dups} dups`)
// spot-check key factual claims against source pages
const factAbout = (re: RegExp) => facts.find((f: any) => re.test(f.text))
const spot = [
  ['13 mediums/languages claim', /13 mediums|13 Indian languages/i],
  ['37 subjects claim', /37/i],
  ['60 minutes duration', /60 minutes/i],
  ['-1 negative marking', /-1|−1/i],
]
for (const [label, re] of spot) {
  const f = factAbout(re)
  console.log(`  info spot-check ${label}: ${f ? `[${f.status}] p${f.page}` : 'NOT PRESENT'} — ${f?.text.slice(0, 80) ?? ''}`)
}

console.log('══ 7. Coverage: page accounting + honest status ══')
const cov = a.coverage
check('pageAccountingComplete flag present', typeof cov.pageAccountingComplete === 'boolean', String(cov.pageAccountingComplete))
const bucketSum = cov.analysedPages + cov.unanalysedPages + cov.skippedPages + (cov.contentlessPages ?? 0) + cov.scannedPages + (cov.failedExtractionPages ?? 0) + (cov.notExtractedPages ?? 0)
check('page buckets sum to total pages', bucketSum === cov.totalPages, `${bucketSum} vs ${cov.totalPages}`)
check('status is NOT "complete" while meaningful content is unanalysed', cov.complete === false, `complete=${cov.complete}`)
check('skipped pages listed exactly', Array.isArray(cov.skippedPageNumbers))
check('scanned pages listed exactly', cov.scannedPageNumbers?.length === cov.scannedPages, JSON.stringify(cov.scannedPageNumbers))
check('deterministic pages counted separately', (cov.deterministicPages ?? 0) > 0, String(cov.deterministicPages))
const detOutcomes = (a.sectionOutcomes ?? []).filter((o: any) => o.method === 'DETERMINISTIC')
check('deterministic unit recorded in outcomes with note', detOutcomes.length === 1 && !!detOutcomes[0].note, JSON.stringify(detOutcomes.map((o: any) => o.label)))
check('no SKIPPED outcomes remain (city list recovered)', (a.sectionOutcomes ?? []).every((o: any) => o.status !== 'SKIPPED'))
console.log(`  info: statusDetail — ${doc.statusDetail}`)
console.log(`  info: coverageNote — ${a.coverageNote}`)

console.log('══ 8. Study notes / gaps disclosure ══')
check('studyGaps mention OCR pages', a.studyGaps.some((g: string) => /OCR/i.test(g)))
check('studyGaps mention image-content pages', a.studyGaps.some((g: string) => /image/i.test(g)))
const imageContent = a.structure?.imageContentPages ?? []
check('image-content pages have evidence list', imageContent.length === 23, `got ${imageContent.length}: ${JSON.stringify(imageContent)}`)
const nonContent = a.structure?.nonContentPages ?? []
console.log(`  info: non-content (verified blank/decorative): ${JSON.stringify(nonContent)}`)

console.log('══ 9. Topic dedupe / no duplicates ══')
const topicKeys = new Set<string>()
let dupTopics = 0
for (const t of a.topics) {
  const key = `${t.origin}|${t.name.toLowerCase()}|${t.pages[0] ?? 0}`
  if (topicKeys.has(key)) dupTopics++
  topicKeys.add(key)
}
check('no duplicate topics (origin+name+first page)', dupTopics === 0, `${dupTopics} dups`)

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`)
await db.$disconnect()
process.exit(fail > 0 ? 1 : 0)
