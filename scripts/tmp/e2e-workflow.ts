// Full learning-workflow E2E with minimal AI calls: reuse the READY 5-question
// test on the question-paper doc → start → deliberate attempt → server scoring
// → explanations → per-question follow-up chat.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
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
let failures = 0
const ok = (c: unknown, label: string, extra?: string) => { if (c) { log(`  ✓ ${label}`); return true } failures++; log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); return false }

async function main() {
  // 1. find the READY 5-question test on the question-paper doc
  const qpDoc = await db.studyDocument.findFirst({ where: { guestId: GUEST, deletedNote: undefined as never, title: 'E2E Question Paper' } })
  if (!qpDoc) throw new Error('qp doc gone')
  const test = await db.riisheTest.findFirst({ where: { documentId: qpDoc.id, status: 'READY' }, orderBy: { createdAt: 'desc' } })
  if (!test) throw new Error('no READY test on qp doc')
  const questions = await db.riisheQuestion.findMany({ where: { testId: test.id }, orderBy: { order: 'asc' } })
  log(`test ${test.id} — ${questions.length} questions`)
  ok(questions.length >= 4, `questions available: ${questions.length}`)

  // 2. start the test
  const start = await post(`/api/riishe/tests/${test.id}/start`, { guestId: GUEST })
  ok(start.status === 200 && start.body.attemptId, 'attempt started', JSON.stringify(start.body))
  const attemptId = start.body.attemptId as string

  // runner feed must not leak answers
  const runner = await jfetch<any>(`/api/attempts/${attemptId}?guestId=${GUEST}`)
  ok(runner.status === 200 && (runner.body.questions ?? []).every((q: any) => !('correctIndex' in q) && !('explanation' in q)), 'runner feed leaks no answers')

  // 3. deliberate answers: q1 correct, q2 wrong, q3 skipped, q4 correct, q5 wrong
  const answers: Record<string, number> = {}
  const plan: ('C' | 'W' | 'S')[] = ['C', 'W', 'S', 'C', 'W']
  const expected = { correct: 0, wrong: 0, skipped: 0 }
  questions.forEach((q, i) => {
    const p = plan[i] ?? 'W'
    if (p === 'C') { answers[q.id] = q.correctIndex; expected.correct++ }
    else if (p === 'W') { answers[q.id] = (q.correctIndex + 1) % 4; expected.wrong++ }
    else expected.skipped++
  })

  // 4. submit — server-authoritative scoring (marksPerQuestion=1, negativeMark=0)
  const cfg = JSON.parse(test.configJson!) as { marksPerQuestion: number; negativeMark: number; timed: boolean }
  const submit = await post(`/api/attempts/${attemptId}`, { guestId: GUEST, answers, timeSpentSec: 120 })
  ok(submit.status === 200, 'submit accepted', JSON.stringify(submit.body))
  const expScore = expected.correct * cfg.marksPerQuestion - expected.wrong * cfg.negativeMark
  ok(submit.body.score === expScore, `server score ${submit.body.score} === expected ${expScore} (+${cfg.marksPerQuestion}/−${cfg.negativeMark})`, `got ${submit.body.score}`)
  ok(submit.body.correctCount === expected.correct && submit.body.wrongCount === expected.wrong && submit.body.skippedCount === expected.skipped,
    `counts C/W/S = ${submit.body.correctCount}/${submit.body.wrongCount}/${submit.body.skippedCount} (expected ${expected.correct}/${expected.wrong}/${expected.skipped})`)

  // idempotent duplicate submit
  const submit2 = await post(`/api/attempts/${attemptId}`, { guestId: GUEST, answers, timeSpentSec: 125 })
  ok(submit2.status === 200 && submit2.body.score === expScore, 'duplicate submit idempotent', JSON.stringify(submit2.body))

  // 5. explanations for the wrong answers
  const kick = await post(`/api/riishe/attempts/${attemptId}/explain`, { guestId: GUEST })
  ok(kick.status === 200 || kick.status === 202 || kick.status === 429, `explain kicked (${kick.status})`, JSON.stringify(kick.body))
  let explained = 0
  for (let i = 0; i < 20; i++) {
    await sleep(4000)
    const ex = await jfetch<any>(`/api/riishe/attempts/${attemptId}/explanations?guestId=${GUEST}`)
    const list = ex.body?.explanations ?? ex.body ?? []
    const ready = (Array.isArray(list) ? list : []).filter((e: any) => e.status === 'READY')
    if (ready.length >= expected.wrong) { explained = ready.length; break }
    explained = ready.length
  }
  ok(explained >= expected.wrong, `explanations READY for ${explained}/${expected.wrong} wrong answers`)

  // verify payload completeness + grounding for one wrong question
  const wrongQ = questions[1]
  const exRow = await db.riisheExplanation.findUnique({ where: { attemptId_questionId: { attemptId, questionId: wrongQ.id } } })
  if (ok(!!exRow && exRow.status === 'READY', 'explanation row READY for wrong Q2')) {
    const p = JSON.parse(exRow!.payloadJson!)
    ok(typeof p.whyWrong === 'string' && p.whyWrong.length > 10, 'whyWrong present')
    ok(typeof p.correctReasoning === 'string' && p.correctReasoning.length > 10, 'correctReasoning present')
    ok(typeof p.concept === 'string' && p.concept.length > 0, 'concept present')
    ok(p.grounding === 'document' || p.grounding === 'external', `grounding=${p.grounding}`)
    if (p.grounding === 'document') {
      const doc = await db.studyDocument.findUnique({ where: { id: wrongQ.documentId } })
      const pages = JSON.parse(doc!.extractionJson!) as { page: number; text: string }[]
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const ev = norm(String(p.excerpt ?? ''))
      const onPages = ev.length >= 12 && pages.filter(pg => norm(pg.text).includes(ev)).length > 0
      ok(onPages || (ev.length >= 12 && norm(wrongQ.evidence ?? '').includes(ev)), 'excerpt verbatim in the document (or the question\'s own validated evidence)')
    } else {
      ok(p.excerpt === '' || p.excerpt === undefined, 'external grounding shows no invented excerpt')
    }
  }

  // 6. follow-up chat on the wrong question
  const chat = await post('/api/riishe/chat', {
    guestId: GUEST, attemptId, questionId: wrongQ.id,
    messages: [{ role: 'user', content: 'Why is my chosen option wrong? Explain step by step.' }],
  })
  ok(chat.status === 200 && typeof chat.body.reply === 'string', 'follow-up chat answered', JSON.stringify(chat.body).slice(0, 200))
  if (chat.status === 200) {
    ok(Array.isArray(chat.body.sources), `sources panel present (${(chat.body.sources ?? []).length} entries)`)
    ok(['document', 'mixed', 'general'].includes(chat.body.grounding), `attribution=${chat.body.grounding}`)
    // persisted history
    const turns = await db.riisheChatTurn.count({ where: { attemptId, questionId: wrongQ.id } })
    ok(turns >= 2, `chat history persisted (${turns} turns)`)
    log(`  reply: "${String(chat.body.reply).slice(0, 140)}…"`)
  }

  log(`\nWORKFLOW E2E: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
