// E2E part 1: upload the real 96-page CUET UG 2026 bulletin, wait for READY,
// and verify processing coverage + chapter boundaries + pattern facts against
// the document itself. Run: bun scripts/e2e-riishe-upload.ts
import { Database } from 'bun:sqlite'
import { readFile } from 'node:fs/promises'

const BASE = 'http://localhost:3000'
const GUEST = 'e2e-upgrade-guest-001'
const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })

function log(...a: unknown[]) { console.log(...a) }
async function jfetch<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, init)
  let body: unknown = null
  try { body = await res.json() } catch { /* */ }
  return { status: res.status, body: body as T }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  // ── 1. Upload the real bulletin ──
  const buf = await readFile('/home/z/my-project/upload/CUET-UG-2026-Information-Bulletin.pdf')
  const form = new FormData()
  form.set('guestId', GUEST)
  form.set('file', new File([buf], 'CUET-UG-2026-Information-Bulletin.pdf', { type: 'application/pdf' }))
  form.set('title', 'CUET UG 2026 Information Bulletin')

  log('── Uploading 96-page CUET UG bulletin …')
  const up = await jfetch<{ documentId?: string; duplicate?: boolean; error?: string }>('/api/materials', { method: 'POST', body: form })
  if (up.status !== 200 || !up.body.documentId) {
    log('UPLOAD FAILED', up.status, up.body); process.exit(1)
  }
  log(`upload ok: documentId=${up.body.documentId} duplicate=${!!up.body.duplicate}`)
  const docId = up.body.documentId

  // ── 2. Poll to READY ──
  let detail: any = null
  for (let i = 0; i < 120; i++) {
    await sleep(5000)
    const d = await jfetch<any>(`/api/materials/${docId}?guestId=${GUEST}`)
    detail = d.body
    log(`  poll ${i + 1}: status=${detail.status} detail=${(detail.statusDetail ?? '').slice(0, 110)}`)
    if (['READY', 'FAILED', 'NEEDS_OCR'].includes(detail.status)) break
  }
  if (detail?.status !== 'READY') {
    log('NOT READY — final status:', detail?.status, detail?.statusDetail)
    process.exit(1)
  }

  // ── 3. Verify coverage honesty ──
  const cov = detail.coverage
  log('\n── COVERAGE ──')
  log(JSON.stringify(cov, null, 2))
  log('analysisState:', detail.analysisState)

  // Cross-check against ground truth (pdf.js, direct)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise
  const truthPages = pdf.numPages
  let truthNoText = 0
  for (let p = 1; p <= truthPages; p++) {
    const t = (await (await pdf.getPage(p)).getTextContent()).items.map(i => (i as any).str ?? '').join(' ').replace(/\s+/g, ' ').trim()
    if (t.length < 32) truthNoText++
  }
  log(`\nTRUTH: numPages=${truthPages} pagesUnder32Chars=${truthNoText}`)
  const covOk =
    cov.totalPages === truthPages &&
    cov.extractedPages === truthPages - truthNoText &&
    cov.noTextPages === truthNoText
  log(`COVERAGE HONESTY: ${covOk ? 'MATCHES ground truth ✓' : 'MISMATCH ✗'}`)

  // ── 4. Verify chapter boundaries from the analysis topics ──
  log('\n── CHAPTER BOUNDARIES (analysis topics) ──')
  const topics = detail.analysis.topics
  for (const t of topics) log(`  ${t.name}: pages ${t.pages.slice(0, 12).join(',')}${t.pages.length > 12 ? '…' : ''}`)
  const findTopic = (kw: string) => topics.find((t: any) => t.name.toLowerCase().includes(kw.toLowerCase()))
  const checks: [string, string, number[], (pages: number[]) => boolean][] = [
    ['Introduction', 'introduction', [14, 15], (pages) => pages.some((p) => p === 14 || p === 15)],
    ['Examination Scheme', 'examination scheme', [16], (pages) => pages.includes(16)],
    ['Eligibility', 'eligibility', [17, 18], (pages) => pages.includes(17) || pages.includes(18)],
    ['Reservation', 'reservation', [19, 20, 21], (pages) => pages.some((p) => [19, 20, 21].includes(p))],
  ]
  let boundaryPass = 0
  for (const [label, kw, , pageCheck] of checks) {
    const t = findTopic(kw)
    const ok = !!t && pageCheck(t.pages)
    log(`  ${label}: ${ok ? '✓' : '✗'} ${t ? `topic pages [${t.pages.join(',')}]` : 'topic missing'}`)
    if (ok) boundaryPass++
  }

  // ── 5. Verify the extraction actually contains the pattern facts on page 16 ──
  log('\n── PATTERN FACTS (extraction, physical page 16 = printed 15) ──')
  const extraction = JSON.parse(
    db.query('SELECT extractionJson FROM StudyDocument WHERE id = ?').get(docId)!.extractionJson,
  ) as { page: number; text: string; chars: number }[]
  const p16 = extraction.find((p) => p.page === 16)
  const factChecks: [string, RegExp][] = [
    ['50 compulsory MCQs', /50 questions for each test papers/i],
    ['all compulsory', /All Question are compulsory/i],
    ['60-minute duration', /60\*{0,2}\s*minutes/i],
    ['+5 marks correct', /Correct Answer:\s*05 marks/i],
    ['−1 mark incorrect', /negative marking for each incorrect answer of 01 \(one\) mark/i],
  ]
  let factPass = 0
  for (const [label, re] of factChecks) {
    const ok = !!p16 && re.test(p16.text)
    log(`  ${label}: ${ok ? '✓ present on page 16' : '✗ MISSING'}`)
    if (ok) factPass++
  }

  // keyFacts mention of marking scheme (AI-derived, informational)
  const markingFact = detail.analysis.keyFacts.find((f: string) => /05 marks|negative marking|\+5|−1|five marks/i.test(f))
  log(`  AI keyFacts referencing marking scheme: ${markingFact ? '✓ ' + markingFact.slice(0, 140) : '— none (extraction above is the ground truth)'}`)

  // ── 6. Verify printed-page offset detection ──
  log(`\nprintedPageOffset detected: ${cov.printedPageOffset} (expect 1 — printed N = physical N+1)`)
  const offsetOk = cov.printedPageOffset === 1

  // analysisState must be CONSISTENT with the measured coverage:
  // COMPLETE only when every readable page was analysed and nothing failed.
  const stateConsistent =
    (detail.analysisState === 'COMPLETE' && cov.analysedPages >= cov.readablePages && cov.failedPages === 0) ||
    (detail.analysisState === 'PARTIAL' && (cov.analysedPages < cov.readablePages || cov.failedPages > 0))
  log(`analysisState consistency: ${stateConsistent ? '✓' : '✗'} (${detail.analysisState})`)

  const pass = covOk && boundaryPass >= 3 && factPass === factChecks.length && offsetOk && stateConsistent
  log(`\nRESULT: coverage=${covOk ? 'PASS' : 'FAIL'} boundaries=${boundaryPass}/4 patternFacts=${factPass}/5 offset=${offsetOk ? 'PASS' : 'FAIL'} analysisState=${detail.analysisState}${stateConsistent ? '(consistent)' : '(INCONSISTENT)'} → ${pass ? 'OVERALL PASS' : 'OVERALL FAIL'}`)
  console.log(JSON.stringify({ docId, covOk, boundaryPass, factPass, offsetOk }, null, 0))
}

main().catch(e => { console.error(e); process.exit(1) })
