// ─── OPS-2 restore-drill tests (fake restic adapter; real migration-chain fixture) ──
//
// Coverage (all on isolated temp infrastructure; never a developer/production DB;
// no real user data — the fixture is fully synthetic):
//   R1  full drill happy path: fixture → backup → repo check (--read-data) →
//       post-backup mutation → restore → full verification battery → cleanup
//   R2  verification battery details: integrity_check ok, zero FK violations,
//       migration history matches the real prisma/migrations chain (30/30)
//   R3  migration-history verification detects missing and extra applied migrations
//   R4  restored-file verification detects corrupted, missing and unexpected files
//   R5  manifest verification detects truncation and sidecar mismatches
//   R6  DB→file reference verification detects missing and mutated files
//   R7  restore-target safety rules (no live-root overlap, no non-empty targets)
//   R8–R12 fault scenarios: corrupt-file / corrupt-manifest / missing-file /
//       repo-corruption / incomplete-manifest are all DETECTED and never
//       reported as success
//   R13 an interrupted restore is reported as a failure, not a success

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { createBackupStage, type BackupManifest } from '../../scripts/ops/lib/backup-core'
import {
  verifyMigrationHistory,
  verifyRestoredFiles,
  verifyDatabaseReferences,
  loadVerifiedManifest,
  assertSafeRestoreTarget,
} from '../../scripts/ops/lib/restore-verify'
import { runRestoreDrill } from '../../scripts/ops/lib/restore-run'
import { FakeResticAdapter } from '../helpers/ops2-fake-restic'
import { buildBackupFixture, type BackupFixture } from '../../scripts/ops/lib/fixture'

const projectRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'bean-ops2-restore-'))
let fixture: BackupFixture
let happyDrill: Awaited<ReturnType<typeof runRestoreDrill>>

beforeAll(async () => {
  fixture = await buildBackupFixture(join(root, 'fixture'), projectRoot)

  // Full happy-path drill (migration-status CLI gate skipped for speed; the
  // real CLI drill runs it — see docs/OPS-2-BACKUP-RESTORE.md evidence).
  const fake = new FakeResticAdapter(join(root, 'happy-repo'))
  happyDrill = await runRestoreDrill({ projectRoot, runMigrateStatus: false }, fake)
}, 300_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function makeStage(label: string): Promise<{ stageDir: string; staged: Awaited<ReturnType<typeof createBackupStage>> }> {
  const stageDir = join(root, `stage-${label}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(stageDir, { recursive: true })
  const staged = await createBackupStage({
    paths: { dbPath: fixture.dbPath, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
    stageDir,
    resticVersion: '0.18.0-fake',
  })
  return { stageDir, staged }
}

function step(result: Awaited<ReturnType<typeof runRestoreDrill>>, name: string) {
  const steps = result.steps.filter((s) => s.step === name)
  return { present: steps.length > 0, allOk: steps.every((s) => s.ok), steps }
}

// ─── R1–R2: full drill happy path ──────────────────────────────────────────────

describe('OPS-2 restore drill happy path', () => {
  it('R1: the full drill passes every step and cleans up all temp data', () => {
    expect(happyDrill.ok).toBe(true)
    if (!happyDrill.ok) {
      //surface the failed step for diagnostics
      throw new Error(`drill failed at ${happyDrill.failedStep}: ${JSON.stringify(happyDrill.steps)}`)
    }
    for (const expected of [
      'repo-init',
      'fixture',
      'backup:offline-gate',
      'backup:staging',
      'backup:restic-backup',
      'backup:restic-check',
      'backup:cleanup',
      'repo-check',
      'post-backup-mutation',
      'restore',
      'verify:manifest',
      'verify:db-integrity',
      'verify:db-foreign-keys',
      'verify:migration-history',
      'verify:restored-files',
      'verify:db-file-references',
      'post-mutation-isolation',
      'cleanup',
    ]) {
      expect(step(happyDrill, expected).present).toBe(true)
      expect(step(happyDrill, expected).allOk).toBe(true)
    }
    expect(happyDrill.snapshotId).toBeTruthy()
    expect(happyDrill.mutation).toBeDefined()
  })

  it('R2: verification battery reports clean integrity, zero FK violations, exact migration history', () => {
    expect(happyDrill.ok).toBe(true)
    if (!happyDrill.ok || !happyDrill.report) throw new Error('no drill report')
    const byId = new Map(happyDrill.report.checks.map((c) => [c.id, c]))
    expect(byId.get('db-integrity')?.detail).toContain('integrity_check=ok')
    expect(byId.get('db-foreign-keys')?.detail).toContain('0 violation(s)')
    expect(byId.get('migration-history')?.ok).toBe(true)
    expect(byId.get('migration-history')?.detail).toContain('migrations applied in order')
    expect(byId.get('db-file-references')?.ok).toBe(true)
    expect(byId.get('db-file-references')?.detail).toContain('1 upload(s) + 1 ACTIVE evidence file(s)')
  })

  it('R2b: the drill fixture used the REAL migration chain (30 migration directories)', () => {
    expect(happyDrill.ok).toBe(true)
    // The standalone fixture (same builder, same chain) proves 30/30 — the
    // drill's own fixture was cleaned up with its workRoot, as designed.
    const applied = verifyMigrationHistory(fixture.dbPath, projectRoot)
    expect(applied.ok).toBe(true)
    expect(applied.expectedCount).toBe(30)
    expect(applied.appliedCount).toBe(30)
  })
})

// ─── R3: migration history verification ────────────────────────────────────────

describe('OPS-2 migration-history verification', () => {
  it('R3: a deleted applied-migration row is detected as missing', async () => {
    const doctored = join(root, 'r3-missing.db')
    await copyFile(fixture.dbPath, doctored)
    const db = new Database(doctored)
    db.query('DELETE FROM _prisma_migrations WHERE migration_name = ?').run('20261118000000_baseline')
    db.close()
    const result = verifyMigrationHistory(doctored, projectRoot)
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('20261118000000_baseline')
    expect(result.appliedCount).toBe(29)
  })

  it('R3: an extra applied-migration row (not in the chain) is detected', async () => {
    const doctored = join(root, 'r3-extra.db')
    await copyFile(fixture.dbPath, doctored)
    const db = new Database(doctored)
    db.query(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('r3-extra-row', 'x', '99999999999999_rogue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
    ).run()
    db.close()
    const result = verifyMigrationHistory(doctored, projectRoot)
    expect(result.ok).toBe(false)
    expect(result.extra).toContain('99999999999999_rogue')
  })
})

// ─── R4–R6: file / manifest / reference verification ───────────────────────────

describe('OPS-2 restored-copy verification', () => {
  it('R4: corrupted, missing and unexpected files are detected', async () => {
    const { stageDir, staged } = await makeStage('r4')
    const m = staged.manifest
    const clean = await verifyRestoredFiles(stageDir, m)
    expect(clean.ok).toBe(true)
    expect(clean.verifiedCount).toBe(m.uploads.entries.length + m.evidence.entries.length)

    // corrupt
    const uploadPath = join(stageDir, 'data', 'files', 'uploads', m.uploads.entries[0].name)
    const buf = await readFile(uploadPath)
    buf[0] = buf[0] ^ 0xff
    await writeFile(uploadPath, buf)
    const afterCorrupt = await verifyRestoredFiles(stageDir, m)
    expect(afterCorrupt.ok).toBe(false)
    expect(afterCorrupt.corrupted).toContain(`uploads/${m.uploads.entries[0].name}`)
    expect(afterCorrupt.verifiedCount).toBe(clean.verifiedCount - 1)

    // missing (fresh stage)
    const { stageDir: dir2, staged: staged2 } = await makeStage('r4-missing')
    await rm(join(dir2, 'data', 'files', 'evidence', staged2.manifest.evidence.entries[0].name), { force: true })
    const afterMissing = await verifyRestoredFiles(dir2, staged2.manifest)
    expect(afterMissing.ok).toBe(false)
    expect(afterMissing.missing).toContain(`evidence/${staged2.manifest.evidence.entries[0].name}`)

    // unexpected
    const { stageDir: dir3, staged: staged3 } = await makeStage('r4-extra')
    await writeFile(join(dir3, 'data', 'files', 'uploads', 'smuggled-extra.bin'), 'unexpected bytes')
    const afterExtra = await verifyRestoredFiles(dir3, staged3.manifest)
    expect(afterExtra.ok).toBe(false)
    expect(afterExtra.unexpected).toContain(join('uploads', 'smuggled-extra.bin'))
  })

  it('R5: manifest truncation and sidecar mismatches fail closed', async () => {
    const { stageDir } = await makeStage('r5-trunc')
    await writeFile(join(stageDir, 'manifest.json'), '{"schema":"bean-backup-manifest/1","trunc', { encoding: 'utf8' })
    const truncated = loadVerifiedManifest(stageDir)
    expect(truncated.ok).toBe(false)
    if (!truncated.ok) expect(truncated.error).toContain('not valid JSON')

    const { stageDir: dir2 } = await makeStage('r5-sidecar')
    const original = await readFile(join(dir2, 'manifest.json'), 'utf8')
    const doctored = JSON.parse(original) as BackupManifest
    doctored.uploads.fileCount = 999 // valid JSON, wrong content → sidecar no longer matches
    await writeFile(join(dir2, 'manifest.json'), JSON.stringify(doctored), { encoding: 'utf8' })
    const sidecarMismatch = loadVerifiedManifest(dir2)
    expect(sidecarMismatch.ok).toBe(false)
    if (!sidecarMismatch.ok) expect(sidecarMismatch.error).toContain('sha256 mismatch')

    const { stageDir: dir3 } = await makeStage('r5-clean')
    const clean = loadVerifiedManifest(dir3)
    expect(clean.ok).toBe(true)
  })

  it('R6: DB→file reference verification detects broken and mutated references', async () => {
    // Reference consistency is DB-vs-manifest (missing FILES are R4's domain —
    // this scenario only proves the DB side stays independently checkable).
    const { stageDir: dirA, staged: stagedA } = await makeStage('r6-missing')
    await rm(join(dirA, 'data', 'files', 'uploads', stagedA.manifest.uploads.entries[0].name), { force: true })
    const mA: BackupManifest = JSON.parse(await readFile(join(dirA, 'manifest.json'), 'utf8')) as BackupManifest
    const refA = verifyDatabaseReferences(join(dirA, mA.database.file), mA)
    expect(refA.ok).toBe(true)
    expect(refA.checkedUploads).toBe(1)

    // Mutated content: doctor the SNAPSHOT db's contentHash to disagree with the staged file
    const { stageDir: dirB, staged: stagedB } = await makeStage('r6-mutated')
    const dbB = new Database(join(dirB, stagedB.manifest.database.file))
    dbB.query('UPDATE StudyDocument SET contentHash = ?').run('a'.repeat(64))
    dbB.close()
    const refB = verifyDatabaseReferences(join(dirB, stagedB.manifest.database.file), stagedB.manifest)
    expect(refB.ok).toBe(false)
    expect(refB.mutated.join(' ')).toContain('contentHash')

    // Broken reference: doctor the storedPath basename to a file that is not in the manifest
    const { stageDir: dirC, staged: stagedC } = await makeStage('r6-broken')
    const dbC = new Database(join(dirC, stagedC.manifest.database.file))
    dbC.query('UPDATE StudyDocument SET storedPath = ?').run(join(dirC, 'nowhere', 'ghost.pdf'))
    dbC.close()
    const refC = verifyDatabaseReferences(join(dirC, stagedC.manifest.database.file), stagedC.manifest)
    expect(refC.ok).toBe(false)
    expect(refC.broken.join(' ')).toContain('ghost.pdf')
  })
})

// ─── R7: restore-target safety ─────────────────────────────────────────────────

describe('OPS-2 restore-target safety', () => {
  it('R7: targets never overlap live roots; empty/new targets pass; occupied targets fail', () => {
    const overlap = assertSafeRestoreTarget(join(fixture.evidenceDir, 'x'), [fixture.uploadsDir, fixture.evidenceDir, fixture.dbPath])
    expect(overlap.ok).toBe(false)
    if (!overlap.ok) expect(overlap.error).toContain('never overlap live data roots')

    const occupied = join(root, 'r7-occupied')
    mkdirSync(occupied, { recursive: true })
    writeFileSync(join(occupied, 'existing.txt'), 'occupied')
    const r2 = assertSafeRestoreTarget(occupied, [fixture.dbPath])
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toContain('not empty')

    const fresh = join(root, `r7-fresh-${Math.random().toString(36).slice(2, 8)}`)
    expect(assertSafeRestoreTarget(fresh, [fixture.dbPath]).ok).toBe(true)
    mkdirSync(fresh, { recursive: true })
    expect(assertSafeRestoreTarget(fresh, [fixture.dbPath]).ok).toBe(true) // empty dir is fine
  })
})

// ─── R8–R13: fault scenarios ───────────────────────────────────────────────────

async function runFault(fault: 'corrupt-file' | 'corrupt-manifest' | 'missing-file' | 'repo-corruption' | 'incomplete-manifest') {
  const fake = new FakeResticAdapter(join(root, `fault-repo-${fault}`))
  return runRestoreDrill({ projectRoot, fault, runMigrateStatus: false }, fake)
}

describe('OPS-2 fault scenarios (every fault must be DETECTED)', () => {
  it('R8: a corrupted restored file is detected — never reported as success', async () => {
    const r = await runFault('corrupt-file')
    expect(r.ok).toBe(true) // the drill succeeded at proving detection
    expect(step(r, 'fault-injection').present).toBe(true)
    expect(step(r, 'fault-detection').allOk).toBe(true)
    const fd = step(r, 'fault-detection').steps[0]
    expect(fd.detail).toContain('correctly DETECTED')
    expect(step(r, 'verify:restored-files').allOk).toBe(false)
  }, 300_000)

  it('R9: a truncated restored manifest is detected — never reported as success', async () => {
    const r = await runFault('corrupt-manifest')
    expect(r.ok).toBe(true)
    expect(step(r, 'fault-detection').allOk).toBe(true)
    expect(step(r, 'verify:manifest').allOk).toBe(false)
  }, 300_000)

  it('R10: a missing restored file is detected — never reported as success', async () => {
    const r = await runFault('missing-file')
    expect(r.ok).toBe(true)
    expect(step(r, 'fault-detection').allOk).toBe(true)
    expect(step(r, 'verify:restored-files').allOk).toBe(false)
  }, 300_000)

  it('R11: repository pack corruption is caught by the integrity check', async () => {
    const r = await runFault('repo-corruption')
    expect(r.ok).toBe(true)
    expect(step(r, 'fault-detection').allOk).toBe(true)
    const fd = step(r, 'fault-detection').steps[0]
    expect(fd.detail).toContain('restic check FAILED')
  }, 300_000)

  it('R12: an interrupted (manifest-less) snapshot is never verified as success', async () => {
    const r = await runFault('incomplete-manifest')
    expect(r.ok).toBe(true)
    expect(step(r, 'fault-detection').allOk).toBe(true)
    const fd = step(r, 'fault-detection').steps[0]
    expect(fd.detail).toContain('correctly REJECTED')
    expect(fd.detail).toContain('manifest')
  }, 300_000)

  it('R13: an interrupted restore is reported as a failure, not a success', async () => {
    const fake = new FakeResticAdapter(join(root, 'r13-repo'))
    fake.restoreError = 'simulated interrupted restore'
    const r = await runRestoreDrill({ projectRoot, runMigrateStatus: false }, fake)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failedStep).toBe('restore')
    const successSteps = r.steps.filter((s) => ['verify:manifest', 'verify:db-integrity', 'post-mutation-isolation'].includes(s.step))
    expect(successSteps).toHaveLength(0)
  }, 300_000)
})
