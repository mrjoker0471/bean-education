// E2E pipeline driver: upload → analyse → generate 50 → start → answer → submit
// → explanations → weak topics. Uses the real running dev server on :3000.
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const GUEST = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

async function j(url, opts) {
  const res = await fetch(BASE + url, opts)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

function log(label, obj, max = 300) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj)
  console.log(`\n== ${label} ==`)
  console.log(s.length > max ? s.slice(0, max) + ' …' : s)
}

async function uploadFile(name, path) {
  const buf = readFileSync(path)
  const form = new FormData()
  form.set('guestId', GUEST)
  form.set('file', new File([buf], name, { type: 'application/pdf' }))
  const res = await fetch(`${BASE}/api/materials`, { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function waitDoc(id, targetStatuses, timeoutMs = 420_000) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeoutMs) {
    const { status, body } = await j(`/api/materials/${id}?guestId=${GUEST}`)
    if (status !== 200) return { status, body }
    last = body
    if (targetStatuses.includes(body.status)) return { status, body }
    await new Promise(r => setTimeout(r, 3000))
  }
  return { status: 0, body: last, timeout: true }
}

async function waitTest(id, timeoutMs = 600_000) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeoutMs) {
    const { status, body } = await j(`/api/riishe/tests/${id}?guestId=${GUEST}`)
    if (status !== 200) return { status, body }
    last = body
    if (body.status === 'READY' || body.status === 'FAILED') return { status, body }
    await new Promise(r => setTimeout(r, 5000))
  }
  return { status: 0, body: last, timeout: true }
}

// ══ 1. Upload valid rich PDF ══
console.log('GUEST:', GUEST)
const up = await uploadFile('indian-polity-companion.pdf', '/tmp/riishe-tests/rich.pdf')
log('upload rich', up)
if (up.status !== 200) process.exit(1)
const docId = up.body.documentId

const done = await waitDoc(docId, ['READY', 'NEEDS_OCR', 'FAILED'])
log('processing final status', { status: done.body.status, detail: done.body.statusDetail, pages: done.body.pageCount })
if (done.body.status !== 'READY') {
  console.log('RICH DOC DID NOT BECOME READY — aborting generation test')
  process.exit(1)
}
const a = done.body.analysis
log('analysis summary', { title: a?.title, summary: a?.summary, topics: a?.topics.map(t => `${t.name} (pages ${t.pages.join(',')})`) }, 900)
log('analysis extras', {
  definitions: a?.definitions.slice(0, 4),
  keyFacts: a?.keyFacts.slice(0, 4),
  formulas: a?.formulas,
  misconceptions: a?.misconceptions.slice(0, 3),
  coverageNote: a?.coverageNote,
  studyGaps: a?.studyGaps,
  unreadable: a?.unreadableSections,
}, 900)

// ══ 2. Generate 50-question test (timed) ══
const gen = await j('/api/riishe/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST, documentId: docId, timed: true }),
})
log('generate', gen)
if (gen.status !== 200) process.exit(1)
const testId = gen.body.testId

const genDone = await waitTest(testId)
log('generation final', {
  status: genDone.body.status,
  detail: genDone.body.statusDetail,
  questionCount: genDone.body.questionCount,
  stats: genDone.body.stats,
}, 700)
if (genDone.body.status !== 'READY') process.exit(1)

const qs = genDone.body.questions
log('sample questions', qs.slice(0, 3).map(q => ({ n: q.order, cat: q.category, topic: q.topic, text: q.text.slice(0, 100) })), 900)

// Idempotency: second generate while READY → new test allowed; while in-flight → dedupe (skip here)

// ══ 3. Start attempt, answer, submit ══
const start = await j(`/api/riishe/tests/${testId}/start`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST }),
})
log('start attempt', start)
const attemptId = start.body.attemptId

const state = await j(`/api/attempts/${attemptId}?guestId=${GUEST}`)
log('attempt state', {
  title: state.body.title, examLabel: state.body.examLabel, source: state.body.source,
  config: state.body.config, qCount: state.body.questions?.length,
  savedAnswers: state.body.savedAnswers,
  q0: state.body.questions?.[0]?.text?.slice(0, 80),
}, 500)

// Answer: first 12 questions, deliberately mixed correctness (we don't know the key — server decides)
const answers = {}
state.body.questions.slice(0, 12).forEach((q, i) => { answers[q.id] = i % 4 })
// autosave
const asv = await j(`/api/attempts/${attemptId}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST, answers }),
})
log('autosave', asv)

// verify resume: fresh GET returns savedAnswers
const state2 = await j(`/api/attempts/${attemptId}?guestId=${GUEST}`)
log('resume check', { savedCount: Object.keys(state2.body.savedAnswers).length })

const submit = await j(`/api/attempts/${attemptId}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST, answers, timeSpentSec: 480 }),
})
log('submit', submit)

const result = await j(`/api/attempts/${attemptId}/result?guestId=${GUEST}`)
log('result', {
  source: result.body.source, score: result.body.score, max: result.body.maxScore,
  correct: result.body.correctCount, wrong: result.body.wrongCount, skipped: result.body.skippedCount,
  perTopic: result.body.perTopic,
  q0: { cat: result.body.questions[0]?.category, pageRefs: result.body.questions[0]?.pageRefs, evidence: result.body.questions[0]?.evidence?.slice(0, 80) },
}, 900)

// ownership check: another guest must NOT see it
const stranger = await j(`/api/attempts/${attemptId}/result?guestId=not-the-owner-000000`)
log('stranger access (expect 404)', stranger.status)

// ══ 4. Explanations ══
const ex = await j(`/api/riishe/attempts/${attemptId}/explain`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST }),
})
log('explain request', ex)

let exp = null
for (let i = 0; i < 100; i++) {
  const r = await j(`/api/riishe/attempts/${attemptId}/explanations?guestId=${GUEST}`)
  exp = r.body
  if (r.status === 200 && exp.pending === 0) break
  await new Promise(res => setTimeout(res, 4000))
}
log('explanations final', {
  wrongCount: exp?.wrongCount, readyCount: exp?.readyCount, failedCount: exp?.failedCount, pending: exp?.pending,
}, 300)
const firstReady = Object.entries(exp?.explanations ?? {}).find(([, v]) => v.status === 'READY')
log('one explanation payload', firstReady?.[1]?.payload, 900)

// ══ 5. Weak topics ══
const weak = await j(`/api/riishe/weak-topics?guestId=${GUEST}`)
log('weak topics', weak.body, 600)

// ══ 6. Security: stranger's material list + file access ══
const sMat = await j(`/api/materials/${docId}?guestId=stranger-00000000`)
log('stranger material (expect 404)', sMat.status)
const sFile = await fetch(`${BASE}/api/materials/${docId}/file?guestId=stranger-00000000`)
log('stranger file (expect 404)', sFile.status)

console.log('\nPIPELINE E2E COMPLETE. docId=', docId, 'testId=', testId, 'attemptId=', attemptId)
console.log('KEEP ids for browser tests: GUEST=' + GUEST)
