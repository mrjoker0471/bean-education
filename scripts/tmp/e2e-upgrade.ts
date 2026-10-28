// E2E upgrade verification: different document structures through the REAL
// pipeline + 100-question generation + reanalysis idempotency.
//   1. lecture-notes.pdf  (no TOC, unnumbered headings)  → HEADING_GUIDED/UNSTRUCTURED
//   2. question-paper.pdf (marks + numbered MCQ lines)   → QUESTION_PAPER + small honest test
//   3. force re-analysis of the lecture-notes doc        → no duplicate records
//   4. count=100 generation on the real CUET bulletin    → honoured, audited, cleaned up
// Run: bun scripts/tmp/e2e-upgrade.ts
import { readFile, unlink } from 'node:fs/promises'

const BASE = 'http://localhost:3000'
const GUEST = 'e2e-upgrade-guest-001'
const CUET_DOC = 'cmvrqkgi90035sop51sf8d2lj' // READY bulletin from e2e-riishe-upload.ts

function log(...a: unknown[]) { console.log(...a) }
async function jfetch<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, init)
  let body: unknown = null
  try { body = await res.json() } catch { /* */ }
  return { status: res.status, body: body as T }
}
const post = (path: string, payload: unknown) =>
  jfetch<any>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function evidenceOnPage(evidence: string, pageText: string): boolean {
  const ev = norm(evidence)
  if (ev.length < 12) return false
  const hay = norm(pageText)
  if (hay.includes(ev)) return true
  const words = ev.split(' ')
  if (words.length >= 4) {
    const half = Math.floor(words.length / 2)
    return hay.includes(words.slice(0, half).join(' ')) || hay.includes(words.slice(half).join(' '))
  }
  return false
}

let failures = 0
function assertOk(cond: unknown, label: string, extra?: string) {
  if (cond) { log(`  ✓ ${label}`); return true }
  failures++
  log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`)
  return false
}

async function uploadDoc(path: string, name: string, title: string): Promise<string | null> {
  const buf = await readFile(path)
  const form = new FormData()
  form.set('guestId', GUEST)
  form.set('file', new File([buf], name, { type: 'application/pdf' }))
  form.set('title', title)
  const up = await jfetch<{ documentId?: string; error?: string }>('/api/materials', { method: 'POST', body: form })
  if (up.status !== 200 || !up.body.documentId) { log(`  upload failed:`, up.status, up.body); return null }
  return up.body.documentId
}

async function pollReady(docId: string, maxPolls = 60): Promise<any> {
  for (let i = 0; i < maxPolls; i++) {
    await sleep(4000)
    const d = await jfetch<any>(`/api/materials/${docId}?guestId=${GUEST}`)
    if (['READY', 'FAILED', 'NEEDS_OCR'].includes(d.body.status)) return d.body
    if (i % 5 === 4) log(`  poll ${i + 1}: ${d.body.status} — ${(d.body.statusDetail ?? '').slice(0, 90)}`)
  }
  return null
}

async function main() {
  const created: string[] = []
  let notesDocId: string | null = null
  let qpDocId: string | null = null

  try {
    // ── 1. lecture-notes.pdf — document WITHOUT a table of contents ──
    log('── 1. lecture-notes.pdf (no TOC, unnumbered headings) ──')
    notesDocId = await uploadDoc('/tmp/riishe-test-docs/lecture-notes.pdf', 'lecture-notes.pdf', 'E2E Lecture Notes (no TOC)')
    if (!notesDocId) throw new Error('upload failed')
    created.push(notesDocId)
    const notes = await pollReady(notesDocId)
    assertOk(notes?.status === 'READY', 'analysis reaches READY', notes?.statusDetail)
    const nk = notes?.analysis?.structure?.kind
    assertOk(['HEADING_GUIDED', 'UNSTRUCTURED'].includes(nk), `structure kind is ${nk} (never a fake TOC)`)
    assertOk(notes?.analysis?.structure?.tocValidated === false, 'tocValidated=false (no TOC invented)')
    const nTopics = notes?.analysis?.topics ?? []
    assertOk(nTopics.length >= 2, `topics discovered: ${nTopics.length}`)
    const origins = new Set(nTopics.map((t: any) => t.origin))
    assertOk(origins.size >= 1, `origin layers present: ${[...origins].join(',')}`)
    // page refs in bounds
    const nPages = notes?.coverage?.totalPages ?? 0
    const badPages = nTopics.filter((t: any) => (t.pages ?? []).some((p: number) => p < 1 || p > nPages))
    assertOk(badPages.length === 0, `all topic pages within 1..${nPages}`, JSON.stringify(badPages.slice(0, 2)))

    // ── 2. question-paper.pdf — QUESTION_PAPER structure ──
    log('\n── 2. question-paper.pdf (marks instructions + numbered MCQ lines) ──')
    qpDocId = await uploadDoc('/tmp/riishe-test-docs/question-paper.pdf', 'question-paper.pdf', 'E2E Question Paper')
    if (!qpDocId) throw new Error('upload failed')
    created.push(qpDocId)
    const qp = await pollReady(qpDocId)
    assertOk(qp?.status === 'READY', 'analysis reaches READY', qp?.statusDetail)
    assertOk(qp?.analysis?.structure?.kind === 'QUESTION_PAPER', `structure kind = ${qp?.analysis?.structure?.kind}`)
    // small generation from the question paper (style-informed, content-grounded)
    const genSmall = await post('/api/riishe/generate', { guestId: GUEST, documentId: qpDocId, count: 8, timed: false, scoring: { marksPerQuestion: 1, negativeMark: 0 } })
    assertOk(genSmall.status === 200 && genSmall.body.testId, 'small generation accepted', JSON.stringify(genSmall.body))
    if (genSmall.body?.testId) {
      created.push(genSmall.body.testId)
      let smallTest: any = null
      for (let i = 0; i < 40; i++) {
        await sleep(4000)
        const t = await jfetch<any>(`/api/riishe/tests/${genSmall.body.testId}?guestId=${GUEST}`)
        if (['READY', 'FAILED'].includes(t.body.status)) { smallTest = t.body; break }
      }
      assertOk(smallTest?.status === 'READY', `small test READY with ${smallTest?.questionCount ?? 0} questions`, smallTest?.statusDetail)
    }

    // ── 3. force re-analysis — idempotency / no duplicate records ──
    log('\n── 3. force re-analysis of the lecture-notes document ──')
    const beforeNames = nTopics.map((t: any) => `${t.origin}:${norm(t.name)}:${t.pages?.[0] ?? ''}`).sort()
    const retry = await post(`/api/materials/${notesDocId}/retry`, { guestId: GUEST, force: true })
    assertOk(retry.status === 200, `retry accepted (${retry.status})`, JSON.stringify(retry.body))
    const reanalysed = await pollReady(notesDocId, 90)
    assertOk(reanalysed?.status === 'READY', 're-analysis reaches READY', reanalysed?.statusDetail)
    const reTopics = reanalysed?.analysis?.topics ?? []
    // duplicate record check: same origin + name + first page must appear once
    const seen = new Set<string>()
    let dupRecords = 0
    for (const t of reTopics) {
      const k = `${t.origin}:${norm(t.name)}:${t.pages?.[0] ?? ''}`
      if (seen.has(k)) dupRecords++
      seen.add(k)
    }
    assertOk(dupRecords === 0, `no duplicate (origin,name,page) records across ${reTopics.length} topics`, `dups=${dupRecords}`)
    log(`  topics before=${nTopics.length} after=${reTopics.length} (provider wording may vary; record-level idempotency is the assertion)`)

    // ── 4. count=100 generation on the real bulletin ──
    log('\n── 4. 100-question generation on the CUET bulletin ──')
    const gen100 = await post('/api/riishe/generate', { guestId: GUEST, documentId: CUET_DOC, count: 100, timed: false, scoring: { marksPerQuestion: 1, negativeMark: 0 } })
    assertOk(gen100.status === 200 && gen100.body.testId, 'count=100 accepted by the API (was 400 before the fix)', JSON.stringify(gen100.body))
    if (!gen100.body?.testId) throw new Error('100-count generation rejected')
    created.push(gen100.body.testId)
    let big: any = null
    for (let i = 0; i < 150; i++) {
      await sleep(4000)
      const t = await jfetch<any>(`/api/riishe/tests/${gen100.body.testId}?guestId=${GUEST}`)
      if (['READY', 'FAILED'].includes(t.body.status)) { big = t.body; break }
      if (i % 10 === 9) log(`  poll ${i + 1}: ${t.body.status} — ${(t.body.statusDetail ?? '').slice(0, 80)}`)
    }
    log(`  final status: ${big?.status} — ${(big?.statusDetail ?? '').slice(0, 140)}`)
    if (big?.status === 'READY') {
      // Audit from the DB — the pre-start API feed intentionally omits answers,
      // pageRefs and evidence (answer-key protection).
      const { Database } = await import('bun:sqlite')
      const rdb = new Database('/home/z/my-project/db/custom.db', { readonly: true })
      const rows = rdb.query('SELECT id, text, pageRefsJson, evidence, category FROM RiisheQuestion WHERE testId = ? ORDER BY "order"').all(gen100.body.testId) as any[]
      rdb.close()
      const qs = rows
      log(`  published: ${qs.length} of requested 100`)
      assertOk(big.questionCount === qs.length, 'questionCount matches rows')
      assertOk(qs.length > 50, `published ${qs.length} > 50 (the old hard cap) — provider throughput permitting`)
      assertOk(qs.length <= 100, 'never padded beyond the request')
      // grounding audit against the stored extraction
      const st = await jfetch<any>(`/api/materials/${CUET_DOC}?guestId=${GUEST}`)
      const pages: { page: number; text: string }[] = JSON.parse(st.body.extractionJson ?? '[]')
      const pageText = new Map(pages.map(p => [p.page, p.text] as const))
      let inBounds = 0, evidenceOk = 0, dupStems = 0
      const stems: string[] = []
      for (const q of qs) {
        const refs: number[] = JSON.parse(q.pageRefsJson ?? '[]')
        if (refs.length > 0 && refs.every((p: number) => p >= 1 && p <= pages.length)) inBounds++
        const citedText = refs.map((p: number) => pageText.get(p) ?? '').join('\n')
        if (q.evidence && evidenceOnPage(q.evidence, citedText)) evidenceOk++
        stems.push(norm(q.text).slice(0, 140))
      }
      const uniq = new Set(stems)
      dupStems = stems.length - uniq.size
      assertOk(inBounds === qs.length, `page refs in document bounds: ${inBounds}/${qs.length}`)
      assertOk(evidenceOk >= Math.floor(qs.length * 0.95), `evidence verbatim on a cited page: ${evidenceOk}/${qs.length} (≥95%)`)
      assertOk(dupStems === 0, `duplicate stems: ${dupStems}`)
      const cats: Record<string, number> = {}
      for (const q of qs) cats[q.category] = (cats[q.category] ?? 0) + 1
      log(`  category mix: ${JSON.stringify(cats)}`)
    } else {
      // honest failure is acceptable ONLY with the truthful rate-limit note
      const throttled = /rate-limit/i.test(big?.statusDetail ?? '')
      assertOk(throttled, 'if not READY, the failure is the honest provider-throttle note', big?.statusDetail)
    }
  } finally {
    // ── cleanup: remove every record this run created ──
    log('\n── cleanup ──')
    const { Database } = await import('bun:sqlite')
    const wdb = new Database('/home/z/my-project/db/custom.db')
    for (const testId of created.filter(id => id.length > 0)) {
      const qids = (wdb.query('SELECT id FROM RiisheQuestion WHERE testId = ?').all(testId) as { id: string }[]).map(r => r.id)
      const docIds = (wdb.query('SELECT DISTINCT documentId FROM RiisheQuestion WHERE testId = ?').all(testId) as { documentId: string }[]).map(r => r.documentId)
      if (qids.length > 0) {
        wdb.run(`DELETE FROM RiisheExplanation WHERE questionId IN (${qids.map(() => '?').join(',')})`, ...qids)
        wdb.run(`DELETE FROM RiisheChatTurn WHERE questionId IN (${qids.map(() => '?').join(',')})`, ...qids)
      }
      for (const d of docIds) {
        wdb.run('DELETE FROM Attempt WHERE source = ? AND documentId = ?', 'RIISHE', d)
      }
      wdb.run('DELETE FROM RiisheQuestion WHERE testId = ?', testId)
      wdb.run('DELETE FROM RiisheTest WHERE id = ?', testId)
    }
    for (const docId of [notesDocId, qpDocId].filter((id): id is string => !!id)) {
      await jfetch(`/api/materials/${docId}?guestId=${GUEST}`, { method: 'DELETE' }).catch(() => {})
    }
    wdb.close()
    log(`removed ${created.length} tests + docs where possible`)
  }

  log(failures === 0 ? '\nUPGRADE E2E: ALL PASS' : `\nUPGRADE E2E: ${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
