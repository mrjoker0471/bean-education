// Round 2: answer ALL questions of the existing READY test → explanations for
// many wrong answers → weak topics must populate.
const BASE = 'http://localhost:3000'
const GUEST = process.argv[2]
const TEST_ID = process.argv[3]

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

const start = await j(`/api/riishe/tests/${TEST_ID}/start`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST }),
})
log('start attempt 2', start)
const attemptId = start.body.attemptId

const state = await j(`/api/attempts/${attemptId}?guestId=${GUEST}`)
const answers = {}
// Deterministic wrong-heavy pattern: answer every question, most wrong
state.body.questions.forEach((q, i) => { answers[q.id] = (i + 1) % 4 })
const submit = await j(`/api/attempts/${attemptId}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST, answers, timeSpentSec: 1800 }),
})
log('submit', submit)

const result = await j(`/api/attempts/${attemptId}/result?guestId=${GUEST}`)
log('result', { score: result.body.score, correct: result.body.correctCount, wrong: result.body.wrongCount, skipped: result.body.skippedCount })

const ex = await j(`/api/riishe/attempts/${attemptId}/explain`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST }),
})
log('explain request', ex)

let exp = null
for (let i = 0; i < 120; i++) {
  const r = await j(`/api/riishe/attempts/${attemptId}/explanations?guestId=${GUEST}`)
  exp = r.body
  if (r.status === 200 && exp.pending === 0) break
  await new Promise(res => setTimeout(res, 5000))
}
log('explanations final', { wrong: exp?.wrongCount, ready: exp?.readyCount, failed: exp?.failedCount, pending: exp?.pending })

const weak = await j(`/api/riishe/weak-topics?guestId=${GUEST}`)
log('weak topics now', weak.body, 800)

console.log('\nROUND2 COMPLETE. attemptId=', attemptId)
