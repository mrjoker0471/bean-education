import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

// ─── Phase 3D — migration test on an ISOLATED temporary SQLite database ──────
// Proves the Phase 3D schema change is safe, additive and backward-compatible:
//   M1. the FULL migration chain (baseline → … → phase3d_chat_preferences)
//       applies cleanly with `prisma migrate deploy` on a throwaway file DB
//   M2. the deployed database matches prisma/schema.prisma exactly
//       (`prisma migrate diff` reports no difference)
//   M3. legacy-style rows (written without preference columns) keep NULL
//       preferences and untouched content — history is never rewritten
//   M4. new rows round-trip the preference fields (tutorMode, responseLanguage)
//   M5. the reload contract works against REAL persistence: a conversation with
//       one legacy + one new assistant turn restores the NEWEST preference
//   M6. user turns never carry preference metadata even when siblings do
//   M7. claim/export/delete semantics stay compatible: rows carrying
//       preferences update (studentId only), read (select), and delete (whole
//       row) without any special-casing
//
// Database safety: the isolated URL is bound twice on purpose — the Prisma CLI
// (migrate deploy) and the PrismaClient under test (explicit datasources
// override). The developer database, the main checkout and any production
// database are NEVER touched; the temp directory is removed afterwards.

const dir = mkdtempSync(join(tmpdir(), 'bean-3d-migration-'))
const isolatedUrl = `file:${join(dir, 'phase3d-migration.db')}`

// A dedicated client bound to the isolated file — the developer database, the
// main checkout and any production database are never touched.
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })

beforeAll(() => {
  // M1: apply the whole migration chain to the throwaway database.
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

const GUEST = 'g-phase3d-migration'

async function seedLegacyThenNewTurns() {
  // A "legacy" assistant turn: written WITHOUT the preference columns, exactly
  // as rows existed before Phase 3D. Prisma stores NULL for the new columns.
  await client.riisheChatTurn.create({
    data: {
      guestId: GUEST,
      documentId: 'doc-legacy',
      role: 'assistant',
      content: 'Legacy assistant answer from before Phase 3D.',
      grounding: 'general',
    },
  })
  // The matching legacy user turn.
  await client.riisheChatTurn.create({
    data: {
      guestId: GUEST,
      documentId: 'doc-legacy',
      role: 'user',
      content: 'Legacy user question from before Phase 3D.',
    },
  })
  // A Phase 3D assistant turn carrying the preference in force.
  await client.riisheChatTurn.create({
    data: {
      guestId: GUEST,
      documentId: 'doc-legacy',
      role: 'assistant',
      content: 'New assistant answer produced under SOCRATIC + Tamil.',
      grounding: 'document',
      tutorMode: 'SOCRATIC',
      responseLanguage: 'ta',
    },
  })
}

describe('Phase 3D migration (isolated SQLite)', () => {
  it('M1. the full migration chain applies cleanly via prisma migrate deploy', () => {
    // Verified in beforeAll: migrate deploy exited 0 (execFileSync throws on
    // non-zero). Applied here as an explicit assertion with a fresh deploy on
    // a second throwaway file to prove the chain is replayable.
    const dir2 = mkdtempSync(join(tmpdir(), 'bean-3d-migration-replay-'))
    try {
      execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${join(dir2, 'replay.db')}` },
        stdio: 'pipe',
        timeout: 180_000,
      })
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('M2. the deployed database matches prisma/schema.prisma exactly', () => {
    const out = execFileSync('bun', [
      'x', 'prisma', 'migrate', 'diff',
      '--from-url', isolatedUrl,
      '--to-schema-datamodel', 'prisma/schema.prisma',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: isolatedUrl },
      stdio: 'pipe',
      timeout: 120_000,
    }).toString()
    expect(out.trim()).toBe('No difference detected.')
  })

  it('M3. legacy rows keep NULL preferences and untouched content', async () => {
    await seedLegacyThenNewTurns()
    const legacy = await client.riisheChatTurn.findFirstOrThrow({
      where: { guestId: GUEST, role: 'assistant', content: { contains: 'Legacy assistant' } },
    })
    expect(legacy.tutorMode).toBeNull()
    expect(legacy.responseLanguage).toBeNull()
    expect(legacy.content).toBe('Legacy assistant answer from before Phase 3D.')
    expect(legacy.grounding).toBe('general')
    expect(legacy.documentId).toBe('doc-legacy')
  })

  it('M4. new rows round-trip the preference fields', async () => {
    const row = await client.riisheChatTurn.findFirstOrThrow({
      where: { guestId: GUEST, tutorMode: 'SOCRATIC' },
    })
    expect(row.responseLanguage).toBe('ta')
    expect(row.role).toBe('assistant')
    expect(row.content).toBe('New assistant answer produced under SOCRATIC + Tamil.')
  })

  it('M5. the reload contract works against real persistence (newest preference wins)', async () => {
    // Same query the chat-history GET uses (newest last, 30-turn window).
    const turns = await client.riisheChatTurn.findMany({
      where: { guestId: GUEST, documentId: 'doc-legacy', attemptId: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    const ordered = [...turns].reverse()
    const assistantTurns = ordered.filter(t => t.role === 'assistant')
    expect(assistantTurns).toHaveLength(2)
    const withPrefs = [...assistantTurns].reverse().find(t => t.tutorMode != null || t.responseLanguage != null)
    expect(withPrefs?.tutorMode).toBe('SOCRATIC')
    expect(withPrefs?.responseLanguage).toBe('ta')
    // The legacy turn normalises to the documented defaults.
    const legacy = assistantTurns.find(t => t.tutorMode == null)
    expect(legacy?.content).toContain('Legacy assistant')
  })

  it('M6. user turns never carry preference metadata even when siblings do', async () => {
    const userTurns = await client.riisheChatTurn.findMany({
      where: { guestId: GUEST, role: 'user' },
    })
    expect(userTurns.length).toBeGreaterThan(0)
    for (const t of userTurns) {
      expect(t.tutorMode).toBeNull()
      expect(t.responseLanguage).toBeNull()
    }
  })

  it('M7. claim/export/delete semantics stay compatible with preference rows', async () => {
    // Claim: updateMany sets studentId ONLY — preferences ride along.
    const claimed = await client.riisheChatTurn.updateMany({
      where: { guestId: GUEST, studentId: null },
      data: { studentId: 'student-1' },
    })
    expect(claimed.count).toBe(3)
    const afterClaim = await client.riisheChatTurn.findFirstOrThrow({
      where: { studentId: 'student-1', tutorMode: 'SOCRATIC' },
    })
    expect(afterClaim.responseLanguage).toBe('ta')
    // Export: the preference columns are selectable like any other column.
    const exported = await client.riisheChatTurn.findMany({
      where: { studentId: 'student-1' },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true, documentId: true, tutorMode: true, responseLanguage: true },
    })
    expect(exported).toHaveLength(3)
    const prefRow = exported.find(t => t.tutorMode != null)
    expect(prefRow?.tutorMode).toBe('SOCRATIC')
    expect(prefRow?.responseLanguage).toBe('ta')
    const legacyRow = exported.find(t => t.tutorMode == null && t.role === 'assistant')
    expect(legacyRow?.responseLanguage).toBeNull()
    // Deletion: whole-row removal takes the preference metadata with it.
    const removed = await client.riisheChatTurn.deleteMany({ where: { studentId: 'student-1' } })
    expect(removed.count).toBe(3)
    expect(await client.riisheChatTurn.count({ where: { studentId: 'student-1' } })).toBe(0)
  })
})
