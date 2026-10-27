// Provider-independent subset of the chat E2E: cross-student access control.
// These paths return 404/empty BEFORE any provider call, so they run even
// during a provider outage. Run: bun scripts/e2e-chat-access.ts
import { writeFile, readFile, rm, mkdir } from 'node:fs/promises'

const BASE = 'http://localhost:3000'
const uuid = () => crypto.randomUUID()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function jfetch<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, init)
  let body: unknown = null
  try { body = await res.json() } catch { /* */ }
  return { status: res.status, body: body as T }
}

function buildPdf(pages: string[]): Buffer {
  const objects: string[] = []
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`)
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

async function main() {
  const owner = `chat-e2e-${uuid()}`
  const stranger = `chat-e2e-${uuid()}`
  try {
    // Upload as owner (extraction is local; analysis may stay pending — ownership checks don't care)
    const dir = '/tmp/riishe-chat-fixtures'
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    await mkdir(dir, { recursive: true })
    await writeFile(`${dir}/private.pdf`, buildPdf(['Private internal notes about Article 368 amendment procedure of the Constitution. '.repeat(8)]))
    const buf = await readFile(`${dir}/private.pdf`)
    const form = new FormData()
    form.set('guestId', owner)
    form.set('file', new File([buf], 'private.pdf', { type: 'application/pdf' }))
    const up = await jfetch<{ documentId?: string }>('/api/materials', { method: 'POST', body: form })
    if (up.status !== 200 || !up.body.documentId) throw new Error('upload failed')
    const docId = up.body.documentId
    console.log(`owner doc: ${docId}`)

    console.log('\n── CASE 9 (subset): cross-student access control ──')
    const docScoped = await jfetch('/api/riishe/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: stranger, documentId: docId, messages: [{ role: 'user', content: 'Summarise this document.' }] }),
    })
    check('stranger chat on private document → 404', docScoped.status === 404, `got ${docScoped.status}`)

    const hist = await jfetch<{ turns: unknown[] }>(`/api/riishe/chat?guestId=${stranger}&documentId=${docId}`)
    check('stranger chat history for private document → empty', hist.status === 200 && hist.body.turns.length === 0)

    const qScope = await jfetch('/api/riishe/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: stranger, attemptId: 'no-such-attempt', questionId: 'no-such-question', messages: [{ role: 'user', content: 'hi' }] }),
    })
    check('stranger attempt/question chat → 404', qScope.status === 404, `got ${qScope.status}`)

    const beanStranger = await jfetch('/api/bean/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestId: stranger, messages: [{ role: 'user', content: 'hi' }], context: { documentId: docId }, settings: { style: 'simple', showSourceContext: true } }),
    })
    check('BEAN chat refuses another guest documentId → 404', beanStranger.status === 404, `got ${beanStranger.status}`)

    const strangerFile = await fetch(`${BASE}/api/materials/${docId}/file?guestId=${stranger}`)
    check('stranger cannot stream the private file', strangerFile.status === 404, `got ${strangerFile.status}`)
  } finally {
    for (const g of [owner, stranger]) {
      const del = await jfetch<{ ok: boolean }>('/api/account', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guestId: g }) })
      console.log(`cleanup ${g.slice(0, 18)}…: ok=${del.body?.ok}`)
    }
    await rm('/tmp/riishe-chat-fixtures', { recursive: true, force: true }).catch(() => {})
  }
  console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
