// ─── OPS-2 amendment: restore PATH PORTABILITY tests ───────────────────────────
//
// The independent-review finding: the restore verification proved basename +
// byte count + content hash agreement, but NOT that the restored application
// can actually OPEN the recovered file through its stored path. This suite
// proves the amendment end to end, on isolated temp infrastructure only
// (no live DB, no real user data):
//
//   P1   storedPath analysis: single unambiguous root; mixed roots and
//        non-absolute paths are refused, never guessed
//   P2   remap plan fail-closed matrix: foreign basename, path traversal,
//        duplicate destinations, unsafe recovery-root overlap, a target DB
//        inside the original root
//   P3   remap application: only the ISOLATED copy changes (original DB
//        byte-identical afterwards), per-row exact-old-value guard, a second
//        application of the same plan is refused and rolled back, health is
//        re-verified (integrity, FK, migration history, DB→file references)
//   P4   canonical materialization: bytes land at the EXACT recorded absolute
//        paths, hash-identical to the manifest entries; existing destinations
//        and protected-root overlap are refused
//   P5   portability probe (positive): documents are opened through the REAL
//        `/api/materials/[id]/file` route handler (200 + sha256=contentHash +
//        Range 206) and evidence through the app's own evidenceFilePath()
//        resolution in a child process with cwd = recovery root
//   P6   portability probe (negative): a stored path that cannot be opened
//        (route 410) and a path that opens but holds DIFFERENT bytes are both
//        detected — the probe cannot be fooled into reporting success
//   P7   triple-hash staging: a source mutation inside the staging window is
//        DETECTED by the new post-staging source re-read; a staged-copy
//        mutation is caught by the source/staged comparison; a benign no-op
//        seam keeps staging green
//   P8   drill integration: the full restore drill now runs BOTH portability
//        proofs (canonical at the recorded root; validated remap onto a
//        different recovery root) and reports them in its result

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, appendFile, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { createBackupStage, type BackupManifest } from '../../scripts/ops/lib/backup-core'
import { buildBackupFixture, type BackupFixture } from '../../scripts/ops/lib/fixture'
import {
  analyzeStoredPaths,
  singleUploadRoot,
  planUploadsRemap,
  applyUploadsRemap,
  planCanonicalMaterialization,
  materializeCanonicalFiles,
  populateRecoveryLayout,
  runPortabilityProbe,
  sha256File,
} from '../../scripts/ops/lib/restore-path-mapping'
import { verifyRestoredDatabase, verifyMigrationHistory, verifyDatabaseReferences } from '../../scripts/ops/lib/restore-verify'
import { runRestoreDrill } from '../../scripts/ops/lib/restore-run'
import { FakeResticAdapter } from '../helpers/ops2-fake-restic'

const projectRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'bean-ops2-port-'))
let fixture: BackupFixture
let manifest: BackupManifest
let stageDir: string

beforeAll(async () => {
  // The differing-paths fixture: TWO owners/documents with independent absolute
  // storedPaths (original paths ≠ the recovery paths used below).
  fixture = await buildBackupFixture(join(root, 'fixture'), projectRoot, { extraDocument: true })
  stageDir = join(root, 'stage')
  await mkdir(stageDir, { recursive: true })
  const staged = await createBackupStage({
    paths: { dbPath: fixture.dbPath, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
    stageDir,
    resticVersion: '0.18.0-fake',
  })
  manifest = staged.manifest
}, 300_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ─── Helpers ───────────────────────────────────────────────────────────────────

let doctorCounter = 0

/**
 * Writable copy of the fixture database with row-level doctoring applied.
 * Copies live in their OWN subdirectory so their location stays disjoint from
 * every protected root (fixture root, staging tree) — otherwise the remap
 * location guard would fire for the wrong reason in planning tests.
 */
async function doctoredDbCopy(mutate: (db: Database) => void): Promise<string> {
  doctorCounter += 1
  const dir = join(root, 'doctored')
  await mkdir(dir, { recursive: true })
  const p = join(dir, `doctored-${doctorCounter}-${randomBytes(4).toString('hex')}.db`)
  await copyFile(fixture.dbPath, p)
  const db = new Database(p)
  try {
    mutate(db)
  } finally {
    db.close()
  }
  return p
}

/** Disposable byte-copies of the fixture storage roots (triple-hash staging
 *  tests mutate their SOURCE files — the fixture itself must never be touched). */
async function disposableStorage(label: string): Promise<{ uploadsDir: string; evidenceDir: string }> {
  const uploadsDir = join(root, `${label}-uploads`)
  const evidenceDir = join(root, `${label}-evidence`)
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  for (const u of fixture.uploads) await copyFile(join(fixture.uploadsDir, u.name), join(uploadsDir, u.name))
  for (const e of fixture.evidence) await copyFile(join(fixture.evidenceDir, e.name), join(evidenceDir, e.name))
  return { uploadsDir, evidenceDir }
}

const manifestUploadNames = () => manifest.uploads.entries.map((e) => e.name)

/** Fresh isolated recovery app-data layout populated from the restored stage. */
async function newRecoveryLayout(label: string) {
  const recoveryAppRoot = join(root, `${label}-${randomBytes(4).toString('hex')}`)
  const populated = await populateRecoveryLayout({
    recoveryAppRoot,
    dbBasename: manifest.database.sourceBasename,
    dbSourcePath: join(stageDir, manifest.database.file),
    restoredUploadsDir: join(stageDir, 'data', 'files', 'uploads'),
    restoredEvidenceDir: join(stageDir, 'data', 'files', 'evidence'),
  })
  expect(populated.ok).toBe(true)
  if (!populated.ok) throw new Error(populated.error)
  return { recoveryAppRoot, ...populated }
}

// ─── P1: storedPath analysis ───────────────────────────────────────────────────

describe('OPS-2 restore path-portability analysis', () => {
  it('P1: both fixture rows are seen with ONE unambiguous absolute root', () => {
    const a = analyzeStoredPaths(fixture.dbPath)
    expect(a.problems).toEqual([])
    expect(a.rows.length).toBe(2)
    expect(a.distinctRoots).toEqual([fixture.uploadsDir])
    const r = singleUploadRoot(a)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.root).toBe(fixture.uploadsDir)
  })

  it('P1b: rows pointing at two different directories are refused as ambiguous', async () => {
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(join(root, 'elsewhere', 'x.pdf'), fixture.db.secondDocumentId as string)
    })
    const r = singleUploadRoot(analyzeStoredPaths(copy))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ambiguous original roots')
  })

  it('P1c: a non-absolute storedPath is flagged, never guessed', async () => {
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run('relative/unsafe.pdf', fixture.db.documentId)
    })
    const a = analyzeStoredPaths(copy)
    expect(a.problems.join(' ')).toContain('not absolute')
    expect(singleUploadRoot(a).ok).toBe(false)
  })
})

// ─── P2: remap plan fail-closed matrix ─────────────────────────────────────────

describe('OPS-2 remap planning refuses unsafe mappings', () => {
  it('P2a: a basename that is not a manifest entry is refused', async () => {
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(join(fixture.uploadsDir, 'ghost-not-in-backup.pdf'), fixture.db.documentId)
    })
    const r = planUploadsRemap({
      dbPath: copy,
      manifestUploadNames: manifestUploadNames(),
      newRoot: join(root, 'p2a-recovery-uploads'),
      forbiddenRoots: [fixture.root, stageDir],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('not a manifest upload entry')
  })

  it('P2b: a traversal-shaped storedPath is refused, never silently normalized', async () => {
    // `<uploads>/../escape.pdf` resolves OUTSIDE the uploads root, so the rows
    // now disagree about the original root — the ambiguity guard must refuse
    // (and any basename that is not a manifest entry is refused separately in
    // P2a; destinations are structurally always <newRoot>/<manifest-basename>,
    // so a traversal can never reach the filesystem through the remap).
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(join(fixture.uploadsDir, '..', 'escape.pdf'), fixture.db.documentId)
    })
    const r = planUploadsRemap({
      dbPath: copy,
      manifestUploadNames: manifestUploadNames(),
      newRoot: join(root, 'p2b-recovery-uploads'),
      forbiddenRoots: [fixture.root, stageDir],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ambiguous original roots')
  })

  it('P2c: two rows mapping onto one destination are refused (duplicate filenames)', async () => {
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(
        join(fixture.uploadsDir, `${fixture.db.documentId}.pdf`),
        fixture.db.secondDocumentId as string,
      )
    })
    const r = planUploadsRemap({
      dbPath: copy,
      manifestUploadNames: manifestUploadNames(),
      newRoot: join(root, 'p2c-recovery-uploads'),
      forbiddenRoots: [fixture.root, stageDir],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('duplicate destination')
  })

  it('P2d: recovery roots overlapping protected roots are refused (inside, equal, containing)', async () => {
    const copy = await doctoredDbCopy(() => undefined) // location disjoint from every protected root
    const inside = planUploadsRemap({
      dbPath: copy,
      manifestUploadNames: manifestUploadNames(),
      newRoot: join(fixture.uploadsDir, 'nested'),
      forbiddenRoots: [fixture.uploadsDir],
    })
    expect(inside.ok).toBe(false)
    if (!inside.ok) expect(inside.error).toContain('recovery uploads root')

    const equal = planUploadsRemap({
      dbPath: copy,
      manifestUploadNames: manifestUploadNames(),
      newRoot: fixture.evidenceDir,
      forbiddenRoots: [fixture.evidenceDir],
    })
    expect(equal.ok).toBe(false)

    const containing = planUploadsRemap({
      dbPath: copy,
      manifestUploadNames: manifestUploadNames(),
      newRoot: root,
      forbiddenRoots: [fixture.root],
    })
    expect(containing.ok).toBe(false)
    if (!containing.ok) expect(containing.error).toContain('must not contain the protected root')
  })

  it('P2e: a remap pointed at the ORIGINAL database location is refused', async () => {
    // A DB copy placed inside the original uploads root is exactly what a
    // miswired caller would look like — the original-root guard must fire.
    const planted = join(fixture.uploadsDir, 'planned-attack.db')
    await copyFile(fixture.dbPath, planted)
    try {
      const r = planUploadsRemap({
        dbPath: planted,
        manifestUploadNames: manifestUploadNames(),
        newRoot: join(root, 'p2e-recovery-uploads'),
        forbiddenRoots: [],
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('must never overlap')
    } finally {
      await rm(planted, { force: true })
    }
  })
})

// ─── P3: remap application on the isolated copy ────────────────────────────────

describe('OPS-2 remap application', () => {
  it('P3: remaps the isolated copy only, keeps it healthy, and refuses a second application', async () => {
    const originalShaBefore = await sha256File(fixture.dbPath)
    const { uploadsDir, dbPath } = await newRecoveryLayout('p3-recovery')

    const plan = planUploadsRemap({
      dbPath,
      manifestUploadNames: manifestUploadNames(),
      newRoot: uploadsDir,
      forbiddenRoots: [fixture.root, stageDir],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.plan.rows.length).toBe(2)
    expect(plan.plan.originalRoot).toBe(fixture.uploadsDir)
    expect(plan.plan.newRoot).toBe(uploadsDir)
    for (const row of plan.plan.rows) expect(row.to.startsWith(uploadsDir + '/')).toBe(true)

    const applied = applyUploadsRemap(dbPath, plan.plan)
    expect(applied.ok).toBe(true)
    if (applied.ok) expect(applied.applied).toBe(2)

    // The remapped copy: every row now points inside the recovery uploads root.
    const db = new Database(dbPath, { readonly: true, create: false })
    let rows: Array<{ id: string; storedPath: string }>
    try {
      rows = db.query('SELECT id, storedPath FROM StudyDocument ORDER BY id').all() as Array<{ id: string; storedPath: string }>
    } finally {
      db.close()
    }
    expect(rows.length).toBe(2)
    for (const row of rows) expect(row.storedPath.startsWith(uploadsDir + '/')).toBe(true)

    // The ORIGINAL fixture database is byte-identical to before the remap.
    expect(await sha256File(fixture.dbPath)).toBe(originalShaBefore)

    // Health: integrity, FK, migration history and DB→file references all hold.
    const integrity = verifyRestoredDatabase(dbPath)
    expect(integrity.integrity).toBe('ok')
    expect(integrity.fkViolations).toBe(0)
    expect(verifyMigrationHistory(dbPath, projectRoot).ok).toBe(true)
    const refs = verifyDatabaseReferences(dbPath, manifest)
    expect(refs.ok).toBe(true)
    expect(refs.checkedUploads).toBe(2)

    // Fail-closed: applying the SAME plan again cannot find the old values and
    // must abort with the transaction rolled back (no partial remap).
    const second = applyUploadsRemap(dbPath, plan.plan)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('did not update exactly once')
    expect(verifyRestoredDatabase(dbPath).integrity).toBe('ok')
  })
})

// ─── P4: canonical materialization ─────────────────────────────────────────────

describe('OPS-2 canonical materialization', () => {
  it('P4: writes the exact recorded absolute paths, hash-identical to the manifest; refuses existing destinations and overlap', async () => {
    const canonicalTarget = join(root, 'p4-canonical-uploads')
    await mkdir(canonicalTarget, { recursive: true })
    // Doctored copy whose rows point at the FRESH canonical target (simulates
    // a same-layout recovery host whose recorded root is genuinely free).
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(join(canonicalTarget, `${fixture.db.documentId}.pdf`), fixture.db.documentId)
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(join(canonicalTarget, `${fixture.db.secondDocumentId}.pdf`), fixture.db.secondDocumentId as string)
    })

    const overlap = planCanonicalMaterialization({ dbPath: copy, manifestUploadNames: manifestUploadNames(), forbiddenRoots: [canonicalTarget] })
    expect(overlap.ok).toBe(false)
    if (!overlap.ok) expect(overlap.error).toContain('must never overlap')

    const plan = planCanonicalMaterialization({ dbPath: copy, manifestUploadNames: manifestUploadNames(), forbiddenRoots: [fixture.root, stageDir] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.plan.root).toBe(canonicalTarget)
    const dests = plan.plan.destinations.map((d) => d.absolutePath).sort()
    expect(dests).toEqual(
      [join(canonicalTarget, `${fixture.db.documentId}.pdf`), join(canonicalTarget, `${fixture.db.secondDocumentId}.pdf`)].sort(),
    )

    const mat = await materializeCanonicalFiles(plan.plan, join(stageDir, 'data', 'files', 'uploads'))
    expect(mat.ok).toBe(true)
    if (mat.ok) expect(mat.written).toBe(2)
    for (const dest of plan.plan.destinations) {
      const entry = manifest.uploads.entries.find((e) => e.name === dest.basename)
      expect(entry).toBeDefined()
      expect(await sha256File(dest.absolutePath)).toBe(entry?.sha256)
    }

    // Refusal: a destination that already exists (canonical never overwrites).
    const second = planCanonicalMaterialization({ dbPath: copy, manifestUploadNames: manifestUploadNames(), forbiddenRoots: [fixture.root, stageDir] })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('already exists')
  })
})

// ─── P5/P6: the portability probe (real application access logic) ──────────────

describe('OPS-2 portability probe — real file-reading logic', () => {
  it('P5: opens both documents through the REAL route (200 + hash + Range 206) and evidence through evidenceFilePath', async () => {
    const { recoveryAppRoot, uploadsDir, dbPath } = await newRecoveryLayout('p5-recovery')
    const plan = planUploadsRemap({
      dbPath,
      manifestUploadNames: manifestUploadNames(),
      newRoot: uploadsDir,
      forbiddenRoots: [fixture.root, stageDir],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)
    expect(applyUploadsRemap(dbPath, plan.plan).ok).toBe(true)

    const probe = await runPortabilityProbe({ projectRoot, appRoot: recoveryAppRoot, dbPath, mode: 'remap' })
    expect(probe.ok).toBe(true)
    if (!probe.ok) throw new Error(probe.error)
    expect(probe.outcome.result.documentsChecked).toBe(2)
    expect(probe.outcome.result.evidenceChecked).toBe(1)
    expect(probe.outcome.result.rangeChecks).toBe(2)
    expect(probe.outcome.result.problems).toEqual([])
    expect(probe.outcome.result.mode).toBe('remap')
  }, 180_000)

  it('P6a: a stored path that cannot be opened is reported (route 410), never success', async () => {
    const { recoveryAppRoot, uploadsDir, dbPath } = await newRecoveryLayout('p6a-recovery')
    // Remap the DB, then DELETE the recovered upload bytes — the real route
    // must return 410 for the missing file and the probe must fail closed.
    const plan = planUploadsRemap({ dbPath, manifestUploadNames: manifestUploadNames(), newRoot: uploadsDir, forbiddenRoots: [fixture.root, stageDir] })
    if (!plan.ok) throw new Error(plan.error)
    expect(applyUploadsRemap(dbPath, plan.plan).ok).toBe(true)
    await rm(join(uploadsDir, `${fixture.db.documentId}.pdf`), { force: true })

    const probe = await runPortabilityProbe({ projectRoot, appRoot: recoveryAppRoot, dbPath, mode: 'remap' })
    expect(probe.ok).toBe(false)
    if (!probe.ok) expect(probe.error).toContain('410')
  }, 180_000)

  it('P6b: a path that OPENS but holds different bytes is caught by the contentHash check', async () => {
    // Un-remapped DB copy whose storedPath points at an EXISTING file with
    // DIFFERENT content (the orphan upload) — route serves 200, bytes hash
    // ≠ DB contentHash → probe must fail. This is the false-positive shape
    // basename-only verification cannot catch on a shared filesystem.
    const copy = await doctoredDbCopy((db) => {
      db.query('UPDATE StudyDocument SET storedPath = ? WHERE id = ?').run(join(fixture.uploadsDir, 'orphan-no-db-row.pdf'), fixture.db.documentId)
    })
    const probe = await runPortabilityProbe({ projectRoot, appRoot: fixture.root, dbPath: copy, mode: 'remap' })
    expect(probe.ok).toBe(false)
    if (!probe.ok) expect(probe.error).toContain('contentHash')
  }, 180_000)
})

// ─── P7: triple-hash staging (source re-read) ──────────────────────────────────

describe('OPS-2 staging triple-hash (post-staging source re-read)', () => {
  async function stagedStage(label: string, hook: (file: { name: string; sourcePath: string; targetPath: string }) => Promise<void>): Promise<unknown> {
    // Disposable byte-copies: the hooks MUTATE source/target files, and the
    // fixture (the original data the other tests rely on) must stay untouched.
    const storage = await disposableStorage(label)
    const dir = join(root, `${label}-stage-${randomBytes(4).toString('hex')}`)
    await mkdir(dir, { recursive: true })
    let thrown: unknown = null
    try {
      await createBackupStage({
        paths: { dbPath: fixture.dbPath, uploadsDir: storage.uploadsDir, evidenceDir: storage.evidenceDir },
        stageDir: dir,
        resticVersion: '0.18.0-fake',
        hooks: { afterStagedWrite: hook },
      })
    } catch (err) {
      thrown = err
    }
    return thrown
  }

  it('P7a: a SOURCE mutation inside the staging window is detected by the re-read', async () => {
    const thrown = await stagedStage('p7a', async ({ sourcePath }) => {
      await appendFile(sourcePath, 'CONCURRENT-WRITER\n')
    })
    expect(thrown).not.toBeNull()
    expect((thrown as Error).message).toContain('changed on the SOURCE during staging')
  })

  it('P7b: a STAGED-COPY mutation inside the staging window is detected by the source/staged comparison', async () => {
    const thrown = await stagedStage('p7b', async ({ targetPath }) => {
      await appendFile(targetPath, 'STAGE-TAMPER\n')
    })
    expect(thrown).not.toBeNull()
    expect((thrown as Error).message).toContain('staged copy does not match the source read')
  })

  it('P7c: a benign no-op seam keeps staging green with manifest-accurate hashes', async () => {
    const storage = await disposableStorage('p7c')
    const dir = join(root, `p7c-stage-${randomBytes(4).toString('hex')}`)
    await mkdir(dir, { recursive: true })
    const staged = await createBackupStage({
      paths: { dbPath: fixture.dbPath, uploadsDir: storage.uploadsDir, evidenceDir: storage.evidenceDir },
      stageDir: dir,
      resticVersion: '0.18.0-fake',
      hooks: { afterStagedWrite: async () => undefined },
    })
    for (const entry of staged.manifest.uploads.entries) {
      const record = fixture.uploads.find((u) => u.name === entry.name)
      expect(record).toBeDefined()
      expect(entry.sha256).toBe(record?.sha256)
    }
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)
  })
})

// ─── P8: drill integration ─────────────────────────────────────────────────────

describe('OPS-2 drill integration with path portability', () => {
  it('P8: the full drill runs BOTH portability proofs and reports them', async () => {
    const drillRoot = mkdtempSync(join(tmpdir(), 'bean-ops2-port-drill-'))
    try {
      const r = await runRestoreDrill({ projectRoot, runMigrateStatus: false }, new FakeResticAdapter(join(drillRoot, 'repo')))
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error(`drill failed at ${r.failedStep}`)
      const byStep = new Map(r.steps.map((s) => [s.step, s]))
      const canonical = byStep.get('path-portability:canonical')
      const remap = byStep.get('path-portability:remap')
      expect(canonical?.ok).toBe(true)
      expect(remap?.ok).toBe(true)
      expect(canonical?.detail).toContain('REAL')
      expect(remap?.detail).toContain('ISOLATED recovery copy')

      // Original and recovery paths genuinely differ in the remap proof.
      expect(r.portability).toBeDefined()
      expect(r.portability?.canonical.documentsChecked).toBe(2)
      expect(r.portability?.canonical.evidenceChecked).toBe(1)
      expect(r.portability?.remap.rowsRemapped).toBe(2)
      expect(r.portability?.remap.originalRoot).not.toBe(r.portability?.remap.newRoot)
      expect(r.portability?.remap.documentsChecked).toBe(2)
    } finally {
      rmSync(drillRoot, { recursive: true, force: true })
    }
  }, 300_000)
})
