// Edge cases: scanned PDF → NEEDS_OCR; broken file → 415; small PDF → analysis READY
// but honest limited generation; duplicate upload idempotency.
import { readFileSync } from 'node:fs'
const BASE = 'http://localhost:3000'
const GUEST = process.argv[2]

async function j(url, opts) {
  const res = await fetch(BASE + url, opts)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
function log(l, o, max = 260) {
  const s = typeof o === 'string' ? o : JSON.stringify(o)
  console.log(`\n== ${l} ==\n` + (s.length > max ? s.slice(0, max) + ' …' : s))
}
async function upload(name, path, type = 'application/pdf') {
  const form = new FormData()
  form.set('guestId', GUEST)
  form.set('file', new File([readFileSync(path)], name, { type }))
  const res = await fetch(`${BASE}/api/materials`, { method: 'POST', body: form })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function waitDoc(id, statuses, timeoutMs = 300_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await j(`/api/materials/${id}?guestId=${GUEST}`)
    if (r.status === 200 && statuses.includes(r.body.status)) return r.body
    await new Promise(res => setTimeout(res, 3000))
  }
  return { status: 'timeout' }
}

// ── 1. broken file ──
const broken = await upload('broken.pdf', '/tmp/riishe-tests/broken.pdf')
log('upload broken (expect 415)', broken.status)

// ── 2. scanned PDF ──
const sc = await upload('scanned-notes.pdf', '/tmp/riishe-tests/scanned.pdf')
log('upload scanned', sc)
if (sc.status === 200) {
  const d = await waitDoc(sc.body.documentId, ['NEEDS_OCR', 'READY', 'FAILED'])
  log('scanned final', { status: d.status, detail: d.statusDetail, pages: d.pageCount })
  const gen = await j('/api/riishe/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST, documentId: sc.body.documentId }),
  })
  log('generate on scanned (expect 409)', gen.status, gen.body?.error)
  const retry = await j(`/api/materials/${sc.body.documentId}/retry`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST }),
  })
  log('retry on NEEDS_OCR (expect 409)', retry.status, retry.body?.error)
}

// ── 3. small (thin) PDF: analysis OK, generation honest ──
const sm = await upload('small-note.pdf', '/tmp/riishe-tests/small.pdf')
log('upload small', sm)
if (sm.status === 200) {
  const d = await waitDoc(sm.body.documentId, ['READY', 'NEEDS_OCR', 'FAILED'])
  log('small final', { status: d.status, detail: d.statusDetail, topics: d.analysis?.topics?.map(t => t.name) })
  const gen = await j('/api/riishe/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST, documentId: sm.body.documentId, count: 20 }),
  })
  log('generate small (20 requested)', gen)
  if (gen.status === 200) {
    const t0 = Date.now()
    let test = null
    while (Date.now() - t0 < 420_000) {
      const r = await j(`/api/riishe/tests/${gen.body.testId}?guestId=${GUEST}`)
      test = r.body
      if (['READY', 'FAILED'].includes(test.status)) break
      await new Promise(res => setTimeout(res, 5000))
    }
    log('small generation final', { status: test?.status, detail: test?.statusDetail, count: test?.questionCount, stats: test?.stats })
  }
}

// ── 4. duplicate upload idempotency ──
const dup = await upload('indian-polity-companion.pdf', '/tmp/riishe-tests/rich.pdf')
log('duplicate upload (expect same doc, duplicate:true)', dup.body)

console.log('\nEDGE CASES COMPLETE')
