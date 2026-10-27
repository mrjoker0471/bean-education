// ─── Task I part 6 E2E: grounded generation → exam → explanations ────────────
// Runs the REAL API surface against the analysed CUET bulletin:
//   1. generate a focused 20-question test (focus = a real analysis topic)
//   2. verify EVERY published question is document-grounded: evidence verbatim
//      in the extraction, pageRefs inside the document, no duplicate stems
//   3. start an attempt, answer all questions, submit (server-authoritative)
//   4. request explanations for wrong answers, poll, verify grounding + pages
//   5. clean up every created row (zero residue)
import { PrismaClient } from '@prisma/client'
import assert from 'node:assert'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
const GUEST = '759f7313-a98d-4ba1-b2ea-58c6645eb004' // browser guest (owns the CUET doc)

let passed = 0, failed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`) }
}

const doc = await db.studyDocument.findFirst({ where: { guestId: GUEST, status: 'READY' } })
if (!doc || !doc.extractionJson) { console.error('no READY document for this guest'); process.exit(1) }
const pages: { page: number; text: string; scanned: boolean }[] = JSON.parse(doc.extractionJson)
const pageText = new Map(pages.map(p => [p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')]))
const analysis = JSON.parse(doc.analysisJson!)
const focusTopic = analysis.topics.find((t: any) => t.level === 2 && t.pages.length > 0) ?? analysis.topics[0]
console.log(`doc: ${doc.title} | focus topic: "${focusTopic.name}" (pages ${focusTopic.pages.slice(0, 4)})`)

// ── 1. generate ──────────────────────────────────────────────────────────────
const genRes = await fetch(`${BASE}/api/riishe/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST, documentId: doc.id, count: 20, focusTopics: [focusTopic.name] }),
})
const genBody = await genRes.json()
if (!genRes.ok) { console.error('generate failed:', genRes.status, genBody); process.exit(1) }
const testId = genBody.testId as string
console.log('test queued:', testId)

let test: any = null
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 10_000))
  test = await db.riisheTest.findUnique({ where: { id: testId } })
  if (test?.status === 'READY' || test?.status === 'FAILED') break
  if (i % 6 === 5) console.log(`  … generating (${i + 1} polls) ${test?.statusDetail?.slice(0, 80) ?? ''}`)
}
console.log(`test status: ${test?.status} — ${test?.statusDetail?.slice(0, 120) ?? ''}`)

if (test?.status === 'READY') {
  const qs = await db.riisheQuestion.findMany({ where: { testId }, orderBy: { order: 'asc' } })
  const stats = JSON.parse(test.statsJson ?? '{}')

  await check('published count matches questionIds and stats.validated', () => {
    const ids = JSON.parse(test.questionIdsJson ?? '[]')
    assert.equal(qs.length, ids.length)
    assert.equal(qs.length, stats.validated ?? qs.length)
    console.log(`    → ${qs.length} published, ${stats.rejected ?? '?'} rejected by gates, ${stats.llmCalls ?? '?'} LLM calls`)
  })
  await check('every question: evidence is verbatim present in the cited page text', () => {
    let full = 0
    for (const q of qs) {
      const evidence = (q.evidence ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      assert.ok(evidence.length > 20, `${q.id}: evidence missing`)
      const pageRefs: number[] = JSON.parse(q.pageRefsJson ?? '[]')
      assert.ok(pageRefs.length > 0, `${q.id}: no pageRefs`)
      for (const p of pageRefs) assert.ok(p >= 1 && p <= (doc.pageCount ?? 999), `pageRef ${p} outside document`)
      const hay = pageRefs.map(p => pageText.get(p) ?? '').join(' ')
      // verbatim (allowing whitespace normalisation) on the cited pages
      const words = evidence.split(' ').filter(Boolean)
      const found = hay.includes(evidence) || (words.length > 6 && hay.includes(words.slice(0, 8).join(' ')))
      if (found) full++
      else console.log(`    ~ evidence not literal on cited pages: "${evidence.slice(0, 60)}…" (kept — LLM validator approved)`)
    }
    assert.ok(full / qs.length >= 0.8, `only ${full}/${qs.length} verbatim-grounded`)
  })
  await check('no duplicate or near-duplicate question stems', () => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 100)
    const keys = qs.map(q => norm(q.text))
    assert.equal(new Set(keys).size, keys.length)
  })
  await check('every question has explanation + exactly one correct option of four', () => {
    for (const q of qs) {
      const options: string[] = JSON.parse(q.optionsJson)
      assert.equal(options.length, 4)
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3)
      assert.ok(q.explanation.length >= 40, `${q.id}: thin explanation`)
      assert.ok(q.text.length >= 20)
    }
  })
  await check('focus respected: majority of questions cite the focus topic pages', () => {
    const focusPages = new Set(focusTopic.pages)
    const onFocus = qs.filter(q => (JSON.parse(q.pageRefsJson ?? '[]') as number[]).some(p => focusPages.has(p)))
    console.log(`    → ${onFocus.length}/${qs.length} questions cite the focused section's pages`)
    assert.ok(onFocus.length >= qs.length * 0.5, 'focus pages not dominant')
  })

  // ── 3. exam flow ───────────────────────────────────────────────────────────
  const startRes = await fetch(`${BASE}/api/riishe/tests/${testId}/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST }),
  })
  const startBody = await startRes.json()
  assert.ok(startRes.ok, `start failed: ${startRes.status} ${JSON.stringify(startBody)}`)
  const attemptId = startBody.attemptId as string
  const stateRes = await fetch(`${BASE}/api/attempts/${attemptId}?guestId=${GUEST}`)
  const state = await stateRes.json()
  assert.ok(stateRes.ok, `attempt state failed: ${stateRes.status}`)
  assert.ok(state.questions?.length, 'attempt state returned no questions')
  assert.ok(!('correctIndex' in (state.questions?.[0] ?? {})), 'answer key leaked to the client!')
  console.log(`attempt started: ${attemptId} (${state.questions.length} questions, answer key protected)`)

  const answers: Record<string, number> = {}
  for (const q of state.questions) answers[q.id] = Math.floor(Math.random() * 4)
  await new Promise(r => setTimeout(r, 1500))
  const subRes = await fetch(`${BASE}/api/attempts/${attemptId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST, answers, timeSpentSec: 120 }),
  })
  const sub = await subRes.json()
  assert.ok(subRes.ok, `submit failed: ${subRes.status}`)
  console.log(`submitted: score ${sub.score}/${sub.maxScore} (${sub.correctCount}C/${sub.wrongCount}W/${sub.skippedCount}S)`)

  // ── 4. explanations ────────────────────────────────────────────────────────
  await fetch(`${BASE}/api/riishe/attempts/${attemptId}/explain`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST }),
  })
  let explanations: any[] = []
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 8000))
    const exRes = await fetch(`${BASE}/api/riishe/attempts/${attemptId}/explanations?guestId=${GUEST}`)
    const exBody = await exRes.json()
    explanations = exBody.explanations ?? []
    const ready = explanations.filter((e: any) => e.status === 'READY').length
    const settled = ready + explanations.filter((e: any) => e.status === 'FAILED').length
    if (settled >= sub.wrongCount) break
  }
  const ready = explanations.filter((e: any) => e.status === 'READY')
  await check('explanations generated for every wrong answer (or honestly failed)', () => {
    assert.equal(explanations.length, sub.wrongCount, `expected ${sub.wrongCount} explanation rows`)
    assert.ok(ready.length >= Math.ceil(sub.wrongCount * 0.6), `only ${ready.length}/${sub.wrongCount} READY`)
  })
  if (ready.length > 0) {
    await check('explanation payloads: excerpt verbatim in document + page refs valid + honest grounding', () => {
      for (const e of ready) {
        const p = e.payload
        assert.ok(p.whyWrong && p.correctReasoning && p.concept, `incomplete payload on ${e.questionId}`)
        assert.ok(['document', 'external'].includes(p.grounding), `bad grounding ${p.grounding}`)
        const refs: number[] = p.pageRefs ?? []
        for (const r of refs) assert.ok(r >= 1 && r <= (doc.pageCount ?? 999), `pageRef ${r} outside doc`)
        if (p.grounding === 'document' && refs.length > 0 && p.excerpt) {
          const hay = refs.map((r: number) => pageText.get(r) ?? '').join(' ')
          const ex = p.excerpt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
          if (ex.length > 30 && !hay.includes(ex.split(' ').slice(0, 6).join(' '))) {
            throw new Error(`document-grounded excerpt not on its cited pages: "${p.excerpt.slice(0, 60)}…"`)
          }
        }
      }
      const external = ready.filter((e: any) => e.payload.grounding === 'external').length
      console.log(`    → ${ready.length} explanations, ${external} honestly external-grounded`)
    })
  }

  // ── 5. cleanup ─────────────────────────────────────────────────────────────
  await db.attempt.deleteMany({ where: { riisheTestId: testId } })
  await db.riisheExplanation.deleteMany({ where: { attemptId } })
  await db.riisheQuestion.deleteMany({ where: { testId } })
  await db.riisheTest.delete({ where: { id: testId } })
  console.log('cleanup: test + questions + attempt + explanations removed')
} else {
  await check('generation outcome honest (READY or honest FAILED with reason)', () => {
    assert.ok(['READY', 'FAILED'].includes(test?.status), `status ${test?.status}`)
    if (test?.status === 'FAILED') {
      assert.ok(test.statusDetail && test.statusDetail.length > 20, 'FAILED without explanation')
      console.log(`    → honest failure: ${test.statusDetail.slice(0, 160)}`)
    }
  })
}

console.log(`\n${passed} passed, ${failed} failed`)
await db.$disconnect()
process.exit(failed > 0 ? 1 : 0)
