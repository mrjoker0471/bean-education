// Parts 1-3 of e2e-upgrade: fixture docs (no-TOC notes + question paper) + small
// generation + force re-analysis idempotency. Cleanup of part-4 leftovers is separate.
import { readFile } from 'node:fs/promises'

const BASE = 'http://localhost:3000'
const GUEST = 'e2e-upgrade-guest-001'
function log(...a: unknown[]) { console.log(...a) }
async function jfetch<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, init)
  let body: unknown = null
  try { body = await res.json() } catch { }
  return { status: res.status, body: body as T }
}
const post = (path: string, payload: unknown) =>
  jfetch<any>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

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
  // ── 1. lecture-notes.pdf — document WITHOUT a table of contents ──
  log('── 1. lecture-notes.pdf (no TOC, unnumbered headings) ──')
  const notesDocId = await uploadDoc('/tmp/riishe-test-docs/lecture-notes.pdf', 'lecture-notes.pdf', 'E2E Lecture Notes (no TOC)')
  if (!notesDocId) throw new Error('upload failed')
  const notes = await pollReady(notesDocId)
  assertOk(notes?.status === 'READY', 'analysis reaches READY', notes?.statusDetail)
  const nk = notes?.analysis?.structure?.kind
  assertOk(['HEADING_GUIDED', 'UNSTRUCTURED'].includes(nk), `structure kind is ${nk} (never a fake TOC)`)
  assertOk(notes?.analysis?.structure?.tocValidated === false, 'tocValidated=false (no TOC invented)')
  const nTopics = notes?.analysis?.topics ?? []
  assertOk(nTopics.length >= 2, `topics discovered: ${nTopics.length}`)
  const origins = new Set(nTopics.map((t: any) => t.origin))
  assertOk(origins.size >= 1, `origin layers present: ${[...origins].join(',')}`)
  const nPages = notes?.coverage?.totalPages ?? 0
  const badPages = nTopics.filter((t: any) => (t.pages ?? []).some((p: number) => p < 1 || p > nPages))
  assertOk(badPages.length === 0, `all topic pages within 1..${nPages}`, JSON.stringify(badPages.slice(0, 2)))

  // ── 2. question-paper.pdf — QUESTION_PAPER structure ──
  log('\n── 2. question-paper.pdf (marks instructions + numbered MCQ lines) ──')
  const qpDocId = await uploadDoc('/tmp/riishe-test-docs/question-paper.pdf', 'question-paper.pdf', 'E2E Question Paper')
  if (!qpDocId) throw new Error('upload failed')
  const qp = await pollReady(qpDocId)
  assertOk(qp?.status === 'READY', 'analysis reaches READY', qp?.statusDetail)
  assertOk(qp?.analysis?.structure?.kind === 'QUESTION_PAPER', `structure kind = ${qp?.analysis?.structure?.kind}`)
  const genSmall = await post('/api/riishe/generate', { guestId: GUEST, documentId: qpDocId, count: 8, timed: false, scoring: { marksPerQuestion: 1, negativeMark: 0 } })
  assertOk(genSmall.status === 200 && genSmall.body.testId, 'small generation accepted', JSON.stringify(genSmall.body))
  if (genSmall.body?.testId) {
    let smallTest: any = null
    for (let i = 0; i < 40; i++) {
      await sleep(4000)
      const t = await jfetch<any>(`/api/riishe/tests/${genSmall.body.testId}?guestId=${GUEST}`)
      if (['READY', 'FAILED'].includes(t.body.status)) { smallTest = t.body; break }
    }
    assertOk(smallTest?.status === 'READY', `small test READY with ${smallTest?.questionCount ?? 0} questions`, smallTest?.statusDetail)
    // answer-key protection on the pre-start feed
    const leaked = (smallTest?.questions ?? []).some((q: any) => 'correctIndex' in q || 'explanation' in q)
    assertOk(!leaked, 'pre-start feed leaks no answers/explanations')
  }

  // ── 3. force re-analysis — idempotency / no duplicate records ──
  log('\n── 3. force re-analysis of the lecture-notes document ──')
  const beforeNames = nTopics.map((t: any) => `${t.origin}:${norm(t.name)}:${t.pages?.[0] ?? ''}`).sort()
  const retry = await post(`/api/materials/${notesDocId}/retry`, { guestId: GUEST, force: true })
  assertOk(retry.status === 200, `retry accepted (${retry.status})`, JSON.stringify(retry.body))
  const reanalysed = await pollReady(notesDocId, 90)
  assertOk(reanalysed?.status === 'READY', 're-analysis reaches READY', reanalysed?.statusDetail)
  const reTopics = reanalysed?.analysis?.topics ?? []
  const seen = new Set<string>()
  let dupRecords = 0
  for (const t of reTopics) {
    const k = `${t.origin}:${norm(t.name)}:${t.pages?.[0] ?? ''}`
    if (seen.has(k)) dupRecords++
    seen.add(k)
  }
  assertOk(dupRecords === 0, `no duplicate (origin,name,page) records across ${reTopics.length} topics`, `dups=${dupRecords}`)
  log(`  topics before=${nTopics.length} after=${reTopics.length} (provider wording may vary; record-level idempotency is the assertion)`)

  log(`\nPARTS 1-3: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — docIds notes=${notesDocId} qp=${qpDocId}`)
}

main().catch(e => { console.error(e); process.exit(1) })
