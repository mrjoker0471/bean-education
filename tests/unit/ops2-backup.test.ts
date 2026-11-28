// ─── OPS-2 backup toolkit tests (fake restic adapter; real SQLite + real files) ──
//
// Coverage (all on isolated temp infrastructure; never a developer/production DB):
//   B1  DATABASE_URL absolute file: URL resolves as-is
//   B2  DATABASE_URL relative path resolves against prisma/ (verified Prisma runtime semantics)
//   B3  non-file: DATABASE_URL refused — no engine guessing
//   B4  offline gate refuses while a journal/WAL sidecar exists
//   B5  offline gate requires the explicit --confirm-offline assertion; refuses a missing DB
//   B6  staging: VACUUM INTO snapshot is a valid DB with all fixture rows; uploads +
//       evidence staged (orphan marked dbReferenced=false); manifest + sha sidecar correct
//   B7  coherence audit fails when a DB row references a missing upload (fail closed)
//   B8  coherence audit fails on contentHash / sha256 / byteSize mutations
//   B9  coherence audit detects a tampered staged copy (hash mismatch)
//   B10 placement safety: repo/stage never inside data roots or the project tree
//       (unless explicitly allowed); restore targets never overlap live roots or
//       existing non-empty dirs
//   B11 password policy: bare RESTIC_PASSWORD refused; no-source refused; loose
//       permissions refused; valid 0600 file accepted; exactly-one-source enforced
//   B12 restic version parsing, minimum floor, and binary resolution via stub binaries
//   B13 an interrupted backup (repository engine throws mid-flow) exits failed, is
//       never reported as success, and its staging tree is cleaned up
//   B14 a complete backup flow succeeds end-to-end and is re-runnable (incremental runs)
//   B15 repository initialization is explicit and refuses to reinitialize
//   B16 the manifest carries no secrets, no env values and no absolute host paths

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs'
import { mkdir, copyFile, writeFile, readFile, stat, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import {
  resolveDatabaseFileUrl,
  assertOfflineBoundary,
  createBackupStage,
  assertSafeBackupPlacement,
  MANIFEST_SCHEMA,
  type BackupManifest,
} from '../../scripts/ops/lib/backup-core'
import { resolveBackupSources, runBackupFlow, initializeBackupRepository } from '../../scripts/ops/lib/backup-run'
import { assertSafeRestoreTarget, verifyRestoredDatabase, verifyRestoredFiles } from '../../scripts/ops/lib/restore-verify'
import {
  resolveResticEnv,
  resolveResticBinary,
  parseResticVersion,
  versionAtLeast,
  RESTIC_MIN_VERSION,
  RESTIC_TESTED_VERSION,
} from '../../scripts/ops/lib/restic'
import { FakeResticAdapter } from '../helpers/ops2-fake-restic'
import { buildBackupFixture, type BackupFixture } from '../../scripts/ops/lib/fixture'

const projectRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'bean-ops2-backup-'))
let fixture: BackupFixture

beforeAll(async () => {
  fixture = await buildBackupFixture(join(root, 'fixture'), projectRoot)
}, 300_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stageFixture(stageDir: string): Promise<ReturnType<typeof createBackupStage>> {
  return createBackupStage({
    paths: { dbPath: fixture.dbPath, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
    stageDir,
    resticVersion: '0.18.0-fake',
  })
}

async function newStageDir(label: string): Promise<string> {
  const dir = join(root, `stage-${label}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Open a writable copy of the fixture database for doctoring scenarios. */
async function doctoredDbCopy(mutate: (db: Database) => void): Promise<string> {
  const p = join(root, `doctored-${Math.random().toString(36).slice(2, 8)}.db`)
  await copyFile(fixture.dbPath, p)
  const db = new Database(p)
  try {
    mutate(db)
  } finally {
    db.close()
  }
  return p
}

// ─── B1–B3: DATABASE_URL resolution ────────────────────────────────────────────

describe('OPS-2 resolveDatabaseFileUrl', () => {
  it('B1: absolute file: URL resolves as-is (query params stripped)', () => {
    const r = resolveDatabaseFileUrl('file:/app/db/custom.db?connection_limit=1', projectRoot)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.dbPath).toBe('/app/db/custom.db')
  })

  it('B2: relative file: URL resolves against the prisma schema directory (verified Prisma runtime semantics)', () => {
    const r = resolveDatabaseFileUrl('file:./db/custom.db', projectRoot)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.dbPath).toBe(join(projectRoot, 'prisma', 'db', 'custom.db'))
  })

  it('B3: non-file URLs are refused — no database engine guessing', () => {
    const r = resolveDatabaseFileUrl('postgresql://user:secret@host/db', projectRoot)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('file: scheme')
    const r2 = resolveDatabaseFileUrl('', projectRoot)
    expect(r2.ok).toBe(false)
  })
})

// ─── B4–B5: offline gate ───────────────────────────────────────────────────────

describe('OPS-2 assertOfflineBoundary', () => {
  it('B4: refuses while a rollback-journal/WAL sidecar exists', async () => {
    const dir = join(root, 'journal-gate')
    await mkdir(dir, { recursive: true })
    const db = join(dir, 'test.db')
    await copyFile(fixture.dbPath, db)
    await writeFile(db + '-journal', 'hot journal bytes')
    const gate = await assertOfflineBoundary(db, true)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.error).toContain('sidecar file present')
  })

  it('B5: requires the explicit offline confirmation and refuses a missing database', async () => {
    const gate = await assertOfflineBoundary(fixture.dbPath, false)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.error).toContain('--confirm-offline')

    const missing = await assertOfflineBoundary(join(root, 'does-not-exist.db'), true)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('does not exist')

    const clean = await assertOfflineBoundary(fixture.dbPath, true)
    expect(clean.ok).toBe(true)
  })
})

// ─── B6–B9: staging, manifest, coherence audit ────────────────────────────────

describe('OPS-2 createBackupStage + auditSnapshotAgainstManifest', () => {
  it('B6: stages a valid SQLite snapshot, all files, and a sidecar-verified manifest', async () => {
    const stageDir = await newStageDir('b6')
    const staged = await stageFixture(stageDir)
    const m = staged.manifest

    expect(m.schema).toBe(MANIFEST_SCHEMA)
    expect(m.database.method).toBe('sqlite-vacuum-into')
    expect(m.database.sourceBasename).toBe('custom.db')

    // The snapshot is a real, integrity-clean database carrying every fixture row.
    const { integrity, fkViolations } = verifyRestoredDatabase(join(stageDir, m.database.file))
    expect(integrity).toBe('ok')
    expect(fkViolations).toBe(0)
    const db = new Database(join(stageDir, m.database.file), { readonly: true })
    try {
      const docs = db.query('SELECT COUNT(*) c FROM StudyDocument').get() as { c: number }
      const students = db.query('SELECT COUNT(*) c FROM Student').get() as { c: number }
      const sessions = db.query('SELECT COUNT(*) c FROM Session').get() as { c: number }
      const evidence = db.query("SELECT COUNT(*) c FROM ExpertCredentialEvidence WHERE retentionState='ACTIVE'").get() as { c: number }
      expect(docs.c).toBe(1)
      expect(students.c).toBe(1)
      expect(sessions.c).toBe(1)
      expect(evidence.c).toBe(1)
    } finally {
      db.close()
    }

    // File entries: the referenced upload, the orphan upload (dbReferenced=false), active evidence.
    expect(m.uploads.entries.map((e) => e.name).sort()).toEqual(fixture.uploads.map((u) => u.name).sort())
    const referenced = m.uploads.entries.find((e) => e.name === fixture.uploads[0].name)
    const orphan = m.uploads.entries.find((e) => e.dbReferenced === false)
    expect(referenced?.dbReferenced).toBe(true)
    expect(referenced?.sha256).toBe(fixture.uploads[0].sha256)
    expect(orphan?.name).toBe(fixture.uploads[1].name)
    expect(m.evidence.entries.length).toBe(1)
    expect(m.evidence.entries[0].sha256).toBe(fixture.evidence[0].sha256)
    expect(m.evidence.entries[0].dbReferenced).toBe(true)

    // Restricted-store discipline: staged files carry 0600.
    const st = await stat(join(stageDir, 'data', 'files', 'uploads', fixture.uploads[0].name))
    // eslint-disable-next-line no-bitwise
    expect(st.mode & 0o077).toBe(0)

    // Manifest sha256 sidecar matches the written manifest.
    const manifestBytes = await readFile(join(stageDir, 'manifest.json'))
    const sidecar = (await readFile(join(stageDir, 'manifest.json.sha256'), 'utf8')).trim()
    const { createHash } = await import('node:crypto')
    expect(sidecar).toBe(createHash('sha256').update(manifestBytes).digest('hex'))
  })
})

// ─── Coherence audit fail-closed paths ────────────────────────────────────────

describe('OPS-2 coherence audit fail-closed paths', () => {
  it('B7 (throw form): broken upload reference aborts the backup', async () => {
    const dbPath = await doctoredDbCopy((db) => {
      db.query(
        "INSERT INTO StudyDocument (id, guestId, title, originalName, storedPath, mimeType, fileSize, status, contentHash, createdAt, updatedAt) VALUES (?, 'ops2-audit', 'ghost', 'ghost.pdf', ?, 'application/pdf', 99, 'READY', ?, '2026-01-01 00:00:00', '2026-01-01 00:00:00')",
      ).run('ops2doc_ghost', join(fixture.uploadsDir, 'ghost-not-staged.pdf'), '0'.repeat(64))
    })
    const stageDir = await newStageDir('b7-throw')
    let thrown: unknown = null
    try {
      await createBackupStage({
        paths: { dbPath, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
        stageDir,
        resticVersion: '0.18.0-fake',
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).not.toBeNull()
    expect(thrown instanceof Error ? thrown.message : String(thrown)).toContain('coherence audit FAILED')
    expect(thrown instanceof Error ? thrown.message : String(thrown)).toContain('ghost-not-staged.pdf')
  })

  it('B8: content hash / byte size mutations against DB records abort the backup', async () => {
    // contentHash mismatch
    const dbHash = await doctoredDbCopy((db) => {
      db.query("UPDATE StudyDocument SET contentHash = ? WHERE id = ?").run('f'.repeat(64), fixture.db.documentId)
    })
    const stageHash = await newStageDir('b8-hash')
    let err1: unknown = null
    try {
      await createBackupStage({
        paths: { dbPath: dbHash, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
        stageDir: stageHash,
        resticVersion: '0.18.0-fake',
      })
    } catch (e) {
      err1 = e
    }
    expect(err1).not.toBeNull()
    expect((err1 as Error).message).toContain('content hash')

    // byte size mismatch
    const dbSize = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET fileSize = 123456 WHERE id = ?').run(fixture.db.documentId)
    })
    const stageSize = await newStageDir('b8-size')
    let err2: unknown = null
    try {
      await createBackupStage({
        paths: { dbPath: dbSize, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
        stageDir: stageSize,
        resticVersion: '0.18.0-fake',
      })
    } catch (e) {
      err2 = e
    }
    expect(err2).not.toBeNull()
    expect((err2 as Error).message).toContain('bytes')
  })

  it('B9: a tampered staged copy is detected by the file verification', async () => {
    const stageDir = await newStageDir('b9')
    const staged = await stageFixture(stageDir)
    const target = join(stageDir, 'data', 'files', 'evidence', staged.manifest.evidence.entries[0].name)
    await appendFile(target, 'TAMPERED-AFTER-STAGING\n')
    const m: BackupManifest = JSON.parse(await readFile(join(stageDir, 'manifest.json'), 'utf8')) as BackupManifest
    // The restore-side verifier re-hashes every staged file against the manifest —
    // the same gate that guards a restored copy.
    const verify = await verifyRestoredFiles(stageDir, m)
    expect(verify.ok).toBe(false)
    expect(verify.corrupted).toContain(`evidence/${staged.manifest.evidence.entries[0].name}`)
  })
})

// ─── B10: placement + restore-target safety ────────────────────────────────────

describe('OPS-2 placement safety', () => {
  it('B10a: repository/stage may never live inside the data roots', () => {
    const r1 = assertSafeBackupPlacement(join(fixture.uploadsDir, 'repo'), [fixture.uploadsDir, fixture.evidenceDir, fixture.dbPath], projectRoot, { what: 'backup repository' })
    expect(r1.ok).toBe(false)
    const r2 = assertSafeBackupPlacement(fixture.evidenceDir, [fixture.uploadsDir, fixture.evidenceDir, fixture.dbPath], projectRoot, { what: 'staging directory' })
    expect(r2.ok).toBe(false)
  })

  it('B10b: repository inside the project tree requires --allow-in-tree', () => {
    const inside = join(projectRoot, '.bean-backups-tmp')
    const r = assertSafeBackupPlacement(inside, [], projectRoot, { what: 'backup repository' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--allow-in-tree')
    const allowed = assertSafeBackupPlacement(inside, [], projectRoot, { what: 'backup repository', allowInTree: true })
    expect(allowed.ok).toBe(true)
  })

  it('B10c: restore targets may never overlap live roots or existing non-empty dirs', () => {
    const r1 = assertSafeRestoreTarget(join(fixture.uploadsDir, 'restore'), [fixture.uploadsDir, fixture.evidenceDir, fixture.dbPath])
    expect(r1.ok).toBe(false)
    const nonEmpty = join(root, 'b10-nonempty')
    mkdirSync(nonEmpty, { recursive: true })
    writeFileSync(join(nonEmpty, 'x.txt'), 'occupied')
    const r2 = assertSafeRestoreTarget(nonEmpty, [fixture.uploadsDir])
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toContain('not empty')
    const fresh = join(root, 'b10-fresh')
    const r3 = assertSafeRestoreTarget(fresh, [fixture.uploadsDir])
    expect(r3.ok).toBe(true)
  })
})

// ─── B11–B12: restic credential policy + binary/version gates ──────────────────

describe('OPS-2 restic credential policy', () => {
  const savedResticPassword = process.env.RESTIC_PASSWORD

  it('B11: bare RESTIC_PASSWORD is refused; the password never touches a command line', async () => {
    process.env.RESTIC_PASSWORD = 'leaky'
    const r = await resolveResticEnv({ repository: '/tmp/repo' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('RESTIC_PASSWORD')
  })

  it('B11: no source, both sources, missing/empty/loose files are refused; a 0600 file works', async () => {
    delete process.env.RESTIC_PASSWORD

    const none = await resolveResticEnv({ repository: '/tmp/repo' })
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.error).toContain('password source')

    const both = await resolveResticEnv({ repository: '/tmp/repo', passwordFile: join(root, 'pw'), passwordCommand: 'echo pw' })
    expect(both.ok).toBe(false)

    const missing = await resolveResticEnv({ repository: '/tmp/repo', passwordFile: join(root, 'no-such-pw') })
    expect(missing.ok).toBe(false)

    const loose = join(root, 'loose-pw')
    writeFileSync(loose, 'pw-loose')
    chmodSync(loose, 0o644)
    const looseR = await resolveResticEnv({ repository: '/tmp/repo', passwordFile: loose })
    expect(looseR.ok).toBe(false)
    if (!looseR.ok) expect(looseR.error).toContain('chmod 600')

    const good = join(root, 'good-pw')
    writeFileSync(good, 'pw-good')
    chmodSync(good, 0o600)
    const ok = await resolveResticEnv({ repository: '/tmp/repo', passwordFile: good })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.env.RESTIC_PASSWORD_FILE).toBe(good)
      expect(ok.env.RESTIC_PASSWORD).toBeUndefined()
      // The child environment is minimal — no parent secrets leak in.
      expect(Object.keys(ok.env).sort()).toEqual(['HOME', 'PATH', 'RESTIC_PASSWORD_FILE', 'RESTIC_REPOSITORY', 'TMPDIR'])
    }
  })

  afterAll(() => {
    if (savedResticPassword === undefined) delete process.env.RESTIC_PASSWORD
    else process.env.RESTIC_PASSWORD = savedResticPassword
  })
})

describe('OPS-2 restic binary and version gates', () => {
  it('B12: version parsing and the documented minimum floor', () => {
    expect(parseResticVersion('restic 0.18.0 compiled with go1.24.1 on linux/amd64')).toBe('0.18.0')
    expect(parseResticVersion('garbage')).toBeNull()
    expect(versionAtLeast('0.18.0', RESTIC_MIN_VERSION)).toBe(true)
    expect(versionAtLeast(RESTIC_TESTED_VERSION, RESTIC_MIN_VERSION)).toBe(true)
    expect(versionAtLeast('0.16.9', RESTIC_MIN_VERSION)).toBe(false)
    expect(versionAtLeast('garbage', RESTIC_MIN_VERSION)).toBe(false)
  })

  it('B12: binary resolution honors the version floor and rejects unparseable output', async () => {
    const bin = (name: string, body: string) => {
      const p = join(root, name)
      writeFileSync(p, body)
      chmodSync(p, 0o755)
      return p
    }
    const old = bin('stub-restic-old.sh', '#!/bin/sh\necho "restic 0.16.0 compiled with go1.21 on linux/amd64"\n')
    await expect(resolveResticBinary({ resticBin: old })).rejects.toThrow('below the documented minimum')

    const garbage = bin('stub-restic-garbage.sh', '#!/bin/sh\necho "definitely not restic"\n')
    await expect(resolveResticBinary({ resticBin: garbage })).rejects.toThrow('could not parse a restic version')

    const ok = bin('stub-restic-ok.sh', '#!/bin/sh\necho "restic 0.18.0 compiled with go1.24.1 on linux/amd64"\n')
    const resolved = await resolveResticBinary({ resticBin: ok })
    expect(resolved.version).toBe('0.18.0')

    const missingBin = join(root, 'no-such-restic-binary')
    await expect(resolveResticBinary({ resticBin: missingBin })).rejects.toThrow('host dependency')
  })
})

// ─── B13–B16: backup flow orchestration (fake restic adapter) ──────────────────

describe('OPS-2 runBackupFlow', () => {
  it('B13: an interrupted backup is never reported as success and its stage is cleaned', async () => {
    const repo = join(root, 'b13-repo')
    const fake = new FakeResticAdapter(repo)
    await fake.initRepository()
    fake.backupError = 'simulated interrupted repository write'

    const result = await runBackupFlow(
      {
        projectRoot,
        databaseUrl: `file:${fixture.dbPath}`,
        uploadsDir: fixture.uploadsDir,
        evidenceDir: fixture.evidenceDir,
        repository: repo,
        confirmOffline: true,
        verifyData: false,
        keepStage: false,
        allowInTree: true,
      },
      fake,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStage).toBe('staging-or-repository')
      expect(result.stageRemoved).toBe(true)
      const lastOk = [...result.log].reverse().find((l) => l.ok)
      // No stage after the failure claims success.
      expect(lastOk?.stage).not.toBe('restic-backup')
      expect(lastOk?.stage).not.toBe('restic-check')
    }
    expect(await fake.listSnapshots()).toHaveLength(0)
  })

  it('B14: a complete backup succeeds end-to-end and can run incrementally', async () => {
    const repo = join(root, 'b14-repo')
    const fake = new FakeResticAdapter(repo)
    await fake.initRepository()

    const first = await runBackupFlow(
      {
        projectRoot,
        databaseUrl: `file:${fixture.dbPath}`,
        uploadsDir: fixture.uploadsDir,
        evidenceDir: fixture.evidenceDir,
        repository: repo,
        confirmOffline: true,
        verifyData: true,
        keepStage: false,
        allowInTree: true,
      },
      fake,
    )
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.snapshotId).toBeTruthy()
      expect(first.manifest.database.method).toBe('sqlite-vacuum-into')
      expect(first.stageRemoved).toBe(true)
      expect(existsSync(first.stageDir)).toBe(false)
      expect(first.manifest.uploads.fileCount).toBe(fixture.uploads.length)
      expect(first.manifest.evidence.fileCount).toBe(fixture.evidence.length)
    }

    const second = await runBackupFlow(
      {
        projectRoot,
        databaseUrl: `file:${fixture.dbPath}`,
        uploadsDir: fixture.uploadsDir,
        evidenceDir: fixture.evidenceDir,
        repository: repo,
        confirmOffline: true,
        verifyData: true,
        keepStage: false,
        allowInTree: true,
      },
      fake,
    )
    expect(second.ok).toBe(true)
    const snaps = await fake.listSnapshots()
    expect(snaps.length).toBe(2)
    expect(snaps[0].id).not.toBe(snaps[1].id)
    expect(snaps[0].tags).toContain('bean-education')

    // B16 (leak-safety): no env values, no DATABASE_URL string, no absolute host paths.
    const manifestJson = JSON.stringify(first.ok ? first.manifest : {})
    expect(manifestJson).not.toContain('DATABASE_URL')
    expect(manifestJson).not.toContain('postgresql')
    expect(manifestJson).not.toContain(projectRoot)
    expect(manifestJson).not.toContain(root)
  })

  it('B15: repository initialization is explicit and refuses reinitialization', async () => {
    const repo = join(root, 'b15-repo')
    const fake = new FakeResticAdapter(repo)
    const first = await initializeBackupRepository({ repository: repo, allowInTree: true, projectRoot }, fake)
    expect(first.ok).toBe(true)

    const again = await initializeBackupRepository({ repository: repo, allowInTree: true, projectRoot }, fake)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).toContain('refusing to reinitialize')
  })

  it('B14b: source resolution derives uploads/evidence roots from cwd', () => {
    const r = resolveBackupSources({ projectRoot, databaseUrl: 'file:/app/db/custom.db' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sources.dbPath).toBe('/app/db/custom.db')
      expect(r.sources.uploadsDir).toBe(join(process.cwd(), 'db', 'uploads'))
      expect(r.sources.evidenceDir).toBe(join(process.cwd(), 'db', 'evidence'))
    }
  })
})
