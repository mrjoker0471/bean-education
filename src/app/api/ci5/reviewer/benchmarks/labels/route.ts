// ─── BEAN Classroom Intelligence (CI-5F): expert reference labels ─────────────
// POST /api/ci5/reviewer/benchmarks/labels — a qualified ACTIVE reviewer adds
// an expert reference label (expected result + accepted alternatives +
// prohibited conclusions + confidence + ambiguity). Scope is re-checked
// server-side for domain- and language-scoped datasets. Blind-holdout labels
// are refused through this path (sealed until scoring).

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { addExpertCaseLabel, benchmarkDbFromPrisma } from '@/lib/ci/fleet/expert-benchmarks'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 403 })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await addExpertCaseLabel(benchmarkDbFromPrisma(db), profile, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ label: { id: result.value.id, caseKey: result.value.caseKey, rubricVersion: result.value.rubricVersion } }, { status: 201 })
  } catch (err) {
    console.error('[api/ci5/reviewer/benchmarks/labels POST]', err)
    return NextResponse.json({ error: 'Could not record the expert label — please try again.' }, { status: 500 })
  }
}
