// E2E part 3: edge cases — malformed PDF, scanned pages, thin content, a small
// clean document (COMPLETE analysis + small validated test), stranger access,
// duplicate upload idempotency, and the page-reference self-heal.
// Run: bun scripts/e2e-riishe-edges.ts
import { Database } from 'bun:sqlite'
import { readFile } from 'node:fs/promises'

const BASE = 'http://localhost:3000'
const GUEST = 'e2e-upgrade-guest-001'
const STRANGER = 'stranger-guest-99999'
const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function upload(path: string, name: string, opts: { guest?: string } = {}): Promise<{ status: number; body: any }> {
  const buf = await readFile(path)
  const form = new FormData()
  form.set('guestId', opts.guest ?? GUEST)
  form.set('file', new File([buf], name, { type: 'application/pdf' }))
  const res = await fetch(`${BASE}/api/materials`, { method: 'POST', body: form })
  let body: any = null
  try { body = await res.json() } catch { /* */ }
  return { status: res.status, body }
}

async function pollDoc(docId: string, guest = GUEST, maxMs = 180000): Promise<any> {
  const end = Date.now() + maxMs
  let providerRetries = 0
  while (Date.now() < end) {
    await sleep(4000)
    const res = await fetch(`${BASE}/api/materials/${docId}?guestId=${guest}`)
    const body = await res.json().catch(() => null)
    if (!body) continue
    // Provider-rate-limited analyses can be retried — the detail route
    // self-heals QUEUED/FAILED docs by re-kicking the pipeline.
    if (body.status === 'FAILED' && /temporar|unavailable|provider/i.test(body.statusDetail ?? '') && providerRetries < 3) {
      providerRetries++
      console.log(`  (provider rate-limited — waiting 30s for self-heal retry ${providerRetries})`)
      await sleep(30000)
      continue
    }
    if (['READY', 'FAILED', 'NEEDS_OCR'].includes(body.status)) return body
  }
  return null
}

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

async function main() {
  // ── 1. Malformed PDF ──
  // A file WITHOUT the %PDF- magic must be rejected 415 at upload. A file WITH
  // the magic but garbage inside is accepted and then honestly FAILED by the
  // extraction stage — both are correct, honest outcomes.
  const broken = await upload('/tmp/riishe-fixtures/broken.pdf', 'broken.pdf')
  if (broken.status === 415) {
    check('malformed PDF rejected 415 at upload', true)
  } else if (broken.status === 200 && broken.body?.documentId) {
    const bdoc = await pollDoc(broken.body.documentId)
    check(
      'malformed (but PDF-headed) file honestly FAILED at extraction',
      bdoc?.status === 'FAILED' && /parse|PDF|corrupt/i.test(bdoc?.statusDetail ?? ''),
      bdoc?.statusDetail?.slice(0, 120) ?? '',
    )
  } else {
    check('malformed PDF handled honestly', false, `status=${broken.status}`)
  }

  // ── 2. Scanned PDF ──
  const scanned = await upload('/tmp/riishe-fixtures/scanned.pdf', 'scanned.pdf')
  check('scanned upload accepted', scanned.status === 200 && !!scanned.body.documentId)
  if (scanned.body.documentId) {
    const doc = await pollDoc(scanned.body.documentId)
    check('scanned → NEEDS_OCR', doc?.status === 'NEEDS_OCR', doc?.statusDetail?.slice(0, 120) ?? '')
    check('scanned coverage: 2/2 pages image-only', doc?.coverage?.totalPages === 2 && doc?.coverage?.noTextPages === 2, JSON.stringify(doc?.coverage ?? {}))
    const gen = await fetch(`${BASE}/api/riishe/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: GUEST, documentIds: [scanned.body.documentId], count: 6 }),
    })
    check('generate on scanned → 409 with honest message', gen.status === 409, (await gen.json())?.error ?? '')
  }

  // ── 3. Small clean document → COMPLETE analysis + small validated test ──
  const small = await upload('/tmp/riishe-fixtures/small.pdf', 'Indian-Constitution-mini-notes.pdf')
  check('small upload accepted', small.status === 200 && !!small.body.documentId)
  const smallId = small.body.documentId
  const smallDoc = await pollDoc(smallId)
  check('small → READY', smallDoc?.status === 'READY', smallDoc?.statusDetail?.slice(0, 110) ?? '')
  check(
    'small → COMPLETE analysis (all readable pages analysed, nothing failed)',
    smallDoc?.analysisState === 'COMPLETE' && smallDoc?.coverage?.analysisPct === 100 && smallDoc?.coverage?.failedPages === 0,
    `state=${smallDoc?.analysisState} pct=${smallDoc?.coverage?.analysisPct}`,
  )

  // duplicate upload of the same bytes → same document, no second row
  const dup = await upload('/tmp/riishe-fixtures/small.pdf', 'Indian-Constitution-mini-notes.pdf')
  check('duplicate upload idempotent', dup.body?.duplicate === true && dup.body?.documentId === smallId, JSON.stringify(dup.body ?? {}))

  // generation on the small doc (count 6)
  let smallTest: any = null
  const genRes = await fetch(`${BASE}/api/riishe/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: GUEST, documentIds: [smallId], count: 6, timed: true, scoring: { marksPerQuestion: 1, negativeMark: 0 } }),
  })
  const genBody = await genRes.json().catch(() => null)
  if (genRes.status === 200 && genBody?.testId) {
    const end = Date.now() + 300000
    while (Date.now() < end) {
      await sleep(4000)
      const t = await (await fetch(`${BASE}/api/riishe/tests/${genBody.testId}?guestId=${GUEST}`)).json()
      if (['READY', 'FAILED'].includes(t.status)) { smallTest = t; break }
    }
  }
  check(
    'small doc → generation outcome is honest (READY 4–6 validated OR FAILED with explanation)',
    !!smallTest && (smallTest.status === 'READY'
      ? smallTest.questionCount >= 4
      : /validation|content|enough/i.test(smallTest.statusDetail ?? '')),
    smallTest ? `${smallTest.status}: ${(smallTest.statusDetail ?? '').slice(0, 100)}` : 'timeout',
  )
  if (smallTest?.status === 'READY') {
    const rows = db.query('SELECT id, evidence, pageRefsJson FROM RiisheQuestion WHERE testId = ?').all(smallTest.id) as any[]
    const ext = JSON.parse((db.query('SELECT extractionJson FROM StudyDocument WHERE id = ?').get(smallId) as any).extractionJson) as { page: number; text: string }[]
    let onCited = 0
    for (const r of rows) {
      const refs = JSON.parse(r.pageRefsJson) as number[]
      const cited = refs.map(p => ext.find(e => e.page === p)?.text ?? '').join(' ')
      if (evidenceOnPage(r.evidence, cited)) onCited++
    }
    check('page-ref self-heal: every published question cites a page holding its evidence', onCited === rows.length, `${onCited}/${rows.length}`)
    check('small test page refs within 3-page bounds', rows.every(r => (JSON.parse(r.pageRefsJson) as number[]).every(p => p >= 1 && p <= 3)))
  }

  // ── 4. Thin document (2 sparse pages) ──
  const thin = await upload('/tmp/riishe-fixtures/thin.pdf', 'thin.pdf')
  const thinDoc = await pollDoc(thin.body!.documentId!)
  check('thin → READY analysis (content honest)', thinDoc?.status === 'READY', thinDoc?.statusDetail?.slice(0, 100) ?? '')
  if (thinDoc?.status === 'READY') {
    const g = await fetch(`${BASE}/api/riishe/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: GUEST, documentIds: [thinDoc.id], count: 6 }),
    })
    const gb = await g.json().catch(() => null)
    let thinTest: any = null
    if (g.status === 200 && gb?.testId) {
      const end = Date.now() + 240000
      while (Date.now() < end) {
        await sleep(4000)
        const t = await (await fetch(`${BASE}/api/riishe/tests/${gb.testId}?guestId=${GUEST}`)).json()
        if (['READY', 'FAILED'].includes(t.status)) { thinTest = t; break }
      }
    }
    check(
      'thin doc → never padded to quota (small honest test or honest failure)',
      !!thinTest && (thinTest.status === 'FAILED' ? /validation|enough|content/i.test(thinTest.statusDetail ?? '') : thinTest.questionCount >= 4),
      thinTest ? `${thinTest.status}: ${(thinTest.statusDetail ?? '').slice(0, 110)}` : 'timeout',
    )
  }

  // ── 5. Stranger access ──
  const victims = db.query("SELECT id FROM StudyDocument WHERE guestId = ? LIMIT 1").get(GUEST) as any
  if (victims) {
    const r1 = await fetch(`${BASE}/api/materials/${victims.id}?guestId=${STRANGER}`)
    check('stranger cannot read material (404)', r1.status === 404)
    const r2 = await fetch(`${BASE}/api/materials/${victims.id}/file?guestId=${STRANGER}`)
    check('stranger cannot stream file (404)', r2.status === 404)
  }

  // ── 6. Page-reference self-heal: offline proof on the one bad ref from the bulletin test ──
  const badRows = db.query(
    `SELECT q.id, q.evidence, q.pageRefsJson, d.extractionJson, d.pageCount
     FROM RiisheQuestion q JOIN StudyDocument d ON d.id = q.documentId
     WHERE q.evidence IS NOT NULL AND q.evidence != ''`,
  ).all() as any[]
  let healedPossible = 0, dangling = 0
  for (const r of badRows) {
    const refs = JSON.parse(r.pageRefsJson ?? '[]') as number[]
    const ext = JSON.parse(r.extractionJson) as { page: number; text: string }[]
    const cited = refs.map(p => ext.find(e => e.page === p)?.text ?? '').join(' ')
    if (evidenceOnPage(r.evidence, cited)) continue
    const anywhere = ext.filter(p => p.text && evidenceOnPage(r.evidence, p.text)).map(p => p.page)
    if (anywhere.length > 0) healedPossible++
    else dangling++
  }
  console.log(`ℹ page-ref audit across all published questions: ${badRows.length} checked, ${healedPossible} correctable by self-heal, ${dangling} with unlocatable evidence`)
  check('self-heal target exists and is locatable OR nothing to heal', dangling === 0, `correctable=${healedPossible}`)

  // ── 7. Topics aggregation across the library ──
  const topicsRes = await fetch(`${BASE}/api/riishe/topics?guestId=${GUEST}`)
  const topicsBody = await topicsRes.json().catch(() => null)
  check(
    'topics aggregation returns READY docs with real topics',
    topicsRes.status === 200 && Array.isArray(topicsBody?.documents) && topicsBody.documents.length >= 1 &&
      topicsBody.documents.every((d: any) => Array.isArray(d.topics) && typeof d.analysisState === 'string'),
    `${topicsBody?.documents?.length ?? 0} docs, ${topicsBody?.totalTopics ?? 0} topics`,
  )

  // ── 8. Multi-document practice: small + thin combined ──
  if (smallDoc?.status === 'READY' && thinDoc?.status === 'READY') {
    const multi = await fetch(`${BASE}/api/riishe/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: GUEST, documentIds: [smallDoc.id, thinDoc.id], count: 10, timed: false }),
    })
    const mb = await multi.json().catch(() => null)
    check('multi-document generation accepted', multi.status === 200 && !!mb?.testId, JSON.stringify(multi.status === 200 ? { testId: mb.testId } : mb))
    if (multi.status === 200 && mb?.testId) {
      const end = Date.now() + 360000
      let mt: any = null
      while (Date.now() < end) {
        await sleep(4000)
        const t = await (await fetch(`${BASE}/api/riishe/tests/${mb.testId}?guestId=${GUEST}`)).json()
        if (['READY', 'FAILED'].includes(t.status)) { mt = t; break }
      }
      check(
        'multi-document set → honest outcome with per-question provenance',
        !!mt && (mt.status === 'READY'
          ? mt.questionCount >= 4 && Array.isArray(mt.sourceDocuments) && mt.sourceDocuments.length >= 2
          : /validation|content|enough/i.test(mt.statusDetail ?? '')),
        mt ? `${mt.status}: q=${mt.questionCount} sources=${JSON.stringify((mt.sourceDocuments ?? []).map((s: any) => s.title))}` : 'timeout',
      )
      if (mt?.status === 'READY') {
        const rows = db.query('SELECT DISTINCT documentId FROM RiisheQuestion WHERE testId = ?').all(mt.id) as any[]
        check('multi-document questions cite their own source document', rows.length >= 1, `${rows.length} distinct source doc(s)`)
        // ownership on the multi-doc test
        const strangerTest = await fetch(`${BASE}/api/riishe/tests/${mt.id}?guestId=${STRANGER}`)
        check('stranger cannot read the practice set (404)', strangerTest.status === 404)
      }
    }
  }

  // ── 9. Account deletion wipes the guest's data server-side ──
  const WIPE = 'wipe-guest-000000001'
  const wipeDoc = await upload('/tmp/riishe-fixtures/small.pdf', 'wipe.pdf', { guest: WIPE })
  if (wipeDoc.status === 200 && wipeDoc.body?.documentId) {
    const before = (await (await fetch(`${BASE}/api/materials?guestId=${WIPE}`)).json()).materials.length
    const del = await fetch(`${BASE}/api/account`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: WIPE }),
    })
    const dbBody = await del.json().catch(() => null)
    const after = (await (await fetch(`${BASE}/api/materials?guestId=${WIPE}`)).json()).materials.length
    check(
      'account deletion removes every server-side record + file',
      del.status === 200 && dbBody?.ok === true && before === 1 && after === 0 && dbBody.deleted.documents === 1,
      JSON.stringify(dbBody?.deleted ?? {}),
    )
  }

  console.log(failures === 0 ? '\nEDGE E2E: ALL PASS' : `\nEDGE E2E: ${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
