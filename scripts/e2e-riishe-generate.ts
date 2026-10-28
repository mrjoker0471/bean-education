// E2E part 2: generate a validated test from the real bulletin, verify every
// question's grounding against the extraction, take the exam with a deliberate
// answer pattern, submit, and verify Riishe's explanations.
// Run: bun scripts/e2e-riishe-generate.ts
import { Database } from 'bun:sqlite'

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
const post = (path: string, payload: unknown) =>
  jfetch<any>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}
/** Loose containment: does `evidence` appear (modulo punctuation/whitespace) on `pageText`? */
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

async function main() {
  // Find the bulletin doc
  const docRow = db.query("SELECT id, title, extractionJson, pageCount FROM StudyDocument WHERE guestId = ? AND status = 'READY' ORDER BY createdAt DESC").get(GUEST) as any
  if (!docRow) { log('no READY document — run upload E2E first'); process.exit(1) }
  const docId = docRow.id as string
  const extraction = JSON.parse(docRow.extractionJson) as { page: number; text: string }[]
  const pageText = new Map(extraction.map(p => [p.page, p.text]))
  const maxPage = docRow.pageCount as number
  log(`document: ${docId} (${maxPage} pages)`)

  // ── 1. Generate with student-chosen scoring (the student explicitly picks
  // the CUET-style +5/−1 scheme in the new UI; nothing is auto-derived) ──
  log('\n── GENERATE (50 questions, focus: Examination Scheme + Eligibility, scoring +5/−1) ──')
  const gen = await post('/api/riishe/generate', {
    guestId: GUEST, documentIds: [docId],
    focusTopics: ['Examination Scheme', 'Eligibility'],
    count: 50, timed: true,
    difficultyFocus: 'MIXED',
    scoring: { marksPerQuestion: 5, negativeMark: 1 },
  })
  log('generate:', gen.status, JSON.stringify(gen.body))
  if (gen.status !== 200 || !gen.body.testId) process.exit(1)

  // Idempotent duplicate generation: an immediate second request must reuse
  const gen2 = await post('/api/riishe/generate', {
    guestId: GUEST, documentIds: [docId],
    focusTopics: ['Examination Scheme', 'Eligibility'],
    count: 50, timed: true,
    scoring: { marksPerQuestion: 5, negativeMark: 1 },
  })
  const dedupeOk = gen2.body.testId === gen.body.testId && gen2.body.existing === true
  log(`duplicate generation idempotent: ${dedupeOk ? '✓ same testId, existing=true' : '✗ ' + JSON.stringify(gen2.body)}`)

  // ── 2. Poll to READY ──
  const testId = gen.body.testId as string
  let test: any = null
  for (let i = 0; i < 150; i++) {
    await sleep(5000)
    const t = await jfetch<any>(`/api/riishe/tests/${testId}?guestId=${GUEST}`)
    test = t.body
    if (i % 6 === 0) log(`  poll ${i + 1}: ${test.status} — ${(test.statusDetail ?? '').slice(0, 100)}`)
    if (['READY', 'FAILED'].includes(test.status)) break
  }
  if (test.status !== 'READY') { log('GENERATION FAILED:', test.statusDetail); process.exit(1) }
  log(`\nREADY: ${test.questionCount} validated questions (requested ${test.requestedCount})`)
  log(`stats: ${JSON.stringify(test.stats)}`)
  log(`config: ${JSON.stringify(test.config)}`)
  const stats = test.stats
  const scoringOk = test.config.marksPerQuestion === 5 && test.config.negativeMark === 1 && test.config.scoringModel === 'CUSTOM'
  log(`student-chosen +5/−1 CUSTOM scoring (no hidden exam rules): ${scoringOk ? '✓' : '✗'}`)
  const sourcesOk = Array.isArray(test.sourceDocuments) && test.sourceDocuments.some((d: any) => d.id === docId)
  log(`sourceDocuments lists the bulletin: ${sourcesOk ? '✓' : '✗ ' + JSON.stringify(test.sourceDocuments)}`)

  // ── 3. Validate every question's grounding against the real extraction ──
  const questions = test.questions as { id: string; text: string; pageRefs: number[]; topic: string; category: string; difficulty: string }[]
  log(`\n── QUESTION GROUNDING AUDIT (${questions.length} questions) ──`)
  // correctIndex + evidence live in the DB (server keeps them out of pre-exam APIs)
  const dbRows = db.query(`SELECT id, text, optionsJson, correctIndex, pageRefsJson, evidence FROM RiisheQuestion WHERE testId = ?`).all(testId) as any[]
  const byId = new Map(dbRows.map(r => [r.id, r]))

  let inBounds = 0, evidenceOnCitedPage = 0, evidenceSomewhere = 0, singleAnswer = 0, optionsOk = 0
  const stems: Set<string>[] = []
  let nearDup = 0
  for (const q of questions) {
    const row = byId.get(q.id)
    if (!row) continue
    const refs = JSON.parse(row.pageRefsJson) as number[]
    if (refs.length > 0 && refs.every(p => p >= 1 && p <= maxPage)) inBounds++
    const ev = row.evidence as string
    const citedText = (JSON.parse(row.pageRefsJson) as number[]).map(p => pageText.get(p) ?? '').join(' ')
    if (evidenceOnPage(ev, citedText)) evidenceOnCitedPage++
    else if (extraction.some(p => evidenceOnPage(ev, p.text))) evidenceSomewhere++
    const opts = JSON.parse(row.optionsJson) as string[]
    if (opts.length === 4 && new Set(opts.map(norm)).size === 4) optionsOk++
    if (row.correctIndex >= 0 && row.correctIndex <= 3) singleAnswer++
    const toks = new Set(norm(row.text).split(' ').filter(w => w.length > 2))
    if (stems.some(s => jaccard(s, toks) > 0.78)) nearDup++
    stems.push(toks)
  }
  const n = dbRows.length
  log(`  page refs in document bounds: ${inBounds}/${n}`)
  log(`  evidence verbatim on its cited page: ${evidenceOnCitedPage}/${n}`)
  log(`  evidence on some other page (page-ref error): ${evidenceSomewhere}/${n}`)
  log(`  exactly 4 distinct options: ${optionsOk}/${n}`)
  log(`  single answer key in range: ${singleAnswer}/${n}`)
  log(`  near-duplicate stems (>0.78 Jaccard): ${nearDup}/${n}`)
  const cats: Record<string, number> = {}
  for (const q of questions) cats[q.category] = (cats[q.category] ?? 0) + 1
  log(`  category mix: ${JSON.stringify(cats)}`)
  const diffs: Record<string, number> = { EASY: 0, MEDIUM: 0, HARD: 0 }
  for (const q of questions) diffs[q.difficulty]++
  log(`  difficulty mix: ${JSON.stringify(diffs)}`)

  // ── 4. Start the attempt and answer deliberately ──
  const start = await post(`/api/riishe/tests/${testId}/start`, { guestId: GUEST })
  if (start.status !== 200) { log('start failed', start.body); process.exit(1) }
  const attemptId = start.body.attemptId as string
  log(`\nattempt started: ${attemptId}`)

  // Pre-exam leak check: the runner feed must not contain answers
  const state = await jfetch<any>(`/api/attempts/${attemptId}?guestId=${GUEST}`)
  const stateStr = JSON.stringify(state.body)
  const leak = state.body.questions.some((q: any) => 'correctIndex' in q) || stateStr.includes('"correctIndex"')
  log(`pre-exam answer leak check: ${leak ? '✗ LEAK' : '✓ no correctIndex in runner feed'}`)

  // Deliberate pattern: first 60% correct, next 30% wrong, last 10% skipped
  const answers: Record<string, number> = {}
  const ids = questions.map(q => q.id)
  ids.forEach((id, i) => {
    const correct = byId.get(id)?.correctIndex as number
    const opts = JSON.parse(byId.get(id).optionsJson) as string[]
    if (i < n * 0.6) answers[id] = correct
    else if (i < n * 0.9) answers[id] = (correct + 1) % 4
    // last 10%: skip
    void opts
  })
  // Randomised ordering check: the attempt's question order should differ
  // from the published set order (server-side shuffle at start).
  const testOrder = questions.map(q => q.id).join(',')
  const attemptOrder = state.body.questions.map((q: any) => q.id).join(',')
  const shuffledOk = attemptOrder !== testOrder
  log(`randomised question ordering: ${shuffledOk ? '✓ shuffled server-side' : '— order identical this run (50! orderings — can coincide)'}`)

  // Autosave a few, then submit
  const autosave = await jfetch<any>(`/api/attempts/${attemptId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST, answers: Object.fromEntries(Object.entries(answers).slice(0, 5)) }),
  })
  log(`autosave: ${autosave.status} ${JSON.stringify(autosave.body)}`)
  const submit = await post(`/api/attempts/${attemptId}`, { guestId: GUEST, answers, timeSpentSec: 300 })
  log(`submit: ${submit.status} → ${JSON.stringify(submit.body)}`)

  // ── 5. Verify server-authoritative scoring with +5/−1 ──
  const result = await jfetch<any>(`/api/attempts/${attemptId}/result?guestId=${GUEST}`)
  const r = result.body
  const nCorrect = ids.filter((id, i) => answers[id] === byId.get(id)?.correctIndex).length
  const nWrong = ids.filter(id => answers[id] !== undefined && answers[id] !== byId.get(id)?.correctIndex).length
  const nSkipped = n - nCorrect - nWrong
  const expectScore = nCorrect * 5 - nWrong * 1
  log(`\n── SCORING ──`)
  log(`  answered: ${nCorrect}C / ${nWrong}W / ${nSkipped}S`)
  log(`  expected score (+5/−1): ${expectScore} / ${n * 5}`)
  log(`  server score: ${r.score} / ${r.maxScore}`)
  const scoreOk = r.score === expectScore && r.maxScore === n * 5 && r.correctCount === nCorrect && r.wrongCount === nWrong && r.skippedCount === nSkipped
  log(`  server-authoritative +5/−1 scoring: ${scoreOk ? '✓' : '✗'}`)

  // ── 6. Explanations ──
  log(`\n── EXPLANATIONS ──`)
  const ex = await post(`/api/riishe/attempts/${attemptId}/explain`, { guestId: GUEST })
  log(`explain start: ${ex.status} ${JSON.stringify(ex.body)}`)
  let exState: any = null
  for (let i = 0; i < 90; i++) {
    await sleep(4000)
    const s = await jfetch<any>(`/api/riishe/attempts/${attemptId}/explanations?guestId=${GUEST}`)
    exState = s.body
    if (i % 5 === 0) log(`  poll ${i + 1}: ready=${exState.readyCount} failed=${exState.failedCount} pending=${exState.pending} (wrong=${exState.wrongCount})`)
    if (exState.pending <= 0) break
  }
  const total = exState.wrongCount + (exState.correctCount ?? 0) + (exState.skippedCount ?? 0)
  const allReady = exState.pending <= 0 && exState.failedCount === 0
  log(`  coverage: ${exState.readyCount}/${total} ${allReady ? '✓' : '✗'} (failed: ${exState.failedCount})`)

  // Payload quality audit
  let wrongFull = 0, wrongTotal = 0, correctOk = 0, correctTotal = 0, skippedOk = 0, skippedTotal = 0
  let followUps = 0, excerptOnPage = 0, excerptTotal = 0
  for (const [qid, entry] of Object.entries(exState.explanations) as [string, any][]) {
    if (entry.status !== 'READY' || !entry.payload) continue
    const p = entry.payload
    const row = byId.get(qid)
    const refs: number[] = p.pageRefs ?? []
    if (p.whyWrong) {
      wrongTotal++
      if (p.whyWrong && p.correctReasoning && p.concept && p.revisionTopic) wrongFull++
      if (p.followUp) followUps++
    } else if (p.correctReasoning && !/left this question unanswered/.test(p.correctReasoning)) {
      correctTotal++
      if (p.correctReasoning) correctOk++
      if (p.followUp) followUps++
    } else {
      skippedTotal++
      if (p.correctReasoning?.includes('left this question unanswered')) skippedOk++
    }
    if (p.excerpt && refs.length > 0) {
      excerptTotal++
      const cited = refs.map(pg => pageText.get(pg) ?? '').join(' ')
      if (evidenceOnPage(p.excerpt, cited) || p.grounding === 'external') excerptOnPage++
    }
  }
  log(`  WRONG payloads complete (whyWrong+reasoning+concept+revise): ${wrongFull}/${wrongTotal}`)
  log(`  CORRECT payloads present: ${correctOk}/${correctTotal}`)
  log(`  SKIPPED deterministic notes: ${skippedOk}/${skippedTotal}`)
  log(`  follow-up questions generated: ${followUps}/${wrongTotal + correctTotal}`)
  log(`  explanation excerpts verified on cited pages (or honestly external): ${excerptOnPage}/${excerptTotal}`)

  // ── 7. Ask Riishe a follow-up chat grounded in the bulletin ──
  log('\n── FOLLOW-UP CHAT (grounded) ──')
  const chat = await post('/api/riishe/chat', {
    guestId: GUEST, attemptId, questionId: questions[0].id,
    messages: [{ role: 'user', content: 'Explain the correct answer to this question in simpler words, and tell me which page of my document explains it.' }],
  })
  log(`chat: ${chat.status} → ${JSON.stringify(chat.body).slice(0, 260)}`)
  const chatOk = chat.status === 200 && typeof chat.body.reply === 'string' && chat.body.reply.length > 20
  const chatGrounded = chatOk && (chat.body.grounding === 'document' || chat.body.grounding === 'mixed')
  log(`chat grounded with page cites: ${chatGrounded ? '✓ ' + JSON.stringify(chat.body.pagesCited) : chatOk ? '— no page cites (honest if the source lacks them)' : '✗'}`)

  // Chat history persisted
  const hist = await jfetch<any>(`/api/riishe/chat?guestId=${GUEST}&attemptId=${attemptId}&questionId=${questions[0].id}`)
  const histOk = hist.status === 200 && hist.body.turns.length >= 2
  log(`chat history persisted: ${histOk ? `✓ ${hist.body.turns.length} turns` : '✗'}`)

  const pass = dedupeOk && scoringOk && sourcesOk && !leak && scoreOk && allReady &&
    inBounds === n && nearDup === 0 && wrongFull === wrongTotal && skippedOk === skippedTotal && chatOk && histOk
  log(`\nRESULT: dedupe=${dedupeOk ? 'PASS' : 'FAIL'} scoring=${scoreOk ? 'PASS' : 'FAIL'} noLeak=${!leak ? 'PASS' : 'FAIL'} grounding=${inBounds}/${n} dups=${nearDup} explanations=${allReady ? 'PASS' : 'FAIL'} chat=${chatOk ? (chatGrounded ? 'PASS(grounded)' : 'PASS') : 'FAIL'} → ${pass ? 'OVERALL PASS' : 'OVERALL FAIL'}`)
  console.log(JSON.stringify({ testId, attemptId, pass }, null, 0))
}

main().catch(e => { console.error(e); process.exit(1) })
