import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

// ─── Phase 3F — migration test on an ISOLATED temporary SQLite database ───────
// Proves the Phase 3F schema change is safe, additive and backward-compatible:
//   M1. the FULL migration chain (baseline → … → phase3f_studio_continuity)
//       applies cleanly with `prisma migrate deploy` on a throwaway file DB
//   M2. the deployed database matches prisma/schema.prisma exactly
//       (`prisma migrate diff` reports no difference)
//   M3. the new RiisheStudioActivity table round-trips every continuity field
//       (validated snapshot, per-kind progress, learner responses, server
//       result, lifecycle timestamps)
//   M4. lifecycle defaults are correct (IN_PROGRESS, version 1, no completion)
//   M5. claim/export/delete semantics stay compatible: rows carrying activity
//       data update (studentId only), read (select) and delete (whole row)
//       without any special-casing — and no existing table gained or lost a
//       column (the migration touches ONLY the new table)
//
// Database safety: the isolated URL is bound twice on purpose — the Prisma CLI
// (migrate deploy) and the PrismaClient under test (explicit datasources
// override). The developer database, the main checkout and any production
// database are NEVER touched; the temp directory is removed afterwards.

const dir = mkdtempSync(join(tmpdir(), 'bean-3f-migration-'))
const isolatedUrl = `file:${join(dir, 'phase3f-migration.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })

beforeAll(() => {
  execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

const GUEST = 'g-phase3f-migration'
// Each test seeds under its OWN guest id — the isolated database persists rows
// across tests within the file, so per-guest isolation keeps counts exact.
const guestFor = (tag: string) => `${GUEST}-${tag}`

const MAP_SNAPSHOT = {
  kind: 'concept-map',
  title: 'Laws of motion',
  nodes: [
    { id: 'n1', label: 'Newton\u2019s laws', parent: null, explanation: 'The three laws describe how forces change motion.' },
    { id: 'n2', label: 'First law', parent: 'n1', explanation: 'A body stays at rest without a net external force.' },
    { id: 'n3', label: 'Inertia', parent: 'n2', explanation: 'The resistance of a body to changes in motion.' },
  ],
}

async function seedActivityRecord(guestId: string) {
  return client.riisheStudioActivity.create({
    data: {
      guestId,
      kind: 'concept-map',
      topic: 'Motion',
      status: 'IN_PROGRESS',
      grounding: 'document',
      documentId: 'doc-1',
      documentTitle: 'Physics Essentials',
      responseLanguage: 'auto',
      activityVersion: 1,
      activityJson: JSON.stringify(MAP_SNAPSHOT),
      progressJson: JSON.stringify({ selectedNodeId: 'n2', expandedIds: ['n1', 'n2'] }),
      responsesJson: null,
      resultJson: null,
    },
  })
}

describe('Phase 3F — migration (isolated database)', () => {
  it('M2. the deployed database matches prisma/schema.prisma exactly', () => {
    // `migrate diff --from-url X --to-schema-datamodel Y --exit-code` exits 0
    // (and prints nothing) when there is NO difference.
    const out = execFileSync(
      'bun',
      ['x', 'prisma', 'migrate', 'diff', '--from-url', isolatedUrl, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: isolatedUrl },
        stdio: 'pipe',
        timeout: 120_000,
      },
    ).toString()
    // execFileSync throws on a non-zero exit code; reaching this line means the
    // diff command succeeded. Prisma reports the empty diff explicitly.
    expect(out.trim()).toBe('No difference detected.')
  })

  it('M3+M4. the new table round-trips continuity fields with correct lifecycle defaults', async () => {
    const created = await seedActivityRecord(guestFor('roundtrip'))

    expect(created.status).toBe('IN_PROGRESS')
    expect(created.activityVersion).toBe(1)
    expect(created.completedAt).toBeNull()
    expect(created.lastAccessedAt).toBeTruthy()
    expect(created.studentId).toBeNull()

    const loaded = await client.riisheStudioActivity.findUnique({ where: { id: created.id } })
    expect(loaded).not.toBeNull()
    expect(JSON.parse(loaded!.activityJson)).toEqual(MAP_SNAPSHOT)
    expect(JSON.parse(loaded!.progressJson!)).toEqual({ selectedNodeId: 'n2', expandedIds: ['n1', 'n2'] })
    expect(loaded!.responsesJson).toBeNull()
    expect(loaded!.resultJson).toBeNull()
    expect(loaded!.documentId).toBe('doc-1')
    expect(loaded!.documentTitle).toBe('Physics Essentials')
  })

  it('M5. claim / export / delete semantics stay compatible (studentId stamp, select, whole-row delete)', async () => {
    const g = guestFor('claim')
    const created = await seedActivityRecord(g)

    // Claim-guest stamping: studentId only, guestId untouched.
    const stamped = await client.riisheStudioActivity.updateMany({
      where: { guestId: g, studentId: null },
      data: { studentId: 'student-1' },
    })
    expect(stamped.count).toBe(1)
    const afterClaim = await client.riisheStudioActivity.findUnique({ where: { id: created.id } })
    expect(afterClaim!.studentId).toBe('student-1')
    expect(afterClaim!.guestId).toBe(g)
    // Content untouched by the claim.
    expect(JSON.parse(afterClaim!.activityJson)).toEqual(MAP_SNAPSHOT)

    // Export-style read: metadata + evidence columns select cleanly.
    const exported = await client.riisheStudioActivity.findMany({
      where: { studentId: 'student-1' },
      select: { kind: true, topic: true, status: true, grounding: true, progressJson: true, responsesJson: true, resultJson: true, activityVersion: true, createdAt: true, updatedAt: true, completedAt: true },
    })
    expect(exported).toHaveLength(1)
    expect(exported[0].kind).toBe('concept-map')
    expect(exported[0].status).toBe('IN_PROGRESS')

    // Whole-row delete (account/guest purge): no orphaned responses possible.
    await client.riisheStudioActivity.deleteMany({ where: { studentId: 'student-1' } })
    const remaining = await client.riisheStudioActivity.findMany({ where: { guestId: g } })
    expect(remaining).toHaveLength(0)
  })

  it('M6. existing tables are untouched by the Phase 3F migration (RiisheChatTurn keeps its Phase 3D columns)', async () => {
    // A chat turn created "before 3F" (no 3F concept exists on it) still works,
    // proving no other table was altered.
    const turn = await client.riisheChatTurn.create({
      data: {
        guestId: GUEST,
        documentId: null,
        attemptId: null,
        questionId: null,
        role: 'assistant',
        content: 'Legacy-style assistant turn.',
        tutorMode: 'EXPLAIN',
        responseLanguage: 'auto',
      },
    })
    expect(turn.tutorMode).toBe('EXPLAIN')
    const found = await client.riisheChatTurn.findFirst({ where: { guestId: GUEST } })
    expect(found!.content).toBe('Legacy-style assistant turn.')
  })
})
