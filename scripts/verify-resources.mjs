// Verifies every resource URL with a real HTTP request from this environment
// and writes src/data/resource-verification.json consumed by the seeder.
// Uses curl (matches real browser reachability better than fetch here).
// For entries claiming fileKind: 'PDF', the response content-type must actually
// be application/pdf — ordinary webpages are never allowed to masquerade as PDFs
// (they get downgraded to PENDING_REVIEW so the UI stays honest).
// Usage: bun scripts/verify-resources.mjs
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { RESOURCES, EXAM_RESOURCES } from '../src/data/resources.ts'
import { OFFICIAL_DOCS } from '../src/data/official-docs.ts'

const all = [...RESOURCES, ...EXAM_RESOURCES, ...OFFICIAL_DOCS]
const urls = [...new Set(all.map(r => r.url))]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const claimsPdf = new Map()
for (const r of all) {
  if (r.fileKind === 'PDF') claimsPdf.set(r.url, r.title)
}

const out = {}
for (const url of urls) {
  let status = 'UNREACHABLE', code = 0
  try {
    const res = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}\t%{content_type}', '-L', '--max-time', '20', '-A', UA, url], { encoding: 'utf8' })
    const [codeStr, contentType = ''] = res.trim().split('\t')
    code = parseInt(codeStr, 10) || 0
    if (code >= 200 && code < 400) status = 'VERIFIED'
    else if (code === 429 || code === 403) status = 'PENDING_REVIEW'
    else status = 'UNREACHABLE'
    // PDF honesty check — a claimed PDF must really be application/pdf
    if (status === 'VERIFIED' && claimsPdf.has(url)) {
      const ct = contentType.toLowerCase()
      if (!ct.includes('application/pdf')) {
        status = 'PENDING_REVIEW'
        console.log(`!! NOT A PDF (content-type ${ct || 'unknown'}) — downgraded to PENDING_REVIEW: ${claimsPdf.get(url)}`)
      }
    }
  } catch {
    status = 'UNREACHABLE'
  }
  out[url] = { status, code, checkedAt: new Date().toISOString() }
  console.log(`${status.padEnd(15)} ${code || '---'}  ${url}`)
}

writeFileSync(new URL('../src/data/resource-verification.json', import.meta.url), JSON.stringify(out, null, 2))
const counts = Object.values(out).reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})
console.log('SUMMARY', counts)
