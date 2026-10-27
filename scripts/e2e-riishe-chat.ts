// E2E: Riishe chat grounding, source modes, retrieval and access control.
// Runs the 9 real cases from the task spec against the live dev server with
// real AI provider calls and real uploaded PDFs. Nothing is mocked.
// Run: bun scripts/e2e-riishe-chat.ts
import { writeFile, readFile, rm, mkdir } from 'node:fs/promises'

const BASE = 'http://localhost:3000'
const uuid = () => crypto.randomUUID()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function log(...a: unknown[]) { console.log(...a) }

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; log(`  ✓ ${name}`) }
  else { fail++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function jfetch<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, init)
  let body: unknown = null
  try { body = await res.json() } catch { /* */ }
  return { status: res.status, body: body as T }
}

// ─── Minimal valid PDF builder (same as make-fixtures.ts) ───
function buildPdf(pages: string[]): Buffer {
  const objects: string[] = []
  const pageCount = pages.length
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`)
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`)
  pages.forEach((text, i) => {
    const pageId = 4 + i * 2
    const contentId = pageId + 1
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`)
    const lines: string[] = []
    for (const raw of text.split('\n')) for (let k = 0; k < raw.length; k += 90) lines.push(raw.slice(k, k + 90))
    const stream = lines.map((l, ln) => `BT /F1 11 Tf 50 ${740 - ln * 16} Td (${l.replace(/([()\\])/g, '\\$1')}) Tj ET`).join('\n')
    objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`)
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const obj of objects) { offsets.push(out.length); out += obj }
  const xrefStart = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const paragraph = (t: string, n: number) => Array(n).fill(t).join(' ')

const constPages = [
  paragraph('Chapter 1 Fundamental Duties. Article 51A of the Constitution of India lists eleven fundamental duties of citizens. ', 12) +
    'Duty one requires every citizen to abide by the Constitution and respect its ideals and institutions, the National Flag and the National Anthem. ' +
    paragraph('Duty two cherishes the noble ideals of the freedom struggle. ', 6),
  paragraph('Chapter 2 Directive Principles. The Directive Principles of State Policy are contained in Part IV of the Constitution, Articles 36 to 51. ', 10) +
    'Article 39 directs the State to secure adequate means of livelihood and equal pay for equal work for both men and women. ' +
    paragraph('Article 40 organises village panchayats. ', 8),
  paragraph('Chapter 3 Amendment Procedure. Article 368 governs the amendment of the Constitution. ', 10) +
    'A majority of the total membership of each House and a majority of not less than two-thirds of the members present and voting is required for most amendments. ' +
    paragraph('Ratification by half the state legislatures is needed for federal provisions. ', 8),
]

const solarPages = [
  paragraph('Chapter 1 The Planets. The Solar System has eight planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune. ', 12) +
    paragraph('Mercury is the smallest planet and the closest to the Sun. ', 6),
  paragraph('Chapter 2 Jupiter and Saturn. Jupiter is the largest planet in the Solar System with at least 95 known moons. ', 10) +
    paragraph('Saturn is famous for its prominent ring system made of ice and rock. ', 8),
]

async function upload(guestId: string, name: string, title: string, pages: string[]): Promise<string> {
  const dir = '/tmp/riishe-chat-fixtures'
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  await mkdir(dir, { recursive: true })
  await writeFile(`${dir}/${name}`, buildPdf(pages))
  const buf = await readFile(`${dir}/${name}`)
  const form = new FormData()
  form.set('guestId', guestId)
  form.set('file', new File([buf], name, { type: 'application/pdf' }))
  form.set('title', title)
  const up = await jfetch<{ documentId?: string; error?: string }>('/api/materials', { method: 'POST', body: form })
  if (up.status !== 200 || !up.body.documentId) throw new Error(`upload failed: ${up.status} ${JSON.stringify(up.body)}`)
  // Wait to READY — the provider rate-limits under load; a FAILED analysis
  // (sustained 429s) is retried via the honest retry endpoint.
  const docId = up.body.documentId
  for (let i = 0; i < 90; i++) {
    await sleep(3000)
    const d = await jfetch<{ status: string; statusDetail?: string }>(`/api/materials/${docId}?guestId=${guestId}`)
    if (d.body.status === 'READY') return docId
    if (d.body.status === 'NEEDS_OCR') throw new Error(`document not usable: ${d.body.status}`)
    if (d.body.status === 'FAILED') {
      log(`  … analysis failed (${(d.body.statusDetail ?? '').slice(0, 80)}) — waiting 60s, retrying`)
      await sleep(60_000)
      await jfetch(`/api/materials/${docId}/retry?guestId=${guestId}`, { method: 'POST' })
    }
  }
  throw new Error('timeout waiting for READY')
}

interface ChatReply {
  reply: string
  pagesCited: number[]
  grounding: 'document' | 'mixed' | 'general' | null
  sources: { documentId: string; title: string; pages: number[]; excerpt: string; kind?: 'document' | 'web'; url?: string; detail?: string }[]
  turnId?: string
}

const docSourcesOf = (b: ChatReply) => (b.sources ?? []).filter(s => (s.kind ?? 'document') === 'document')
const webSourcesOf = (b: ChatReply) => (b.sources ?? []).filter(s => s.kind === 'web')

/** Chat call with patient retries — the provider rate-limits under load and the
 *  API honestly returns 502 instead of faking a reply; we wait and retry.
 *  The app's own per-guest limit (20/10min) returns "very quickly" — wait longer. */
async function chat(guestId: string, body: Record<string, unknown>): Promise<{ status: number; body: ChatReply | { error: string } }> {
  let last = { status: 0, body: null as ChatReply | { error: string } | null }
  for (let attempt = 1; attempt <= 8; attempt++) {
    last = await jfetch<ChatReply>('/api/riishe/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId, messages: [], ...body }),
    })
    if (last.status === 200) return last as { status: number; body: ChatReply }
    const msg = (last.body as { error?: string })?.error ?? ''
    if (last.status !== 502 && !/provider|unavailable|quickly/i.test(msg)) return last as { status: number; body: ChatReply | { error: string } }
    const wait = /quickly/i.test(msg) ? 130_000 : 45_000
    log(`  … busy (${msg.slice(0, 60)}) — waiting ${wait / 1000}s before retry ${attempt + 1}/8`)
    await sleep(wait)
  }
  return last as { status: number; body: ChatReply | { error: string } }
}

async function main() {
  const guestA = `chat-e2e-${uuid()}`
  const guestB = `chat-e2e-${uuid()}`
  const guestC = `chat-e2e-${uuid()}`

  // ── PHASE=probe: wait for the AI provider, then exit (sandbox-safe split) ──
  // The provider throttles hard under load and the API honestly returns 502
  // rather than faking replies. Probe with a tiny call every 30s for ~8.5 min.
  if (process.env.E2E_PHASE === 'probe') {
    log('════ PROBE PHASE: waiting for AI provider availability ══')
    for (let i = 0; i < 17; i++) {
      const probe = await jfetch<{ reply?: string; error?: string }>('/api/bean/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestId: `probe-${uuid()}`,
          messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
          context: {},
          settings: { style: 'simple', showSourceContext: true },
        }),
      })
      if (probe.status === 200 && (probe.body as { reply?: string }).reply) {
        log(`  provider is UP after ${i * 30}s — reply: ${(probe.body as { reply?: string }).reply?.slice(0, 40)}`)
        process.exit(0)
      }
      log(`  probe ${i + 1}/17: ${(probe.body as { error?: string })?.error?.slice(0, 60) ?? probe.status}`)
      await sleep(30_000)
    }
    log('PROVIDER STILL DOWN after the probe window.')
    process.exit(2)
  }

  try {
    log('════ SETUP: upload two real PDFs for guest A ══')
    const docA = await upload(guestA, 'constitution-notes.pdf', 'Constitution Study Notes', constPages)
    const docB = await upload(guestA, 'solar-system-notes.pdf', 'Solar System Study Notes', solarPages)
    log(`docA=${docA} docB=${docB}`)

    // Ground truth: the script itself built the PDFs, so page N's true text is
    // constPages[N-1] — an independent check that the cited page really
    // contains the cited fact (no dependence on the extraction payload).
    const pageContains = (page: number, keyword: string) =>
      (constPages[page - 1] ?? '').toLowerCase().includes(keyword.toLowerCase())

    // ══ CASE 1: general question, no document selected ══
    log('\n════ CASE 1 — general question, no documents (fresh guest, hub scope) ══')
    {
      const r = await chat(guestC, { messages: [{ role: 'user', content: 'Explain the difference between simple and compound interest.' }] })
      const b = r.body as ChatReply
      if (r.status !== 200) { log(`  API error: ${JSON.stringify(r.body)}`) }
      log(`  grounding=${b.grounding} sources=${JSON.stringify((b as ChatReply).sources?.length ?? 'n/a')}`)
      log(`  reply: ${b.reply?.slice(0, 220)}`)
      check('returns 200', r.status === 200)
      check('grounding is one of the three states', b.grounding === 'general' || b.grounding === 'document' || b.grounding === 'mixed')
      check('grounding is general (no material available)', b.grounding === 'general')
      check('no sources claimed', Array.isArray(b.sources) && b.sources.length === 0)
      check('no page citations', Array.isArray(b.pagesCited) && b.pagesCited.length === 0)
      check('source tag stripped from visible reply', !/\[SOURCES:/i.test(b.reply ?? ''))
    }

    // ══ CASE 2: answer explicitly present in the uploaded PDF ══
    log('\n════ CASE 2 — answer present in the selected PDF (document scope) ══')
    {
      const r = await chat(guestA, {
        documentId: docA,
        messages: [{ role: 'user', content: 'According to my notes, which article governs the amendment of the Constitution and what majority does it require?' }],
      })
      const b = r.body as ChatReply
      log(`  grounding=${b.grounding} pagesCited=${JSON.stringify(b.pagesCited)} sources=${JSON.stringify(b.sources?.map(s => ({ t: s.title, p: s.pages })))}`)
      log(`  reply: ${b.reply?.slice(0, 260)}`)
      check('returns 200', r.status === 200)
      check('grounding=document', b.grounding === 'document', `got ${b.grounding}`)
      check('cites at least one page', b.pagesCited.length > 0)
      check('cited page is in document bounds', b.pagesCited.every(p => p >= 1 && p <= 3))
      check('cited page contains the cited fact (Article 368 on page 3)', b.pagesCited.length === 0 || b.pagesCited.some(p => pageContains(p, '368')), JSON.stringify(b.pagesCited))
      check('sources include the document', b.sources.some(s => s.documentId === docA))
      check('source has excerpt', b.sources.every(s => typeof s.excerpt === 'string' && s.excerpt.length > 0))
      check('tag stripped', !/\[SOURCES:/i.test(b.reply ?? ''))
    }

    // ══ CASE 3: answer absent from the selected PDF ══
    log('\n════ CASE 3 — answer absent from the selected PDF (honest non-coverage) ══')
    {
      const r = await chat(guestA, {
        documentId: docA,
        messages: [{ role: 'user', content: 'Who won the ICC Cricket World Cup 2023 final and what was the winning score?' }],
      })
      const b = r.body as ChatReply
      log(`  grounding=${b.grounding} pagesCited=${JSON.stringify(b.pagesCited)} docSources=${docSourcesOf(b).length} webSources=${webSourcesOf(b).length}`)
      log(`  reply: ${b.reply?.slice(0, 260)}`)
      check('returns 200', r.status === 200)
      check('NOT marked document-grounded', b.grounding !== 'document', `got ${b.grounding}`)
      check('no fabricated page citations', b.pagesCited.length === 0, JSON.stringify(b.pagesCited))
      check('no document sources claimed', docSourcesOf(b).length === 0, JSON.stringify(docSourcesOf(b).map(s => s.title)))
      check('any web source is properly labelled (kind=web, url, live detail)', webSourcesOf(b).every(s => s.url && /retrieved live/i.test(s.detail ?? '')))
      check('honestly says not covered (or labels external/web knowledge)', /not|outside|general knowledge|does not|doesn't|do not|web results/i.test(b.reply ?? ''))
      check('machine web markers stripped from the visible reply', !/\[web \d+\]/i.test(b.reply ?? ''))
    }

    // ══ CASE 4: follow-up referencing the previous answer ══
    log('\n════ CASE 4 — follow-up referencing the previous answer ══')
    {
      const r = await chat(guestA, {
        documentId: docA,
        messages: [
          { role: 'user', content: 'According to my notes, which article governs the amendment of the Constitution?' },
          { role: 'assistant', content: 'Your notes say Article 368 governs the amendment of the Constitution (Constitution Study Notes, page 3).' },
          { role: 'user', content: 'Why is ratification by half the state legislatures needed for some of them?' },
        ],
      })
      const b = r.body as ChatReply
      log(`  grounding=${b.grounding} pagesCited=${JSON.stringify(b.pagesCited)}`)
      log(`  reply: ${b.reply?.slice(0, 260)}`)
      check('returns 200', r.status === 200)
      check('follow-up stays on the document topic (mentions ratification/states/federal)', /ratif|state|federal|legislat/i.test(b.reply ?? ''))
      check('grounding is a valid state', ['document', 'mixed', 'general'].includes(b.grounding as string))
      check('no invented citations for absent pages', b.pagesCited.every(p => p >= 1 && p <= 3))
    }

    // ══ CASE 5: question requiring information from two selected documents ══
    log('\n════ CASE 5 — two selected documents (hub scope, both grounded) ══')
    {
      const r = await chat(guestA, {
        messages: [{ role: 'user', content: 'In my Constitution notes, what majority does Article 368 require for amendments, and in my Solar System notes, how many known moons does Jupiter have?' }],
      })
      const b = r.body as ChatReply
      const srcDocs = new Set((b.sources ?? []).map(s => s.documentId))
      log(`  grounding=${b.grounding} sources=${JSON.stringify([...srcDocs])}`)
      log(`  reply: ${b.reply?.slice(0, 260)}`)
      check('returns 200', r.status === 200)
      check('grounded (document or mixed)', b.grounding === 'document' || b.grounding === 'mixed', `got ${b.grounding}`)
      check('sources include BOTH documents', srcDocs.has(docA) && srcDocs.has(docB), JSON.stringify([...srcDocs]))
      check('368 and 95 both appear in the reply', /368/.test(b.reply ?? '') && /95/.test(b.reply ?? ''))
    }

    // ══ CASE 6: context toggle — API always returns the verified sources ══
    log('\n════ CASE 6 — context toggle (server always grounds; UI hides/shows) ══')
    {
      const r = await chat(guestA, {
        documentId: docA,
        messages: [{ role: 'user', content: 'What do my notes say about Article 39?' }],
      })
      const b = r.body as ChatReply
      check('sources payload always present (toggle is UI-only)', Array.isArray(b.sources))
      check('document answer carries sources for the ON state', b.sources.length > 0)
      check('grounding present for the OFF state badge', b.grounding === 'document' || b.grounding === 'mixed' || b.grounding === 'general')
    }

    // ══ CASE 7: Simple / Exam-focused / Detailed response styles ══
    log('\n════ CASE 7 — response styles change presentation only ══')
    {
      for (const style of ['simple', 'exam-focused', 'detailed'] as const) {
        const r = await chat(guestA, {
          documentId: docA,
          style,
          messages: [{ role: 'user', content: 'What are the fundamental duties in my notes?' }],
        })
        const b = r.body as ChatReply
        check(`style=${style}: returns 200`, r.status === 200)
        check(`style=${style}: still document-grounded`, b.grounding === 'document', `got ${b.grounding}`)
        check(`style=${style}: sources preserved`, (b.sources ?? []).length > 0)
        log(`  [${style}] reply: ${(b.reply ?? '').slice(0, 150).replace(/\n/g, ' ')}`)
      }
    }

    // ══ CASE 8: time-sensitive question — live retrieval is configured ══
    log('\n════ CASE 8 — time-sensitive question (live web retrieval; labelled, never doc-mixed) ══')
    {
      const r = await chat(guestC, { messages: [{ role: 'user', content: 'What is the price of gold today, and who is the current Chief Minister of Tamil Nadu?' }] })
      const b = r.body as ChatReply
      log(`  grounding=${b.grounding} docSources=${docSourcesOf(b).length} webSources=${webSourcesOf(b).length}`)
      log(`  reply: ${b.reply?.slice(0, 320)}`)
      check('returns 200', r.status === 200)
      check('labelled general knowledge (web is outside the material)', b.grounding === 'general', `got ${b.grounding}`)
      check('no document sources claimed', docSourcesOf(b).length === 0)
      const web = webSourcesOf(b)
      if (web.length > 0) {
        // Live-retrieval path: web sources are labelled, linked and dated.
        check('web sources carry kind=web + url', web.every(s => s.kind === 'web' && !!s.url))
        check('web sources carry a host/live-retrieval detail line', web.every(s => /retrieved live/i.test(s.detail ?? '')))
        check('no fabricated live-lookup phrasing', !/\b(i|we) (just )?(checked|looked up)\b/i.test(b.reply ?? ''))
      } else {
        // Honest fallback when the live lookup failed or returned nothing.
        // Real disclosure phrasing only — the bare word "current" (present in
        // almost any such answer) must not count.
        check('fallback discloses non-current/unverified info', /not verified|cannot verif|can't verif|unable to verif|no live|not be current|may (?:be|have) (?:changed|outdated)|outdated|official source|up.to.date|real.?time|live (?:data|lookup|results)/i.test(b.reply ?? ''), (b.reply ?? '').slice(0, 120))
        check('fallback does NOT claim a live lookup', !/\b(i|we) (just )?(checked|looked up|searched|retrieved)\b/i.test(b.reply ?? ''))
      }
      check('machine web markers stripped from the visible reply', !/\[web \d+\]/i.test(b.reply ?? ''))
    }

    // ══ CASE 9: attempts to access another user's private material ══
    log('\n════ CASE 9 — cross-student access control ══')
    {
      const docScoped = await chat(guestB, { documentId: docA, messages: [{ role: 'user', content: 'Summarise this document.' }] })
      check('stranger document chat → 404', docScoped.status === 404, `got ${docScoped.status}`)

      const multiScoped = await chat(guestB, { documentIds: [docA, docB], messages: [{ role: 'user', content: 'Summarise these documents.' }] })
      check('stranger multi-document scope → 404', multiScoped.status === 404, `got ${multiScoped.status}`)

      const hist = await jfetch<{ turns: unknown[] }>(`/api/riishe/chat?guestId=${guestB}&documentId=${docA}`)
      check('stranger history for A\'s document is empty', hist.status === 200 && hist.body.turns.length === 0)

      const qScope = await chat(guestB, { attemptId: 'nonexistent-attempt', questionId: 'nonexistent-question', messages: [{ role: 'user', content: 'hi' }] })
      check('stranger attempt/question chat → 404', qScope.status === 404, `got ${qScope.status}`)

      // guestB hub chat must not see guestA's documents (no material → general)
      const hubB = await chat(guestB, { messages: [{ role: 'user', content: 'What does Article 51A list?' }] })
      const hb = hubB.body as ChatReply
      check('stranger hub chat never grounded in A\'s docs', hb.grounding === 'general' && docSourcesOf(hb).length === 0)

      // topic focus cannot leak other guests' docs either
      const topicB = await chat(guestB, { topic: 'Amendment Procedure', messages: [{ role: 'user', content: 'What does Article 368 require?' }] })
      const tb = topicB.body as ChatReply
      check('stranger topic-focused chat never grounded in A\'s docs', tb.grounding === 'general' && docSourcesOf(tb).length === 0)
    }

    // ══ CASE 10: explicit multi-document scope via the hub selector (documentIds) ══
    log('\n════ CASE 10 — explicit multi-document scope (documentIds) ══')
    {
      const r = await chat(guestA, {
        documentIds: [docA, docB],
        messages: [{ role: 'user', content: 'Using my two notes: what does Article 39 of the Constitution direct, and what are Saturn\'s rings made of?' }],
      })
      const b = r.body as ChatReply
      const srcDocs = new Set(docSourcesOf(b).map(s => s.documentId))
      log(`  grounding=${b.grounding} sources=${JSON.stringify([...srcDocs])} reply=${(b.reply ?? '').slice(0, 180)}`)
      check('returns 200', r.status === 200)
      check('grounded (document or mixed)', b.grounding === 'document' || b.grounding === 'mixed', `got ${b.grounding}`)
      check('sources include BOTH explicitly selected documents', srcDocs.has(docA) && srcDocs.has(docB), JSON.stringify([...srcDocs]))
      check('equal pay + ice/rock both answered', /equal pay/i.test(b.reply ?? '') && /ice/i.test(b.reply ?? ''))

      // A single-document scope must NOT pull the other document in.
      const onlyB = await chat(guestA, {
        documentIds: [docB],
        messages: [{ role: 'user', content: 'What does Article 39 of the Constitution direct?' }],
      })
      const bb = onlyB.body as ChatReply
      const bDocs = new Set(docSourcesOf(bb).map(s => s.documentId))
      check('single-doc scope excludes the other document', !bDocs.has(docA), JSON.stringify([...bDocs]))
      check('single-doc scope with an unrelated question is honest', bb.grounding === 'general' || bDocs.has(docB), `got ${bb.grounding}`)
    }

    // ══ EXTRA: topic focus steers retrieval for the OWNER ══
    log('\n════ EXTRA — topic focus (owner) ══')
    {
      const r = await chat(guestA, { topic: 'Jupiter and Saturn', messages: [{ role: 'user', content: 'Tell me about the ring system.' }] })
      const b = r.body as ChatReply
      const srcDocs = new Set((b.sources ?? []).map(s => s.documentId))
      log(`  grounding=${b.grounding} sources=${JSON.stringify([...srcDocs])} reply=${(b.reply ?? '').slice(0, 160)}`)
      check('topic focus retrieves the Solar System doc', srcDocs.has(docB), JSON.stringify([...srcDocs]))
      check('ring answer cites Saturn material', /ring/i.test(b.reply ?? ''))
    }

    // ══ EXTRA: conversation history persists with truthful labels ══
    log('\n════ EXTRA — history persistence & label normalization ══')
    {
      const h = await jfetch<{ turns: { role: string; grounding: string | null; sources: unknown[] }[] }>(`/api/riishe/chat?guestId=${guestA}&documentId=${docA}`)
      const assistants = h.body.turns.filter(t => t.role === 'assistant')
      check('history returns turns', assistants.length > 0)
      check('every persisted assistant turn has a valid grounding label', assistants.every(t => ['document', 'mixed', 'general'].includes(t.grounding as string)), JSON.stringify(assistants.map(t => t.grounding)))
      check('persisted turns carry their sources', assistants.every(t => Array.isArray(t.sources)))
    }

    // ══ EXTRA: BEAN Intelligence chat — documentId retrieval + source state ══
    log('\n════ EXTRA — BEAN chat: uploaded-document grounding ══')
    {
      const excerpt = constPages.join(' ').slice(0, 2000)
      const r = await jfetch<{ reply: string; sourceState: string; sources: { title: string }[] }>('/api/bean/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestId: guestA,
          messages: [{ role: 'user', content: 'Which article governs amendments, according to my document?' }],
          context: { documentId: docA, documentTitle: 'Constitution Study Notes', documentExcerpt: excerpt, documentPagesRead: 'pages 1–3' },
          settings: { style: 'exam-focused', showSourceContext: true },
        }),
      })
      log(`  sourceState=${r.body.sourceState} sources=${JSON.stringify(r.body.sources?.map(s => s.title))}`)
      log(`  reply: ${r.body.reply?.slice(0, 220)}`)
      check('BEAN chat returns 200', r.status === 200)
      check('BEAN chat is document-grounded on the uploaded doc', r.body.sourceState === 'document', `got ${r.body.sourceState}`)
      check('BEAN chat names the document as a source', (r.body.sources ?? []).some(s => /Constitution Study Notes/.test(s.title)))
      check('BEAN tag stripped', !/\[SOURCES:/i.test(r.body.reply ?? ''))

      const g = await jfetch<{ reply: string; sourceState: string }>('/api/bean/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestId: guestA,
          messages: [{ role: 'user', content: 'Give me a two-line revision plan for percentages.' }],
          context: { attemptSummary: 'Scored 4/8 on Percentages basics.' },
          settings: { style: 'exam-focused', showSourceContext: true },
        }),
      })
      check('BEAN chat without material → general', g.body.sourceState === 'general', `got ${g.body.sourceState}`)
      log(`  general-state reply: ${g.body.reply?.slice(0, 140)}`)

      const stranger = await jfetch<{ error?: string }>('/api/bean/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestId: guestB,
          messages: [{ role: 'user', content: 'hi' }],
          context: { documentId: docA },
          settings: { style: 'exam-focused', showSourceContext: true },
        }),
      })
      check('BEAN chat refuses another guest\'s documentId (404)', stranger.status === 404, `got ${stranger.status}`)
    }

    // ══ EXTRA: document-scoped workspace chat grounded in exactly that doc ══
    log('\n════ EXTRA — document scope isolation (owner) ══')
    {
      const r = await chat(guestA, {
        documentId: docB,
        messages: [{ role: 'user', content: 'Which article governs the amendment of the Constitution?' }],
      })
      const b = r.body as ChatReply
      const srcDocs = new Set((b.sources ?? []).map(s => s.documentId))
      log(`  grounding=${b.grounding} sources=${JSON.stringify([...srcDocs])}`)
      check('solar-system doc scope never pulls the constitution doc', !srcDocs.has(docA), JSON.stringify([...srcDocs]))
      check('unrelated question in doc scope is honest', b.grounding !== 'document' || srcDocs.has(docB))
    }
  } finally {
    // ── Cleanup: delete every trace of the three test guests ──
    for (const g of [guestA, guestB, guestC]) {
      const del = await jfetch<{ ok: boolean; deleted: Record<string, number> }>('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guestId: g }),
      })
      log(`cleanup ${g}: ok=${del.body?.ok} deleted=${JSON.stringify(del.body?.deleted ?? {})}`)
    }
    await rm('/tmp/riishe-chat-fixtures', { recursive: true, force: true }).catch(() => {})
  }

  log(`\n════ RESULT: ${pass} passed, ${fail} failed ══`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('E2E FATAL', e); process.exit(1) })
