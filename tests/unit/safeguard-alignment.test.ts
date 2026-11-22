// ─── Safeguard alignment tests (Phase 3A) ─────────────────────────────────────
// Static, source-level regression guards — comments can't fool them because
// they scan stripped source text:
//   1. Verified practice draws ONLY from VERIFIED questions (UNVERIFIED and
//      REJECTED PYQ rows are excluded from every selection path).
//   2. The pyq mutating routes carry the sameOrigin CSRF guard like every
//      other mutating BEAN route.
//   3. NO route anywhere can write PYQ_VERIFIED except /api/pyq/review, and
//      promotion endpoints can never set it.
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

const API_DIR = 'src/app/api'

describe('SELECTABLE_QUESTION — verified practice draws only VERIFIED rows', () => {
  const src = stripComments(readFileSync('src/app/api/tests/start/route.ts', 'utf8'))
  test('the selection filter is exactly verificationStatus: VERIFIED', () => {
    expect(src).toContain("SELECTABLE_QUESTION = { verificationStatus: 'VERIFIED' }")
    expect(src).not.toContain("verificationStatus: { not: 'REJECTED' }")
  })
  test('the filter constant feeds every selection (single definition, used)', () => {
    const uses = src.match(/SELECTABLE_QUESTION/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(6) // definition + topic/subject/revision/exam/final selection
  })
})

describe('CSRF guard on PYQ mutations (Phase 3A hardening)', () => {
  test('/api/pyq/review and /api/pyq/import call sameOrigin', () => {
    for (const route of ['src/app/api/pyq/review/route.ts', 'src/app/api/pyq/import/route.ts']) {
      const src = stripComments(readFileSync(route, 'utf8'))
      expect(src).toContain('if (!sameOrigin(req))')
    }
  })
  test('the new Phase 3A mutating routes also call sameOrigin', () => {
    for (const route of ['src/app/api/pyq/candidates/[id]/promote/route.ts', 'src/app/api/pyq/candidates/[id]/discard/route.ts']) {
      const src = stripComments(readFileSync(route, 'utf8'))
      expect(src).toContain('if (!sameOrigin(req))')
    }
  })
})

describe('AI never verifies — no code path outside /api/pyq/review writes PYQ_VERIFIED', () => {
  const allApi = walk(API_DIR)
  test("the write pattern sourceType: 'PYQ_VERIFIED' exists ONLY in the curator review route", () => {
    const writers = allApi.filter(f => stripComments(readFileSync(f, 'utf8')).includes("sourceType: 'PYQ_VERIFIED'"))
    expect(writers).toEqual(['src/app/api/pyq/review/route.ts'])
  })
  test('research + candidates code never touches verificationStatus VERIFIED writes', () => {
    for (const f of walk('src/lib/riishe').concat(['src/lib/pyq-candidates.ts'])) {
      const src = stripComments(readFileSync(f, 'utf8'))
      expect(src).not.toContain("'PYQ_VERIFIED'")
      expect(src).not.toContain("verificationStatus: 'VERIFIED'")
    }
  })
})
