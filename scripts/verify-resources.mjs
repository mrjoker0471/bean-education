// Verifies every resource URL with a real HTTP request from this environment
// and writes src/data/resource-verification.json consumed by the seeder.
// Uses curl (matches real browser reachability better than fetch here).
// Usage: bun scripts/verify-resources.mjs
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { RESOURCES, EXAM_RESOURCES } from '../src/data/resources.ts'
import { OFFICIAL_DOCS } from '../src/data/official-docs.ts'

const all = [...RESOURCES, ...EXAM_RESOURCES, ...OFFICIAL_DOCS]
const urls = [...new Set(all.map(r => r.url))]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const out = {}
for (const url of urls) {
  let status = 'UNREACHABLE', code = 0
  try {
    const res = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-L', '--max-time', '15', '-A', UA, url], { encoding: 'utf8' })
    code = parseInt(res.trim(), 10) || 0
    if (code >= 200 && code < 400) status = 'VERIFIED'
    else if (code === 429 || code === 403) status = 'PENDING_REVIEW'
    else status = 'UNREACHABLE'
  } catch {
    status = 'UNREACHABLE'
  }
  out[url] = { status, code, checkedAt: new Date().toISOString() }
  console.log(`${status.padEnd(15)} ${code || '---'}  ${url}`)
}

writeFileSync(new URL('../src/data/resource-verification.json', import.meta.url), JSON.stringify(out, null, 2))
const counts = Object.values(out).reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})
console.log('SUMMARY', counts)
