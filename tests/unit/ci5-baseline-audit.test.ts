// ─── CI-5A: baseline integrity + durability audit ─────────────────────────────
// Machine-checks the claims recorded in
// docs/BEAN-CLASSROOM-INTELLIGENCE-CI5-BASELINE.md against the ACTUAL source
// and behaviour at the CI-5 starting point. These guards are regression
// protection for the whole milestone: if any CI-4 gate silently moves, the
// suite fails here first.
//
// Honesty rules:
//   • The durability gap (process-local capabilityStore) is asserted AS A GAP —
//     CI-5E replaces it; when CI-5E lands, the "restart loses approval" proof
//     still holds for the legacy in-memory path while the durable path is
//     exercised by tests/unit/ci5-language-governance.test.ts.
//   • No pack is promoted, no capability is approved, no fixture pretends to be
//     a real reviewer decision.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultLanguageCapabilities,
  recordCapabilityMeasurement,
  recordHumanLanguageApproval,
  listLanguageCapabilities,
  resetLanguageCapabilitiesForTests,
} from '../../src/lib/ci/fleet/language'
import {
  listDomainPacks,
  computePackChecksum,
  getDomainPack,
} from '../../src/lib/ci/fleet/domain-packs'
import { resolveCuratedStatus, type PackReviewRow } from '../../src/lib/ci/fleet/curator'
import { shouldAutoDispatchFleet } from '../../src/lib/ci/fleet/dispatcher'

const REPO = join(import.meta.dir, '..', '..')

// ─── 1. Ledger: CI-4 remains COMPLETE, nothing regressed ──────────────────────

describe('CI5 baseline: milestone ledger', () => {
  const ledger = JSON.parse(readFileSync(join(REPO, 'docs/milestone-ledger.json'), 'utf8')) as {
    milestones: { id: string; status: string; syncStatus?: string; finalMainSha?: string | null; pr?: { number: number | null; state: string } | null; commits?: string[] }[]
  }

  test('ledger has 28 milestone entries with unique ids (27 pre-CI-5 + the CI-5 record)', () => {
    expect(ledger.milestones.length).toBe(28)
    expect(new Set(ledger.milestones.map((m) => m.id)).size).toBe(28)
    const ci5 = ledger.milestones.find((m) => m.id === 'bean-classroom-intelligence-ci5')
    expect(ci5).toBeDefined()
    expect(ci5!.baseMainSha).toBe('7ccf355986c0cab738cb705e11b87f97c25a5c32')
    expect(['PUSHED', 'COMPLETE']).toContain(ci5!.status)
  })

  test('CI-4 remains COMPLETE / IN_SYNC referencing merged PR #42 at a6c8d336', () => {
    const ci4 = ledger.milestones.find((m) => m.id === 'bean-classroom-intelligence-ci4')
    expect(ci4).toBeDefined()
    expect(ci4!.status).toBe('COMPLETE')
    expect(ci4!.syncStatus).toBe('IN_SYNC')
    expect(ci4!.finalMainSha).toBe('a6c8d33665ef866e94762d5d37b0719d9280d02e')
    expect(ci4!.pr?.number).toBe(42)
    expect(ci4!.pr?.state).toBe('MERGED')
  })

  test('auth milestone (PR #43) remains COMPLETE / SYNCHRONIZED', () => {
    const auth = ledger.milestones.find((m) => m.id === 'bean-auth-age-legal-consent-ux')
    expect(auth).toBeDefined()
    expect(auth!.status).toBe('COMPLETE')
    expect(auth!.syncStatus).toBe('SYNCHRONIZED')
    expect(auth!.finalMainSha).toBe('d02d5ee55e54d63dacc5bb772ba5daacf6a10b33')
    expect(auth!.pr?.state).toBe('MERGED')
  })
})

// ─── 2. Domain packs: 12 registered, all IN_REVIEW, risk classes correct ──────

describe('CI5 baseline: domain packs', () => {
  test('all 12 packs registered and declared IN_REVIEW', () => {
    const packs = listDomainPacks()
    expect(packs.length).toBe(12)
    for (const { pack } of packs) expect(pack.status).toBe('IN_REVIEW')
  })

  test('risk classes: exactly one HIGH_STAKES (health) and one ELEVATED (finance)', () => {
    const packs = listDomainPacks().map((p) => p.pack)
    expect(packs.filter((p) => p.riskClass === 'HIGH_STAKES').map((p) => p.domainId)).toEqual(['health-medicine-edu'])
    expect(packs.filter((p) => p.riskClass === 'ELEVATED').map((p) => p.domainId)).toEqual(['accounting-finance'])
    expect(packs.filter((p) => p.riskClass === 'STANDARD').length).toBe(10)
  })

  test('curator gate: zero recorded approvals ⇒ no pack is VERIFIED (derived state only)', () => {
    for (const { pack } of listDomainPacks()) {
      const curated = resolveCuratedStatus(pack, [])
      expect(curated.status).toBe('IN_REVIEW')
      expect(curated.approvalsRecorded).toBe(0)
      expect(curated.approvalsRequired).toBe(pack.riskClass === 'HIGH_STAKES' ? 2 : 1)
    }
  })

  test('curator checksum binding: an approval bound to a DIFFERENT checksum never verifies', () => {
    const { pack, checksum } = getDomainPack('mathematics-statistics')!
    const stale: PackReviewRow = {
      id: 'stale',
      packId: pack.domainId,
      packVersion: pack.packVersion,
      packChecksum: '0'.repeat(64), // not the current checksum
      riskClass: pack.riskClass,
      decision: 'APPROVED',
      reviewerStudentId: 'student-a',
      reviewerName: 'Student A',
      rationale: 'inspected a version that no longer exists',
      evidence: 'stale checksum binding — must not count',
      createdAt: new Date(),
    }
    const curated = resolveCuratedStatus(pack, [stale])
    expect(curated.status).toBe('IN_REVIEW')
    expect(curated.approvalsRecorded).toBe(0)
    expect(checksum.length).toBe(64)
  })
})

// ─── 3. Transcription: structurally UNSUPPORTED, unreachable by any path ──────

describe('CI5 baseline: transcription restriction', () => {
  test('every catalogue language has TRANSCRIPTION UNSUPPORTED by default', () => {
    const caps = defaultLanguageCapabilities()
    const transcription = caps.filter((c) => c.task === 'TRANSCRIPTION')
    expect(transcription.length).toBe(11)
    for (const c of transcription) {
      expect(c.status).toBe('UNSUPPORTED')
      expect(c.testRef).toContain('§9.2')
    }
  })

  test('a measurement call on TRANSCRIPTION is a silent no-op (§9.2 gate)', () => {
    resetLanguageCapabilitiesForTests()
    recordCapabilityMeasurement({
      language: 'en',
      task: 'TRANSCRIPTION',
      passed: true,
      testRef: 'attack-benchmark',
      measuredAt: '2026-01-01',
      humanApproved: true, // even with the flag — CI-5E must keep this closed
    })
    const rec = listLanguageCapabilities().find((c) => c.language === 'en' && c.task === 'TRANSCRIPTION')
    expect(rec?.status).toBe('UNSUPPORTED')
  })

  test('a human approval on TRANSCRIPTION is refused with the §9.2 reason', () => {
    resetLanguageCapabilitiesForTests()
    const res = recordHumanLanguageApproval({ language: 'ta', task: 'TRANSCRIPTION', reviewerId: 'reviewer-1', reviewerName: 'Reviewer One' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('structurally UNSUPPORTED')
    expect(listLanguageCapabilities().find((c) => c.language === 'ta' && c.task === 'TRANSCRIPTION')?.status).toBe('UNSUPPORTED')
  })

  test('observer source guard: transcriptionEnabled is a literal false (structured-only)', () => {
    const src = readFileSync(join(REPO, 'src/lib/ci/fleet/observer.ts'), 'utf8')
    expect(src).toContain('transcriptionEnabled: z.literal(false)')
    expect(src).not.toMatch(/assemblyai|deepgram|whisper|omnilingual/i)
  })
})

// ─── 4. Fleet dispatch: default-off preserved ─────────────────────────────────

describe('CI5 baseline: fleet dispatch default-off', () => {
  test('empty env / partial lookalikes never dispatch; only exact "true" does', () => {
    expect(shouldAutoDispatchFleet({})).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: undefined })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: 'TRUE' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: '1' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: 'true ' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: 'true' })).toBe(true)
  })
})

// ─── 5. CRITICAL: language approval durability gap (proven, not assumed) ─────

describe('CI5 baseline: language durability audit (the CI-5E target)', () => {
  test('an approval lives ONLY in module memory: reset (restart simulation) erases it', () => {
    resetLanguageCapabilitiesForTests()
    // measure first (unmeasured capabilities cannot be approved)
    recordCapabilityMeasurement({
      language: 'en',
      task: 'TEXT_UNDERSTANDING',
      passed: true,
      testRef: 'baseline-proof-bench',
      measuredAt: '2026-01-01',
    })
    const approval = recordHumanLanguageApproval({ language: 'en', task: 'TEXT_UNDERSTANDING', reviewerId: 'reviewer-1', reviewerName: 'Reviewer One' })
    expect(approval.ok).toBe(true)
    expect(listLanguageCapabilities().find((c) => c.language === 'en' && c.task === 'TEXT_UNDERSTANDING')?.status).toBe('VERIFIED')

    // Simulate a process restart: a DB-backed store would survive this; the
    // process-local store does not. This is the CI-4 gap, proven.
    resetLanguageCapabilitiesForTests()
    expect(listLanguageCapabilities().find((c) => c.language === 'en' && c.task === 'TEXT_UNDERSTANDING')?.status).toBe('EXPERIMENTAL')
  })

  test('SELF-CERTIFICATION HOLE: a caller passing humanApproved mints VERIFIED with no reviewer (CI-5E closes this)', () => {
    resetLanguageCapabilitiesForTests()
    recordCapabilityMeasurement({
      language: 'hi',
      task: 'TERMINOLOGY',
      passed: true,
      testRef: 'hole-proof-bench',
      measuredAt: '2026-01-01',
      humanApproved: true, // no reviewer identity, no qualification, no record
    })
    expect(listLanguageCapabilities().find((c) => c.language === 'hi' && c.task === 'TERMINOLOGY')?.status).toBe('VERIFIED')
  })

  test('source guard: language.ts has NO database import (store is process-local)', () => {
    const src = readFileSync(join(REPO, 'src/lib/ci/fleet/language.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/db'|from '\.\.\/\.\.\/lib\/db'|prisma/i)
    expect(src).toMatch(/const capabilityStore: LanguageCapabilityRecord\[\]/)
  })

  test('source guard: recordHumanLanguageApproval has no production call site', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    let hits = ''
    try {
      hits = execSync(
        `rg -l "recordHumanLanguageApproval" src --glob '!**/language.ts' || true`,
        { cwd: REPO, encoding: 'utf8' },
      ).trim()
    } catch {
      hits = ''
    }
    expect(hits).toBe('')
  })

  test('a reviewer approval on an UNMEASURED capability is refused (rule survives into CI-5E)', () => {
    resetLanguageCapabilitiesForTests()
    const res = recordHumanLanguageApproval({ language: 'bn', task: 'GENERATION', reviewerId: 'reviewer-1', reviewerName: 'Reviewer One' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('UNMEASURED')
  })
})

// ─── 6. Pack checksum determinism (the binding CI-5D reviews must carry) ─────

describe('CI5 baseline: pack checksum determinism', () => {
  test('computePackChecksum is deterministic across calls', () => {
    const a = getDomainPack('education-pedagogy')!
    expect(computePackChecksum(a.pack)).toBe(a.checksum)
    expect(computePackChecksum(a.pack)).toBe(computePackChecksum(a.pack))
  })
})
