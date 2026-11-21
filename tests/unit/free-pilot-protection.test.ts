// ─── BEAN Free-pilot protection (Phase 6 regression guard) ───────────────────
// Static guarantees that the trust & quality milestone NEVER introduces
// money: no payment provider, no payment endpoints, no refund logic anywhere
// in Phase 6 flows, and moderation/admin decisions never mutate bookings or
// classes. These are regression guards — if someone adds Razorpay in Phase 8
// they must do it deliberately, not by accident through Trust code.

import { describe, it, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Strip comments so documented phrases like "no refunds" don't false-positive. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const API_ROUTES = walk(join(ROOT, 'src/app/api')).filter((f) => f.endsWith('route.ts'))

describe('free pilot — no payments anywhere', () => {
  it('package.json declares no payment provider dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const offenders = Object.keys(all).filter((k) =>
      /razorpay|stripe|paypal|braintree|cashfree|payu|lemonsqueezy/i.test(k),
    )
    expect(offenders).toEqual([])
  })

  it('.env.example declares no payment credentials', () => {
    let env = ''
    try {
      env = readFileSync(join(ROOT, '.env.example'), 'utf8')
    } catch {
      // .env.example may not exist in some checkouts — absence is also fine.
      return
    }
    expect(env).not.toMatch(/RAZORPAY|STRIPE|PAYPAL|PAYMENT_/i)
  })

  it('no payment/checkout/order/refund route exists under src/app/api', () => {
    const offenders = API_ROUTES.filter((f) =>
      /payment|razorpay|checkout|order|refund|wallet|payout/i.test(f),
    )
    expect(offenders).toEqual([])
  })

  it('Phase 6 code paths contain no payment/refund logic (comments stripped)', () => {
    const phase6Files = [
      'src/lib/trust.ts',
      'src/lib/trust-schema.ts',
      'src/lib/trust-dto.ts',
      'src/lib/trust-quality.ts',
      'src/app/api/teach/complaints/route.ts',
      'src/app/api/teach/complaints/[id]/route.ts',
      'src/app/api/teach/appeals/route.ts',
      'src/app/api/admin/trust/complaints/[id]/action/route.ts',
      'src/app/api/admin/trust/appeals/[appealId]/action/route.ts',
      'src/app/api/admin/trust/teachers/[teacherProfileId]/actions/route.ts',
    ]
    for (const rel of phase6Files) {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
      expect(code).not.toMatch(/razorpay|checkout|createOrder|payment/i)
      // Refunds are a Phase 8 concept — Phase 6 must not even reference
      // refund logic in executable code.
      expect(code).not.toMatch(/refund/i)
    }
  })
})

describe('free pilot — adverse decisions never touch bookings or classes', () => {
  it('review moderation only changes review state — never bookings or classes', () => {
    const code = stripComments(
      readFileSync(join(ROOT, 'src/app/api/admin/trust/reviews/[reviewId]/moderate/route.ts'), 'utf8'),
    )
    expect(code).not.toMatch(/classBooking\.(update|create|delete)/)
    expect(code).not.toMatch(/classSession\.(update|create|delete)/)
    // The only state transition it writes is the review status itself.
    expect(code).toMatch(/classReview\.update/)
  })

  it('complaint case actions never mutate bookings, classes or reviews', () => {
    const code = stripComments(
      readFileSync(join(ROOT, 'src/app/api/admin/trust/complaints/[id]/action/route.ts'), 'utf8'),
    )
    expect(code).not.toMatch(/classBooking\.(update|create|delete)/)
    expect(code).not.toMatch(/classSession\.(update|create|delete)/)
    expect(code).not.toMatch(/classReview\.(update|create|delete)/)
    // And complaints never create trust actions — restrictions are explicit,
    // separately issued admin decisions.
    expect(code).not.toMatch(/trustAction\.create/)
  })

  it('filing a complaint never creates a trust action (complaint route)', () => {
    const code = stripComments(readFileSync(join(ROOT, 'src/app/api/teach/complaints/route.ts'), 'utf8'))
    expect(code).not.toMatch(/trustAction\.create/)
    expect(code).not.toMatch(/trustStateFor/)
  })

  it('a negative review alone never suspends or rejects a teacher (moderate route keep/restore paths)', () => {
    const code = stripComments(
      readFileSync(join(ROOT, 'src/app/api/admin/trust/reviews/[reviewId]/moderate/route.ts'), 'utf8'),
    )
    expect(code).not.toMatch(/teacherProfile\.update/)
    expect(code).not.toMatch(/trustAction\.create/)
  })
})

describe('phase 6 API surface sanity', () => {
  it('no public complaint endpoint exists — complaints live only under guarded paths', () => {
    const complaintRoutes = API_ROUTES.filter((f) => /teachComplaint|complaint/i.test(readFileSync(f, 'utf8')))
    const rels = complaintRoutes.map((f) => relative(join(ROOT, 'src/app/api'), f))
    for (const rel of rels) {
      // Every complaint-touching route must be either teach-scoped (session
      // guarded) or admin-scoped (ADMIN guarded) — never a bare public route.
      expect(rel.startsWith('teach/') || rel.startsWith('admin/')).toBe(true)
    }
    expect(rels.length).toBeGreaterThan(0)
  })
})
